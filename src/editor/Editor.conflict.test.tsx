import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OpenNote } from "../layout/noteGuard";
import { Editor } from "./Editor";
import type { NoteEditor } from "./mountNoteEditor";
import type { NoteIO, NoteSession } from "./noteSession";

const sessions: NoteSession[] = [];
const editors: NoteEditor[] = [];

vi.mock("./noteSession", async (importOriginal) => {
  const original = await importOriginal<typeof import("./noteSession")>();
  return {
    ...original,
    createNoteSession: (path: string, io: NoteIO) => {
      const session = original.createNoteSession(path, io);
      sessions.push(session);
      return session;
    },
  };
});

vi.mock("./mountNoteEditor", async (importOriginal) => {
  const original = await importOriginal<typeof import("./mountNoteEditor")>();
  return {
    ...original,
    mountNoteEditor: async (root: HTMLElement, session: NoteSession) => {
      const editor = await original.mountNoteEditor(root, session);
      editors.push(editor);
      return editor;
    },
  };
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const PATH = "Inbox/Note.md";
const MINE = "---\ntype: note\n---\nMine.\n";
const THEIRS = "---\ntype: note\n---\nTheirs from the phone.\n";
const BANNER = "This note changed on another device.";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  sessions.length = 0;
  editors.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
});

function fakeDisk() {
  const disk = new Map<string, string>([
    [PATH, MINE],
    ["Inbox/Other.md", "Other.\n"],
  ]);
  const writes: { path: string; content: string }[] = [];
  const reads: string[] = [];
  const watchers = new Set<(paths: string[]) => void>();
  const io: NoteIO = {
    read: async (path) => {
      reads.push(path);
      const content = disk.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    write: async (path, content) => {
      writes.push({ path, content });
      disk.set(path, content);
    },
    rename: async (path) => path,
    watch: async (onChange) => {
      watchers.add(onChange);
      return () => watchers.delete(onChange);
    },
  };
  const phoneEdits = (path: string, content: string) => {
    disk.set(path, content);
    watchers.forEach((watcher) => watcher([path]));
  };
  return { io, disk, writes, reads, watchers, phoneEdits };
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function typeAtEnd(editor: NoteEditor, text: string) {
  const view = editor.crepe.editor.ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.insertText(text, Selection.atEnd(view.state.doc).from));
}

const banner = () => container.querySelector('[role="alertdialog"]');
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === label);
const shownText = () => container.querySelector(".milkdown")?.textContent ?? "";

async function openNote(onConflictChange?: (conflict: boolean) => void) {
  const disk = fakeDisk();
  act(() => root.render(<Editor path={PATH} io={disk.io} onConflictChange={onConflictChange} />));
  await wait(50);
  const session = sessions[sessions.length - 1];
  const editor = editors[editors.length - 1];
  if (!session || !editor) throw new Error("editor not mounted");
  return { ...disk, session, editor };
}

