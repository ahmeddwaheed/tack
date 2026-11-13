import { afterEach, describe, expect, test } from "vitest";
import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTackCrepe } from "../markdown/pipeline";
import { linkPicker } from "./linkPicker";

const TITLES = ["Workshop sync", "Weekly review", "Kubernetes"];

const searchTitles = (query: string) =>
  TITLES.filter((title) => title.toLowerCase().includes(query.toLowerCase()));

let crepe: Crepe | null = null;

afterEach(async () => {
  await crepe?.destroy();
  crepe = null;
});

async function open(initial = ""): Promise<EditorView> {
  const root = document.createElement("div");
  document.body.append(root);
  crepe = createTackCrepe({ root, defaultValue: initial }, linkPicker(searchTitles));
  await crepe.create();
  const view = crepe.editor.ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
  return view;
}

function typeText(view: EditorView, text: string) {
  for (const char of text) {
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
    if (!handled) view.dispatch(deflt());
  }
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  return view.someProp("handleKeyDown", (f) => f(view, event)) ?? false;
}

const popup = () => document.querySelector<HTMLElement>(".tack-link-picker");
const options = () => [...document.querySelectorAll(".tack-link-picker [role=option]")].map((el) => el.textContent);

describe("[[ link picker", () => {
  test("typing [[ shows titles filtered by the query", async () => {
    const view = await open();
    typeText(view, "See [[w");
    expect(popup()?.hidden).toBe(false);
    expect(options()).toEqual(["Workshop sync", "Weekly review"]);
    typeText(view, "ork");
    expect(options()).toEqual(["Workshop sync"]);
  });

  test("Enter inserts a wikilink node that saves as [[Title]] unescaped", async () => {
    const view = await open();
    typeText(view, "See [[wor");
    expect(press(view, "Enter")).toBe(true);
    typeText(view, " now");
    const markdown = crepe?.getMarkdown() ?? "";
    expect(markdown).toBe("See [[Workshop sync]] now\n");
    expect(markdown).not.toContain("\\[");
    expect(view.state.doc.firstChild?.child(1).type.name).toBe("wikilink");
    expect(popup()?.hidden ?? true).toBe(true);
  });

  test("arrow keys choose another title", async () => {
    const view = await open();
    typeText(view, "[[w");
    press(view, "ArrowDown");
    press(view, "Enter");
    expect(crepe?.getMarkdown()).toBe("[[Weekly review]]\n");
  });

  test("Esc closes the picker and keeps the typed text", async () => {
    const view = await open();
    typeText(view, "See [[wor");
    expect(press(view, "Escape")).toBe(true);
    expect(popup()?.hidden ?? true).toBe(true);
    expect(view.state.doc.textContent).toBe("See [[wor");
    typeText(view, "k");
    expect(popup()?.hidden ?? true).toBe(true);
    expect(view.state.doc.textContent).toBe("See [[work");
  });

  test("typing the closing brackets still makes a wikilink", async () => {
    const view = await open();
    typeText(view, "See [[Target]] now");
    expect(crepe?.getMarkdown()).toBe("See [[Target]] now\n");
    expect(popup()?.hidden ?? true).toBe(true);
  });

  test("no picker inside inline code", async () => {
    const view = await open();
    typeText(view, "`[[w");
    expect(popup()?.hidden ?? true).toBe(true);
  });
});
