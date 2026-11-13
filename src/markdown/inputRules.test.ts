import { describe, expect, test } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTackCrepe } from "./pipeline";

function typeText(view: EditorView, text: string) {
  for (const char of text) {
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
    if (!handled) view.dispatch(deflt());
  }
}

async function typeInto(initial: string, text: string): Promise<string> {
  const crepe = createTackCrepe({ root: document.createElement("div"), defaultValue: initial });
  await crepe.create();
  try {
    const view = crepe.editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    typeText(view, text);
    return crepe.getMarkdown();
  } finally {
    await crepe.destroy();
  }
}

describe("typed wikilinks and callouts", () => {
  test("typed [[Target]] becomes a wikilink", async () => {
    const out = await typeInto("", "See [[Target]] now");
    expect(out).toBe("See [[Target]] now\n");
  });

  test("typed [[Target|alias]] and ![[file.png]] are not escaped", async () => {
    const out = await typeInto("", "A [[Target|alias]] and ![[file.png]]");
    expect(out).toContain("[[Target|alias]]");
    expect(out).toContain("![[file.png]]");
    expect(out).not.toContain("\\[");
    expect(out).not.toContain("\\!");
  });

  test("typed [!note] at the start of a blockquote becomes a callout marker", async () => {
    const out = await typeInto("", "> [!note] Title");
    expect(out).toBe("> [!note] Title\n");
  });

  test("typed [!warning]- callout with fold marker is not escaped", async () => {
    const out = await typeInto("", "> [!warning]- Careful");
    expect(out).toBe("> [!warning]- Careful\n");
  });

  test("[!note] outside a blockquote start stays escaped text", async () => {
    const out = await typeInto("", "> Some [!note]");
    expect(out).toBe("> Some \\[!note]\n");
  });

  test("[[x]] inside inline code is not converted", async () => {
    const out = await typeInto("", "`[[x]]` done");
    expect(out).toBe("`[[x]]` done\n");
  });
});
