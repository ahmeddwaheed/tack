import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

const SRC = "---\ntype: note\n---\nMine.\n";
const THEIRS = "---\ntype: note\n---\nTheirs from the phone.\n";

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

function fakeIO() {
  const writes: string[] = [];
  const io: NoteIO = {
    read: () => Promise.resolve(SRC),
    write: async (_, content) => {
      writes.push(content);
    },
    rename: async (path) => path,
  };
  return { io, writes };
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function typeAtEnd(editor: NoteEditor, text: string) {
  const view = editor.crepe.editor.ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.insertText(text, Selection.atEnd(view.state.doc).from));
}

async function openEditor() {
  const { io, writes } = fakeIO();
  act(() => root.render(<Editor path="Inbox/Note.md" io={io} />));
  await wait(50);
  const session = sessions[sessions.length - 1];
  const editor = editors[editors.length - 1];
  if (!session || !editor) throw new Error("editor not mounted");
  return { session, editor, writes };
}

describe("Editor remount after a revision change", () => {
  test("a clean disk reload after a saved edit shows theirs and writes nothing more", async () => {
    const { session, editor, writes } = await openEditor();
    typeAtEnd(editor, " edited");
    await wait(900);
    expect(writes).toHaveLength(1);
    act(() => session.onDiskChange(THEIRS));
    await wait(1000);
    expect(writes).toHaveLength(1);
    expect(session.body).toBe("Theirs from the phone.\n");
    expect(container.querySelector(".milkdown")?.textContent).toContain("Theirs from the phone.");
    act(() => root.unmount());
    await wait(50);
    expect(writes).toHaveLength(1);
  });

  test("resolving a conflict with theirs keeps theirs and writes nothing", async () => {
    const { session, editor, writes } = await openEditor();
    typeAtEnd(editor, " edited");
    await wait(250);
    expect(session.dirty).toBe(true);
    act(() => session.onDiskChange(THEIRS));
    expect(session.state).toBe("conflict");
    await act(() => session.resolve("theirs"));
    await wait(1000);
    expect(writes).toEqual([]);
    expect(session.body).toBe("Theirs from the phone.\n");
    expect(container.querySelector(".milkdown")?.textContent).toContain("Theirs from the phone.");
    act(() => root.unmount());
    await wait(50);
    expect(writes).toEqual([]);
  });
});
