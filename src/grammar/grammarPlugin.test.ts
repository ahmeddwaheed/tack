import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTackCrepe } from "../markdown/pipeline";
import { grammarEditorPlugins, grammarKey, setGrammarEnabled } from "./grammarPlugin";
import type { GrammarIssue } from "./harper";

const fakeLint = vi.fn(async (text: string): Promise<GrammarIssue[]> => {
  const issues: GrammarIssue[] = [];
  for (const match of text.matchAll(/teh/g)) {
    issues.push({
      start: match.index,
      end: match.index + 3,
      message: "Did you mean the?",
      suggestions: ["the", "tech", "ten", "tea", "tee", "tel"],
    });
  }
  return issues;
});

let crepe: Crepe | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  fakeLint.mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
  await crepe?.destroy();
  crepe = null;
  document.body.replaceChildren();
});

async function open(initial: string, enabled = true, lint = fakeLint): Promise<EditorView> {
  const root = document.createElement("div");
  document.body.append(root);
  crepe = createTackCrepe({ root, defaultValue: initial }, grammarEditorPlugins(lint, enabled));
  await crepe.create();
  return crepe.editor.ctx.get(editorViewCtx);
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(400);
};

const underlines = (view: EditorView) =>
  (grammarKey.getState(view.state)?.decorations.find() ?? []).map((deco) => ({
    from: deco.from,
    to: deco.to,
    text: view.state.doc.textBetween(deco.from, deco.to),
  }));

const clickAt = (view: EditorView, pos: number) =>
  view.someProp("handleClick", (f) => f(view, pos, new MouseEvent("click"))) ?? false;

const popover = () => document.querySelector<HTMLElement>(".tack-grammar-popover:not([hidden])");
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>(".tack-grammar-popover button")];

describe("grammar plugin", () => {
  test("underlines exactly the flagged range in a paragraph", async () => {
    const view = await open("Fix teh typo.\n");
    await settle();
    expect(underlines(view)).toEqual([{ from: 5, to: 8, text: "teh" }]);
  });

  test("maps ranges around a wikilink atom onto the original text", async () => {
    const view = await open("See [[Note]] and teh end.\n");
    await settle();
    expect(underlines(view).map((u) => u.text)).toEqual(["teh"]);
  });

  test("does not flag text inside inline code, code blocks, wikilinks or urls", async () => {
    const view = await open("Use `teh` here and [[teh]] and https://teh.example/teh now.\n\n```\nteh\n```\n");
    await settle();
    expect(underlines(view)).toEqual([]);
  });

  test("still checks link text but not the href", async () => {
    const view = await open("[teh link](https://teh.example)\n");
    await settle();
    expect(underlines(view).map((u) => u.text)).toEqual(["teh"]);
  });

  test("drops an issue that spans a skipped atom", async () => {
    const lint = vi.fn(async (text: string) => [{ start: 0, end: text.length, message: "m", suggestions: [] }]);
    const view = await open("one [[Note]] two\n", true, lint);
    await settle();
    expect(underlines(view)).toEqual([]);
  });

  test("a disabled plugin lints nothing and shows no underlines", async () => {
    const view = await open("Fix teh typo.\n", false);
    await settle();
    expect(fakeLint).not.toHaveBeenCalled();
    expect(underlines(view)).toEqual([]);
  });

  test("toggling takes effect in an open editor", async () => {
    const view = await open("Fix teh typo.\n");
    await settle();
    setGrammarEnabled(view, false);
    expect(underlines(view)).toEqual([]);
    fakeLint.mockClear();
    setGrammarEnabled(view, true);
    await settle();
    expect(underlines(view).map((u) => u.text)).toEqual(["teh"]);
  });

  test("waits for typing to stop before linting", async () => {
    const view = await open("Fix typo.\n");
    await settle();
    fakeLint.mockClear();
    view.dispatch(view.state.tr.insertText(" teh", 9));
    await vi.advanceTimersByTimeAsync(200);
    expect(fakeLint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(fakeLint).toHaveBeenCalledTimes(1);
  });

  test("drops a result when the block changed after the lint was requested", async () => {
    let release: (issues: GrammarIssue[]) => void = () => {};
    const slow = vi.fn(
      () =>
        new Promise<GrammarIssue[]>((resolve) => {
          release = resolve;
        }),
    );
    const view = await open("Fix teh typo.\n", true, slow);
    await vi.advanceTimersByTimeAsync(400);
    view.dispatch(view.state.tr.insertText("X", 1));
    release([{ start: 4, end: 7, message: "m", suggestions: [] }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(underlines(view)).toEqual([]);
  });

  test("a failing lint leaves the editor working", async () => {
    const broken = vi.fn(async () => {
      throw new Error("no worker");
    });
    const view = await open("Fix teh typo.\n", true, broken);
    await settle();
    expect(underlines(view)).toEqual([]);
  });

  describe("popover", () => {
    test("clicking an underline shows the message, at most 5 suggestions and Ignore", async () => {
      const view = await open("Fix teh typo.\n");
      await settle();
      clickAt(view, 6);
      expect(popover()?.textContent).toContain("Did you mean the?");
      expect(buttons().map((b) => b.textContent)).toEqual(["the", "tech", "ten", "tea", "tee", "Ignore"]);
    });

    test("clicking elsewhere shows no popover", async () => {
      const view = await open("Fix teh typo.\n");
      await settle();
      clickAt(view, 2);
      expect(popover()).toBeNull();
    });

    test("choosing a suggestion replaces exactly the range in one undo step", async () => {
      const view = await open("Fix teh typo.\n");
      await settle();
      const before = view.state.doc.textContent;
      clickAt(view, 6);
      buttons()[0]?.click();
      expect(view.state.doc.textContent).toBe("Fix the typo.");
      expect(popover()).toBeNull();
      const { undo } = await import("@milkdown/kit/prose/history");
      undo(view.state, view.dispatch);
      expect(view.state.doc.textContent).toBe(before);
    });

    test("Ignore hides that issue for the session", async () => {
      const view = await open("Fix teh typo and teh other.\n");
      await settle();
      expect(underlines(view)).toHaveLength(2);
      clickAt(view, 6);
      buttons()[buttons().length - 1]?.click();
      expect(underlines(view)).toEqual([]);
      expect(popover()).toBeNull();
      view.dispatch(view.state.tr.insertText("!", 1));
      await settle();
      expect(underlines(view)).toEqual([]);
    });

    test("typing closes the popover", async () => {
      const view = await open("Fix teh typo.\n");
      await settle();
      clickAt(view, 6);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)).insertText("a", 1));
      expect(popover()).toBeNull();
    });
  });
});