describe("Editor external edits", () => {
  test("a clean external change reloads the editor without a banner or a write", async () => {
    const { session, writes, phoneEdits } = await openNote();
    phoneEdits(PATH, THEIRS);
    await wait(100);
    expect(session.state).toBe("ready");
    expect(shownText()).toContain("Theirs from the phone.");
    expect(banner()).toBeNull();
    await wait(800);
    expect(writes).toEqual([]);
  });

  test("keystrokes still inside the editor debounce become a conflict, not a reload", async () => {
    const { session, editor, writes, phoneEdits } = await openNote();
    typeAtEnd(editor, " typed");
    expect(session.dirty).toBe(false);
    phoneEdits(PATH, THEIRS);
    await wait(100);
    expect(session.state).toBe("conflict");
    expect(session.body).toBe("Mine. typed\n");
    expect(shownText()).toContain("Mine. typed");
    await wait(1000);
    expect(writes).toEqual([]);
  });

  test("the conflict banner offers keep mine and use theirs", async () => {
    const { editor, phoneEdits } = await openNote();
    typeAtEnd(editor, " typed");
    await wait(250);
    phoneEdits(PATH, THEIRS);
    await wait(100);
    expect(banner()?.textContent).toContain(BANNER);
    expect(button("Keep mine")).toBeDefined();
    expect(button("Use theirs")).toBeDefined();
  });

  test("keep mine writes the local text over theirs", async () => {
    const { session, editor, writes, disk, phoneEdits } = await openNote();
    typeAtEnd(editor, " typed");
    await wait(250);
    phoneEdits(PATH, THEIRS);
    await wait(100);
    await act(async () => button("Keep mine")?.click());
    await wait(100);
    expect(session.state).toBe("ready");
    expect(banner()).toBeNull();
    expect(writes).toEqual([{ path: PATH, content: "---\ntype: note\n---\nMine. typed\n" }]);
    expect(disk.get(PATH)).toBe("---\ntype: note\n---\nMine. typed\n");
  });

  test("use theirs shows their text and writes nothing", async () => {
    const { session, editor, writes, phoneEdits } = await openNote();
    typeAtEnd(editor, " typed");
    await wait(250);
    phoneEdits(PATH, THEIRS);
    await wait(100);
    await act(async () => button("Use theirs")?.click());
    await wait(1000);
    expect(session.state).toBe("ready");
    expect(banner()).toBeNull();
    expect(shownText()).toContain("Theirs from the phone.");
    expect(writes).toEqual([]);
  });

  test("changes to other notes are not read", async () => {
    const { reads, phoneEdits } = await openNote();
    phoneEdits("Inbox/Other.md", "Changed.\n");
    await wait(100);
    expect(reads).toEqual([PATH]);
  });

  test("the echo of our own save does not reload or conflict", async () => {
    const { session, editor, writes, watchers } = await openNote();
    typeAtEnd(editor, " typed");
    await wait(900);
    expect(writes).toHaveLength(1);
    const revision = session.revision;
    watchers.forEach((watcher) => watcher([PATH]));
    await wait(100);
    expect(session.state).toBe("ready");
    expect(session.revision).toBe(revision);
  });

  test("switching notes during a conflict keeps the note open until the user picks", async () => {
    const onConflictChange = vi.fn();
    const { session, editor, writes, reads, io, phoneEdits } = await openNote(onConflictChange);
    typeAtEnd(editor, " typed");
    await wait(250);
    phoneEdits(PATH, THEIRS);
    await wait(100);
    expect(onConflictChange).toHaveBeenLastCalledWith(true);
    act(() => root.render(<Editor path="Inbox/Other.md" io={io} onConflictChange={onConflictChange} />));
    await wait(100);
    expect(sessions).toEqual([session]);
    expect(reads).not.toContain("Inbox/Other.md");
    expect(banner()?.textContent).toContain(BANNER);
    expect(session.body).toBe("Mine. typed\n");
    expect(writes).toEqual([]);
    await act(async () => button("Keep mine")?.click());
    await wait(100);
    expect(onConflictChange).toHaveBeenLastCalledWith(false);
    expect(writes).toEqual([{ path: PATH, content: "---\ntype: note\n---\nMine. typed\n" }]);
  });

  test("unmounting stops watching", async () => {
    const { watchers } = await openNote();
    expect(watchers.size).toBe(1);
    act(() => root.unmount());
    await wait(50);
    expect(watchers.size).toBe(0);
  });
});

describe("Editor open note handle", () => {
  test("hands out the session, syncs pending keystrokes and focuses the banner on request", async () => {
    const handles: (OpenNote | null)[] = [];
    const disk = fakeDisk();
    act(() => root.render(<Editor path={PATH} io={disk.io} onOpen={(note) => handles.push(note)} />));
    await wait(50);
    const session = sessions[sessions.length - 1];
    const editor = editors[editors.length - 1];
    const handle = handles[handles.length - 1];
    expect(handle?.session).toBe(session);
    typeAtEnd(editor, " typed");
    handle?.sync();
    expect(session.body).toBe("Mine. typed\n");
    disk.phoneEdits(PATH, THEIRS);
    await wait(100);
    act(() => handle?.revealConflict());
    expect(document.activeElement).toBe(banner());
    act(() => root.unmount());
    expect(handles[handles.length - 1]).toBeNull();
  });
});
