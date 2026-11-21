import { describe, expect, test } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { Selection } from "@milkdown/kit/prose/state";
import { splitFrontmatter } from "../markdown/frontmatter";
import { mountNoteEditor, type NoteEditor } from "./mountNoteEditor";
import { AUTOSAVE_DELAY_MS, createNoteSession, type NoteIO } from "./noteSession";

const FRONTMATTER = "---\ntype: note\ntags: [a, b]\n---\n";
const SRC = `${FRONTMATTER}# Hello\n\nWorld.\n`;

function fakeIO(src: string) {
  const writes: string[] = [];
  const io: NoteIO = {
    read: () => Promise.resolve(src),
    write: async (_, content) => {
      writes.push(content);
    },
    rename: async (path) => path,
  };
  return { io, writes };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(src = SRC) {
  const { io, writes } = fakeIO(src);
  const session = createNoteSession("Inbox/Hello.md", io);
  await session.loaded;
  const editor = await mountNoteEditor(document.createElement("div"), session);
  return { session, editor, writes };
}

const viewOf = (editor: NoteEditor) => editor.crepe.editor.ctx.get(editorViewCtx);

describe("NoteEditor.replaceBody", () => {
  test("marks the session dirty at once and autosaves the new body with the original frontmatter", async () => {
    const { session, editor, writes } = await open();
    editor.replaceBody("# Rewritten\n\nA new body.\n");
    expect(session.dirty).toBe(true);
    expect(session.body).toBe("# Rewritten\n\nA new body.\n");
    await wait(AUTOSAVE_DELAY_MS + 100);
    expect(writes).toHaveLength(1);
    const written = splitFrontmatter(writes[0] ?? "");
    expect(written.frontmatter).toBe(splitFrontmatter(SRC).frontmatter);
    expect(written.body).toBe("# Rewritten\n\nA new body.\n");
    await editor.destroy();
    await session.close();
    expect(writes).toHaveLength(1);
  });

  test("one undo restores the previous document, including unsaved typing", async () => {
    const { session, editor } = await open();
    const view = viewOf(editor);
    view.dispatch(view.state.tr.insertText(" typed", Selection.atEnd(view.state.doc).from));
    const before = view.state.doc;
    editor.replaceBody("Completely different.\n");
    expect(view.state.doc.eq(before)).toBe(false);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
    await editor.destroy();
    await session.close();
  });

  test("throws and changes nothing while the session is in conflict", async () => {
    const { session, editor, writes } = await open();
    const view = viewOf(editor);
    view.dispatch(view.state.tr.insertText("!", Selection.atEnd(view.state.doc).from));
    editor.sync();
    session.onDiskChange(`${FRONTMATTER}# Hello\n\nFrom the phone.\n`);
    expect(session.state).toBe("conflict");
    const doc = view.state.doc;
    const body = session.body;
    expect(() => editor.replaceBody("Nope.\n")).toThrow("Note is not ready");
    expect(view.state.doc.eq(doc)).toBe(true);
    expect(session.body).toBe(body);
    expect(writes).toEqual([]);
  });

  test("wikilinks in the new body stay links, not escaped text", async () => {
    const { session, editor } = await open();
    const next = "See [[Note]] and [[Sam|my manager]].\n";
    editor.replaceBody(next);
    expect(session.body).toBe(next);
    expect(viewOf(editor).state.doc.firstChild?.childCount).toBeGreaterThan(1);
    await editor.destroy();
    await session.close();
  });

  test("currentBody flushes a pending edit and returns the body the session would write", async () => {
    const { session, editor } = await open();
    expect(editor.currentBody()).toBe(session.body);
    const view = viewOf(editor);
    view.dispatch(view.state.tr.insertText(" typed", Selection.atEnd(view.state.doc).from));
    const current = editor.currentBody();
    expect(current).toContain("World. typed");
    expect(session.body).toBe(current);
    await editor.destroy();
    await session.close();
  });
});
