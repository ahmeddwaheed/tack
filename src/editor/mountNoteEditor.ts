import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node } from "@milkdown/kit/prose/model";
import { createTackCrepe } from "../markdown/pipeline";
import { grammarEditorPlugins, setGrammarEnabled, type GrammarLint } from "../grammar/grammarPlugin";
import { linkPicker, type TitleSearch } from "./linkPicker";
import type { NoteSession } from "./noteSession";

export interface NoteEditor {
  crepe: Crepe;
  sync(): void;
  setGrammarEnabled(enabled: boolean): void;
  destroy(): Promise<void>;
}

const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)*/;

export interface GrammarOptions {
  lint: GrammarLint;
  enabled: boolean;
}

export async function mountNoteEditor(
  root: HTMLElement,
  session: NoteSession,
  searchTitles?: TitleSearch,
  grammar?: GrammarOptions,
): Promise<NoteEditor> {
  const lead = LEADING_BLANK_LINES.exec(session.body)?.[0] ?? "";
  const revision = session.revision;
  const crepe = createTackCrepe(
    { root, defaultValue: session.body },
    [...(searchTitles ? linkPicker(searchTitles) : []), ...(grammar ? grammarEditorPlugins(grammar.lint, grammar.enabled) : [])],
  );
  let baseline: Node | null = null;
  let touched = false;
  let destroyed = false;

  const sync = () => {
    // After a reload or "theirs" the session body is newer than this editor; syncing would write stale text back.
    if (destroyed || baseline === null || session.revision !== revision) return;
    const doc = crepe.editor.ctx.get(editorViewCtx).state.doc;
    // Crepe normalizes on load, so only a real change to the document may reach the session.
    if (!touched && doc.eq(baseline)) return;
    touched = true;
    session.edit(lead + crepe.getMarkdown());
  };

  crepe.on((api) => api.markdownUpdated(sync));
  await crepe.create();
  baseline = crepe.editor.ctx.get(editorViewCtx).state.doc;

  return {
    crepe,
    sync,
    setGrammarEnabled(enabled) {
      if (!destroyed && grammar) setGrammarEnabled(crepe.editor.ctx.get(editorViewCtx), enabled);
    },
    async destroy() {
      if (destroyed) return;
      sync();
      destroyed = true;
      await crepe.destroy();
    },
  };
}
