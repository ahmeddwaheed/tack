import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { NoteSession } from "../editor/noteSession";
import { MainWindow } from "./MainWindow";
import type { OpenNote } from "./noteGuard";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  closed: [] as string[],
  dirty: false,
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  windowCalls: [] as string[],
  onClose: null as null | ((event: { preventDefault(): void }) => Promise<void>),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: (event: { preventDefault(): void }) => Promise<void>) => {
      mocks.onClose = handler;
      return () => undefined;
    },
    destroy: async () => void mocks.windowCalls.push("destroy"),
    hide: async () => void mocks.windowCalls.push("hide"),
    show: async () => void mocks.windowCalls.push("show"),
    setFocus: async () => void mocks.windowCalls.push("focus"),
  }),
}));
vi.mock("../search/vaultIndex", () => ({
  startVaultIndex: () => () => undefined,
}));
vi.mock("../editor/Editor", () => ({
  Editor: ({ path, onOpen }: { path: string; onOpen?(note: OpenNote | null): void }) => {
    useEffect(() => {
      const session = {
        path,
        state: "ready",
        get dirty() {
          return mocks.dirty;
        },
        flush: async () => undefined,
        close: async () => {
          mocks.closed.push(path);
        },
      } as unknown as NoteSession;
      onOpen?.({ session, sync: () => undefined, revealConflict: () => undefined });
      return () => onOpen?.(null);
    }, [path, onOpen]);
    return <div data-testid="editor">{path}</div>;
  },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rawNote = (path: string, modified_ms: number) => ({
  path,
  title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  folder: path.split("/")[0],
  modified_ms,
  placeholder: false,
});

const settings = {
  vault_root: null,
  capture_hotkey: "Alt+Space",
  grammar_enabled: true,
  always_on_top: false,
  pinned: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.closed.length = 0;
  mocks.dirty = false;
  mocks.listeners.clear();
  mocks.windowCalls.length = 0;
  mocks.onClose = null;
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "list_notes") return [rawNote("Inbox/A.md", 200), rawNote("Inbox/B.md", 100)];
    if (command === "get_settings") return settings;
    return undefined;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const button = (label: string, scope: ParentNode = container) => {
  const found = [...scope.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label));
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

const listButton = (title: string) => {
  const list = container.querySelector(".tack-note-list");
  if (!list) throw new Error("no note list");
  return button(title, list);
};

describe("MainWindow trash", () => {
  test("confirming trashes the note the dialog named, even after switching to another note", async () => {
    act(() => root.render(<MainWindow />));
    await settle();
    expect(container.querySelector('[data-testid="editor"]')?.textContent).toBe("Inbox/A.md");

    await act(async () => button("Trash").click());
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('Move "A" to Trash?');

    await act(async () => listButton("B").click());
    await settle();
    expect(container.querySelector('[data-testid="editor"]')?.textContent).toBe("Inbox/B.md");

    await act(async () => button("Move to Trash").click());
    await settle();

    const trashed = mocks.invoke.mock.calls.filter(([command]) => command === "trash_note");
    expect(trashed).toEqual([["trash_note", { path: "Inbox/A.md" }]]);
    expect(mocks.closed).toEqual(["Inbox/A.md"]);
    expect(container.querySelector('[data-testid="editor"]')?.textContent).toBe("Inbox/B.md");
  });
});

describe("MainWindow unsaved edits", () => {
  test("switching away from a note that could not be saved asks first", async () => {
    act(() => root.render(<MainWindow />));
    await settle();
    mocks.dirty = true;

    await act(async () => listButton("B").click());
    await settle();
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Couldn\'t save "A". Close anyway?');
    expect([...(dialog?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Keep editing",
      "Discard changes",
    ]);
    expect(document.activeElement?.textContent).toBe("Keep editing");

    await act(async () => button("Keep editing").click());
    await settle();
    expect(container.querySelector('[data-testid="editor"]')?.textContent).toBe("Inbox/A.md");
    expect(mocks.closed).toEqual([]);

    await act(async () => listButton("B").click());
    await settle();
    await act(async () => button("Discard changes").click());
    await settle();
    expect(container.querySelector('[data-testid="editor"]')?.textContent).toBe("Inbox/B.md");
    expect(mocks.closed).toEqual(["Inbox/A.md"]);
  });
});

describe("MainWindow quick capture", () => {
  test("a saved capture flashes \"Saved to Inbox\" and refreshes the note list", async () => {
    act(() => root.render(<MainWindow />));
    await settle();
    const listed = () => mocks.invoke.mock.calls.filter(([command]) => command === "list_notes").length;
    const before = listed();
    expect(container.querySelector('[role="status"]')?.textContent ?? "").toBe("");

    await act(async () =>
      mocks.listeners.get("capture-saved")?.({ payload: rawNote("Inbox/2026-11-13 1405 call mom.md", 300) }),
    );
    await settle();

    expect(container.querySelector('[role="status"]')?.textContent).toBe("Saved to Inbox");
    expect(listed()).toBe(before + 1);
  });
});

describe("MainWindow close and quit", () => {
  test("closing the window saves the note and hides the window instead of quitting", async () => {
    act(() => root.render(<MainWindow />));
    await settle();
    await act(async () => mocks.onClose?.({ preventDefault: () => undefined }));
    await settle();
    expect(mocks.closed).toEqual(["Inbox/A.md"]);
    expect(mocks.windowCalls).toEqual(["hide"]);
    expect(container.querySelector('[data-testid="editor"]')?.textContent).toBe("Inbox/A.md");
  });

  test("quit from the menu saves the note and destroys the window", async () => {
    act(() => root.render(<MainWindow />));
    await settle();
    await act(async () => mocks.listeners.get("quit-requested")?.({ payload: null }));
    await settle();
    expect(mocks.closed).toEqual(["Inbox/A.md"]);
    expect(mocks.windowCalls).toEqual(["destroy"]);
  });
});

describe("MainWindow capture hotkey", () => {
  test("a hotkey that could not be registered shows a banner and can be changed from the palette", async () => {
    const base = mocks.invoke.getMockImplementation();
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "unavailable_capture_hotkey") return "Alt+Space";
      if (command === "set_capture_hotkey" && (args as { accel: string }).accel === "Alt+Space") {
        throw new Error("HotKey already registered");
      }
      return base?.(command, args);
    });
    act(() => root.render(<MainWindow />));
    await settle();
    expect(container.textContent).toContain(
      "Quick capture hotkey ⌥Space is not available. Change it in ⌘K → Change capture hotkey.",
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    });
    const option = [...container.querySelectorAll('[role="option"]')].find(
      (o) => o.textContent === "Change capture hotkey…",
    ) as HTMLElement;
    await act(async () => option.click());
    const input = container.querySelector("#tack-hotkey") as HTMLInputElement;
    expect(input.value).toBe("Alt+Space");
    await act(async () => button("Save").click());
    await settle();
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("HotKey already registered");

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "Ctrl+Shift+Space");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save").click());
    await settle();
    expect(mocks.invoke).toHaveBeenCalledWith("set_capture_hotkey", { accel: "Ctrl+Shift+Space" });
    expect(container.querySelector("#tack-hotkey")).toBeNull();
    expect(container.textContent).not.toContain("is not available");
  });
});
