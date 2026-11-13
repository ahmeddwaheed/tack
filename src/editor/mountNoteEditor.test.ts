import { describe, expect, test } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { splitFrontmatter } from "../markdown/frontmatter";
import { mountNoteEditor } from "./mountNoteEditor";
import { createNoteSession, type NoteIO } from "./noteSession";

const fixtures = Object.entries(
  import.meta.glob<string>("../markdown/fixtures/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

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

describe("mountNoteEditor", () => {
  test.each(fixtures)("%s opened in the editor and closed is never written", async (_, src) => {
    const { io, writes } = fakeIO(src);
    const session = createNoteSession("Inbox/fixture.md", io);
    await session.loaded;
    const editor = await mountNoteEditor(document.createElement("div"), session);
    await wait(250);
    await editor.destroy();
    await session.close();
    expect(writes).toEqual([]);
  });

  test.each(fixtures)("%s edited in the editor keeps the frontmatter bytes", async (_, src) => {
    const { io, writes } = fakeIO(src);
    const session = createNoteSession("Inbox/fixture.md", io);
    await session.loaded;
    const editor = await mountNoteEditor(document.createElement("div"), session);
    const view = editor.crepe.editor.ctx.get(editorViewCtx);
    const end = Selection.atEnd(view.state.doc).from;
    view.dispatch(view.state.tr.insertText(" edited", end));
    await editor.destroy();
    await session.close();
    expect(writes).toHaveLength(1);
    const written = writes[0] ?? "";
    expect(written).toContain("edited");
    expect(splitFrontmatter(written).frontmatter).toBe(splitFrontmatter(src).frontmatter);
  });
});
