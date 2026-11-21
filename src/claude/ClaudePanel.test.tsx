import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EditorApi } from "../editor/Editor";
import type { NoteSession, NoteSessionState } from "../editor/noteSession";
import { ClaudeError } from "../lib/claude";
import { ClaudePanel } from "./ClaudePanel";

interface FakeRun {
  prompt: string;
  progress(text: string): void;
  resolve(text: string): void;
  reject(error: unknown): void;
  cancel: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

const mocks = vi.hoisted(() => ({
  runs: [] as FakeRun[],
  calls: [] as string[],
  saveSnapshot: vi.fn<(path: string, content: string, reason: string) => Promise<unknown>>(),
}));

vi.mock("../lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/claude")>();
  return {
    ...actual,
    askClaude: (prompt: string, onProgress: (text: string) => void) => {
      let resolve!: (text: string) => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const run: FakeRun = {
        prompt,
        progress: onProgress,
        resolve,
        reject,
        cancel: vi.fn(async () => reject(new actual.ClaudeError("cancelled"))),
      };
      mocks.runs.push(run);
      return { requestId: `r${mocks.runs.length}`, result, cancel: run.cancel };
    },
  };
});

vi.mock("../lib/history", () => ({ saveSnapshot: mocks.saveSnapshot }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const FRONTMATTER = "---\ntype: note\n---\n";
const BODY = "# Plan\n\nold line\n";

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
    get body() {
      return fake.body;
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
  mocks.runs.length = 0;
  mocks.calls.length = 0;
  mocks.saveSnapshot.mockReset();
  mocks.saveSnapshot.mockImplementation(async () => {
    mocks.calls.push("saveSnapshot");
    return { id: "1", createdMs: 0, reason: "", bytes: 0 };
  });
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

const render = (session: NoteSession | null = note.session, api: EditorApi | null = editor) =>
  act(() => root.render(<ClaudePanel note={session} editor={api} onClose={onClose} />));

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const button = (label: string) => {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

const input = () => container.querySelector("input") as HTMLInputElement;

const type = (text: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });

const finish = async (text: string) => {
  await act(async () => mocks.runs[mocks.runs.length - 1].resolve(text));
  await settle();
};

const fail = async (error: unknown) => {
  await act(async () => mocks.runs[mocks.runs.length - 1].reject(error));
  await settle();
};

const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;

const startQuick = async (label = "Rewrite") => {
  await act(async () => button(label).click());
};

describe("ClaudePanel asking", () => {
  test("shows the input, the quick actions and the placeholder", () => {
    render();
    expect(input().placeholder).toBe("Ask Claude to change this note…");
    for (const label of ["Rewrite", "Check", "Summarize", "Action items", "Make it a how-to"]) button(label);
  });

  test("Enter sends the instruction with the note title and body, and shows progress", async () => {
    render();
    type("Make it shorter");
    press("Enter");
    expect(mocks.runs).toHaveLength(1);
    const { prompt } = mocks.runs[0];
    expect(prompt).toContain("Instruction: Make it shorter");
    expect(prompt).toContain("Note title: Plan");
    expect(prompt).toContain(BODY);
    expect(prompt).not.toContain("type: note");

    act(() => mocks.runs[0].progress("Working on it"));
    expect(container.textContent).toContain("Working on it");
    button("Cancel");
  });

  test("Enter during IME composition does not send", () => {
    render();
    type("にほん");
    press("Enter", { isComposing: true });
    expect(mocks.runs).toHaveLength(0);
  });

  test("Enter with an empty input does not send", () => {
    render();
    press("Enter");
    expect(mocks.runs).toHaveLength(0);
  });

  test("a quick action sends its instruction", async () => {
    render();
    await startQuick("Check");
    expect(mocks.runs[0].prompt).toContain("Instruction: Fix grammar, spelling");
  });
});

describe("ClaudePanel result", () => {
  test("shows the diff with added and removed lines", async () => {
    render();
    await startQuick();
    await finish("# Plan\n\nnew line\n");
    expect(container.querySelector(".tack-diff-del")?.textContent).toContain("old line");
    expect(container.querySelector(".tack-diff-add")?.textContent).toContain("new line");
    button("Accept");
    button("Reject");
    button("Ask again");
  });

  test("Accept saves a snapshot of the full file first, then replaces the body", async () => {
    render();
    await startQuick();
    await finish("# Plan\n\nnew line\n");
    await act(async () => button("Accept").click());
    await settle();
    expect(mocks.calls).toEqual(["saveSnapshot", "replaceBody"]);
    expect(mocks.saveSnapshot).toHaveBeenCalledWith("Inbox/Plan.md", FRONTMATTER + BODY, "Before Ask Claude: Rewrite");
    expect(editor.replaceBody).toHaveBeenCalledWith("# Plan\n\nnew line\n");
    expect(container.querySelector(".tack-diff")).toBeNull();
  });

  test("the snapshot reason uses the first 40 characters of a typed instruction", async () => {
    render();
    type("Turn every paragraph into a bulleted list please, thanks");
    press("Enter");
    await finish("- new\n");
    await act(async () => button("Accept").click());
    await settle();
    expect(mocks.saveSnapshot.mock.calls[0][2]).toBe("Before Ask Claude: Turn every paragraph into a bulleted lis");
  });

  test("Reject leaves the note alone", async () => {
    render();
    await startQuick();
    await finish("# Plan\n\nnew line\n");
    await act(async () => button("Reject").click());
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
    expect(editor.replaceBody).not.toHaveBeenCalled();
    expect(container.querySelector(".tack-diff")).toBeNull();
  });

  test("Ask again runs the same instruction again", async () => {
    render();
    await startQuick("Summarize");
    await finish("# Plan\n\nnew line\n");
    await act(async () => button("Ask again").click());
    expect(mocks.runs).toHaveLength(2);
    expect(mocks.runs[1].prompt).toContain("## Summary");
  });

  test("a note that changed while Claude worked blocks Accept", async () => {
    render();
    await startQuick();
    note.body = "# Plan\n\nI typed this\n";
    await finish("# Plan\n\nnew line\n");
    await act(async () => button("Accept").click());
    await settle();
    expect(alertText()).toBe("The note changed while Claude worked. Ask again.");
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
    expect(editor.replaceBody).not.toHaveBeenCalled();
    expect(note.body).toBe("# Plan\n\nI typed this\n");
  });

  test.each<NoteSessionState>(["conflict", "loading"])("Accept is disabled while the note is %s", async (state) => {
    render();
    await startQuick();
    await finish("# Plan\n\nnew line\n");
    act(() => note.set(state));
    expect(button("Accept").disabled).toBe(true);
    act(() => note.set("ready"));
    expect(button("Accept").disabled).toBe(false);
  });

  test("a failed snapshot shows the error and does not apply", async () => {
    mocks.saveSnapshot.mockRejectedValue(new Error("Disk full"));
    render();
    await startQuick();
    await finish("# Plan\n\nnew line\n");
    await act(async () => button("Accept").click());
    await settle();
    expect(alertText()).toBe("Disk full");
    expect(editor.replaceBody).not.toHaveBeenCalled();
    button("Accept");
  });

  test("a replaceBody error is shown and the result stays", async () => {
    editor.replaceBody.mockImplementation(() => {
      throw new Error("Note is not ready");
    });
    render();
    await startQuick();
    await finish("# Plan\n\nnew line\n");
    await act(async () => button("Accept").click());
    await settle();
    expect(alertText()).toBe("Note is not ready");
    expect(container.querySelector(".tack-diff")).not.toBeNull();
  });

  test("frontmatter in Claude's answer is dropped so the note keeps its own", async () => {
    render();
    await startQuick();
    await finish("---\ntype: other\n---\n# Plan\n\nnew line\n");
    expect(container.querySelector(".tack-diff")?.textContent).not.toContain("type: other");
    await act(async () => button("Accept").click());
    await settle();
    expect(editor.replaceBody).toHaveBeenCalledWith("# Plan\n\nnew line\n");
  });

  test("an empty answer is an error and never applied", async () => {
    render();
    await startQuick();
    await finish("   \n");
    expect(alertText()).toBe("Claude returned an empty note. Nothing was changed.");
    expect(container.querySelector(".tack-diff")).toBeNull();
  });

  test("an answer with only frontmatter is empty too", async () => {
    render();
    await startQuick();
    await finish("---\ntype: other\n---\n");
    expect(alertText()).toBe("Claude returned an empty note. Nothing was changed.");
  });
});

describe("ClaudePanel errors", () => {
  test.each([
    ["missing", "Claude Code is not installed. Install it and log in, then try again."],
    ["login", 'Claude Code is not logged in. Run "claude" in a terminal and log in.'],
    ["timeout", "Claude took longer than 2 minutes. Try a shorter request."],
  ] as const)("%s shows its message", async (kind, text) => {
    render();
    await startQuick();
    await fail(new ClaudeError(kind));
    expect(alertText()).toBe(text);
    button("Rewrite");
  });

  test("failed shows the first line of the error", async () => {
    render();
    await startQuick();
    await fail(new ClaudeError("failed", "boom\nstack trace"));
    expect(alertText()).toBe("Claude failed: boom");
  });
});

describe("ClaudePanel cancel and close", () => {
  test("Cancel stops the run and returns to idle with no message", async () => {
    render();
    await startQuick();
    await act(async () => button("Cancel").click());
    await settle();
    expect(mocks.runs[0].cancel).toHaveBeenCalled();
    expect(alertText()).toBeNull();
    button("Rewrite");
    expect(container.querySelector("button")?.textContent).not.toBe("Cancel");
  });

  test("switching to another note cancels the run", async () => {
    render();
    await startQuick();
    const other = fakeSession("Inbox/Other.md");
    render(other.session, fakeEditor(other));
    await settle();
    expect(mocks.runs[0].cancel).toHaveBeenCalled();
    expect(container.textContent).not.toContain("Cancel");
  });

  test("switching notes drops a pending result", async () => {
    render();
    await startQuick();
    await finish("# Plan\n\nnew line\n");
    const other = fakeSession("Inbox/Other.md");
    render(other.session, fakeEditor(other));
    expect(container.querySelector(".tack-diff")).toBeNull();
  });

  test("closing the panel cancels the run", async () => {
    render();
    await startQuick();
    act(() => root.render(<></>));
    await settle();
    expect(mocks.runs[0].cancel).toHaveBeenCalled();
  });

  test("Esc closes only when idle", async () => {
    render();
    await startQuick();
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => button("Cancel").click());
    await settle();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("without a note the panel cannot ask", () => {
    render(null, null);
    expect(input().disabled).toBe(true);
    expect(button("Rewrite").disabled).toBe(true);
  });
});
