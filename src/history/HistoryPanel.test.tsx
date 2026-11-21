import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EditorApi } from "../editor/Editor";
import type { NoteSession, NoteSessionState } from "../editor/noteSession";
import type { HistoryEntry } from "../lib/history";
import { HistoryPanel } from "./HistoryPanel";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  saveSnapshot: vi.fn<(path: string, content: string, reason: string) => Promise<unknown>>(),
  listSnapshots: vi.fn<(path: string) => Promise<HistoryEntry[]>>(),
  readSnapshot: vi.fn<(path: string, id: string) => Promise<string>>(),
}));

vi.mock("../lib/history", () => ({
  saveSnapshot: mocks.saveSnapshot,
  listSnapshots: mocks.listSnapshots,
  readSnapshot: mocks.readSnapshot,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const FRONTMATTER = "---\ntype: note\n---\n";
const BODY = "# Plan\n\ncurrent line\n";
const OLD_BODY = "# Plan\n\nold line\n";
const NOW = Date.now();

const entry = (id: string, reason: string, ageMs: number): HistoryEntry => ({
  id,
  createdMs: NOW - ageMs,
  reason,
  bytes: 10,
});

const ENTRIES = [entry("b", "Before restore", 5 * 60_000), entry("a", "Before Ask Claude: Rewrite", 3 * 3_600_000)];

interface FakeSession {
  path: string;
  state: NoteSessionState;
  body: string;
  set(state: NoteSessionState): void;
  session: NoteSession;
}

const fakeSession = (path = "Inbox/Plan.md"): FakeSession => {
  const listeners = new Set<() => void>();
  const fake: FakeSession = {
    path,
    state: "ready",
    body: BODY,
    set(state) {
      fake.state = state;
      listeners.forEach((listener) => listener());
    },
    session: undefined as unknown as NoteSession,
  };
  fake.session = {
    get path() {
      return fake.path;
    },
    get state() {
      return fake.state;
    },
    fileContent: () => FRONTMATTER + fake.body,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as NoteSession;
  return fake;
};

const fakeEditor = (note: FakeSession) => ({
  currentBody: vi.fn(() => note.body),
  replaceBody: vi.fn((md: string) => {
    mocks.calls.push("replaceBody");
    note.body = md;
  }),
});

let container: HTMLDivElement;
let root: Root;
let note: FakeSession;
let editor: ReturnType<typeof fakeEditor>;
let onClose: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.calls.length = 0;
  mocks.saveSnapshot.mockReset();
  mocks.saveSnapshot.mockImplementation(async () => {
    mocks.calls.push("saveSnapshot");
    return ENTRIES[0];
  });
  mocks.listSnapshots.mockReset();
  mocks.listSnapshots.mockResolvedValue(ENTRIES);
  mocks.readSnapshot.mockReset();
  mocks.readSnapshot.mockImplementation(async (_path, id) => FRONTMATTER.replace("note", "other") + (id === "a" ? OLD_BODY : BODY));
  note = fakeSession();
  editor = fakeEditor(note);
  onClose = vi.fn<() => void>();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const render = async (session: NoteSession | null = note.session, api: EditorApi | null = editor) => {
  act(() => root.render(<HistoryPanel note={session} editor={api} onClose={onClose} />));
  await settle();
};

const button = (label: string) => {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

const rows = () => [...container.querySelectorAll<HTMLButtonElement>(".tack-history-entry")];

const select = async (index: number) => {
  await act(async () => rows()[index].click());
  await settle();
};

const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;

describe("HistoryPanel", () => {
  test("lists versions newest first with relative time and reason", async () => {
    await render();
    expect(mocks.listSnapshots).toHaveBeenCalledWith("Inbox/Plan.md");
    expect(rows().map((row) => row.textContent)).toEqual([
      "5 min agoBefore restore",
      "3 h agoBefore Ask Claude: Rewrite",
    ]);
  });

  test("shows the empty state", async () => {
    mocks.listSnapshots.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain(
      "No history yet. Tack saves a version before Claude changes a note or you restore one.",
    );
  });

  test("shows a list error", async () => {
    mocks.listSnapshots.mockRejectedValue(new Error("disk gone\nmore"));
    await render();
    expect(alertText()).toBe("disk gone");
  });

  test("reloads the list when the note changes", async () => {
    await render();
    const other = fakeSession("Inbox/Other.md");
    await render(other.session, fakeEditor(other));
    expect(mocks.listSnapshots).toHaveBeenLastCalledWith("Inbox/Other.md");
    expect(mocks.listSnapshots).toHaveBeenCalledTimes(2);
  });

  test("selecting a version shows its diff against the current body", async () => {
    await render();
    await select(1);
    expect(mocks.readSnapshot).toHaveBeenCalledWith("Inbox/Plan.md", "a");
    const diff = container.querySelector(".tack-diff");
    expect(diff?.querySelector(".tack-diff-del")?.textContent).toContain("current line");
    expect(diff?.querySelector(".tack-diff-add")?.textContent).toContain("old line");
  });

  test("restore snapshots the current file, then replaces the body without the snapshot frontmatter", async () => {
    await render();
    await select(1);
    await act(async () => button("Restore this version").click());
    await settle();
    expect(mocks.calls).toEqual(["saveSnapshot", "replaceBody"]);
    expect(mocks.saveSnapshot).toHaveBeenCalledWith("Inbox/Plan.md", FRONTMATTER + BODY, "Before restore");
    expect(editor.replaceBody).toHaveBeenCalledWith(OLD_BODY);
  });

  test("the list reloads after a restore", async () => {
    await render();
    await select(1);
    await act(async () => button("Restore this version").click());
    await settle();
    expect(mocks.listSnapshots).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".tack-diff")).toBeNull();
  });

  test("a failed snapshot blocks the restore and shows the error", async () => {
    mocks.saveSnapshot.mockRejectedValue(new Error("no space\nleft"));
    await render();
    await select(1);
    await act(async () => button("Restore this version").click());
    await settle();
    expect(editor.replaceBody).not.toHaveBeenCalled();
    expect(alertText()).toBe("no space");
  });

  test("a replaceBody error is shown", async () => {
    editor.replaceBody.mockImplementation(() => {
      throw new Error("editor busy");
    });
    await render();
    await select(1);
    await act(async () => button("Restore this version").click());
    await settle();
    expect(alertText()).toBe("editor busy");
  });

  test("restore is disabled in conflict and while loading", async () => {
    await render();
    await select(1);
    expect(button("Restore this version").disabled).toBe(false);
    act(() => note.set("conflict"));
    expect(button("Restore this version").disabled).toBe(true);
    act(() => note.set("loading"));
    expect(button("Restore this version").disabled).toBe(true);
  });

  test("a version equal to the current body shows Same as current and cannot be restored", async () => {
    await render();
    await select(0);
    expect(container.textContent).toContain("Same as current");
    expect(button("Restore this version").disabled).toBe(true);
  });

  test("restore does nothing when the note changed during the snapshot", async () => {
    let release!: () => void;
    mocks.saveSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ENTRIES[0]);
        }),
    );
    await render();
    await select(1);
    await act(async () => button("Restore this version").click());
    act(() => note.set("conflict"));
    await act(async () => release());
    await settle();
    expect(editor.replaceBody).not.toHaveBeenCalled();
  });

  test("Esc and Close call onClose", async () => {
    await render();
    act(() => {
      container.querySelector("aside")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => button("Close").click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("no note shows a hint", async () => {
    await render(null, null);
    expect(mocks.listSnapshots).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Open a note to see its history.");
  });
});
