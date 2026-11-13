import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { GrammarIssue } from "./harper";

export type GrammarLint = (text: string) => Promise<GrammarIssue[]>;

interface GrammarState {
  enabled: boolean;
  decorations: DecorationSet;
  ignored: ReadonlySet<string>;
}

type GrammarMeta =
  | { type: "enabled"; enabled: boolean }
  | { type: "result"; from: number; to: number; decorations: Decoration[] }
  | { type: "ignore"; key: string };

interface IssueSpec {
  key: string;
  issue: GrammarIssue;
}

interface BlockText {
  text: string;
  positions: number[];
}

const DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 5;
const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const SKIPPED_BLOCKS = new Set(["raw_block"]);

export const grammarKey = new PluginKey<GrammarState>("tackGrammar");

const isLintable = (node: ProseNode) =>
  node.isTextblock && !node.type.spec.code && !SKIPPED_BLOCKS.has(node.type.name);

function urlRanges(text: string): [number, number][] {
  return [...text.matchAll(URL_PATTERN)].map((match) => [match.index, match.index + match[0].length]);
}

export function blockText(block: ProseNode, blockPos: number): BlockText {
  let text = "";
  const positions: number[] = [];
  let afterSkip = false;
  const push = (char: string, pos: number) => {
    if (afterSkip && /\s/.test(char) && /\s$/.test(text)) return;
    afterSkip = false;
    text += char;
    positions.push(pos);
  };
  block.forEach((child, offset) => {
    const start = blockPos + 1 + offset;
    if (child.isText) {
      if (child.marks.some((mark) => mark.type.spec.code)) {
        afterSkip = true;
        return;
      }
      const value = child.text ?? "";
      const urls = urlRanges(value);
      for (let i = 0; i < value.length; i++) {
        if (urls.some(([from, to]) => i >= from && i < to)) {
          afterSkip = true;
          continue;
        }
        push(value[i] ?? "", start + i);
      }
    } else if (child.type.name.includes("break")) {
      afterSkip = false;
      text += "\n";
      positions.push(start);
    } else {
      afterSkip = true;
    }
  });
  return { text, positions };
}

const issueKey = (issue: GrammarIssue, text: string) => `${issue.message}\u0000${text.slice(issue.start, issue.end)}`;

function decorate({ text, positions }: BlockText, issues: GrammarIssue[], ignored: ReadonlySet<string>) {
  const decorations: Decoration[] = [];
  for (const issue of issues) {
    if (issue.end <= issue.start) continue;
    const first = positions[issue.start];
    const last = positions[issue.end - 1];
    if (first === undefined || last === undefined || last - first !== issue.end - issue.start - 1) continue;
    const key = issueKey(issue, text);
    if (ignored.has(key)) continue;
    decorations.push(Decoration.inline(first, last + 1, { class: "tack-grammar" }, { key, issue } satisfies IssueSpec));
  }
  return decorations;
}

const findBlock = (doc: ProseNode, target: ProseNode): number => {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node === target) {
      found = pos;
      return false;
    }
    return !node.isTextblock;
  });
  return found;
};

const sendMeta = (view: EditorView, meta: GrammarMeta) =>
  view.dispatch(view.state.tr.setMeta(grammarKey, meta).setMeta("addToHistory", false));

export const setGrammarEnabled = (view: EditorView, enabled: boolean) => sendMeta(view, { type: "enabled", enabled });

class Popover {
  private readonly dom = document.createElement("div");
  private readonly onPointerDown = (event: Event) => {
    if (!this.dom.contains(event.target as globalThis.Node)) this.hide();
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hide();
  };

  constructor(private readonly view: EditorView) {
    this.dom.className = "tack-grammar-popover";
    this.dom.hidden = true;
    document.body.append(this.dom);
  }

  show(from: number, to: number, spec: IssueSpec) {
    const message = document.createElement("p");
    message.textContent = spec.issue.message;
    const actions = document.createElement("div");
    actions.className = "tack-grammar-actions";
    for (const suggestion of spec.issue.suggestions.slice(0, MAX_SUGGESTIONS)) {
      actions.append(this.button(suggestion === "" ? "Remove" : suggestion, () => this.apply(from, to, suggestion)));
    }
    actions.append(
      this.button("Ignore", () => {
        this.hide();
        sendMeta(this.view, { type: "ignore", key: spec.key });
      }),
    );
    this.dom.replaceChildren(message, actions);
    this.dom.hidden = false;
    try {
      const coords = this.view.coordsAtPos(from);
      this.dom.style.left = `${coords.left}px`;
      this.dom.style.top = `${coords.bottom + 4}px`;
    } catch {
      this.dom.style.left = "0px";
    }
    document.addEventListener("mousedown", this.onPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  hide() {
    if (this.dom.hidden) return;
    this.dom.hidden = true;
    document.removeEventListener("mousedown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
  }

  destroy() {
    this.hide();
    this.dom.remove();
  }

  private button(label: string, onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", onClick);
    return button;
  }

  private apply(from: number, to: number, replacement: string) {
    this.hide();
    const tr = replacement === "" ? this.view.state.tr.delete(from, to) : this.view.state.tr.insertText(replacement, from, to);
    this.view.dispatch(tr);
    this.view.focus();
  }
}

export function grammarPlugin(lint: GrammarLint, initiallyEnabled = true): Plugin<GrammarState> {
  let popover: Popover | null = null;

  return new Plugin<GrammarState>({
    key: grammarKey,
    state: {
      init: () => ({ enabled: initiallyEnabled, decorations: DecorationSet.empty, ignored: new Set() }),
      apply: (tr, value) => {
        const meta = tr.getMeta(grammarKey) as GrammarMeta | undefined;
        let decorations = value.decorations.map(tr.mapping, tr.doc);
        if (!meta) return { ...value, decorations };
        if (meta.type === "enabled") {
          return { ...value, enabled: meta.enabled, decorations: DecorationSet.empty };
        }
        if (meta.type === "ignore") {
          const ignored = new Set(value.ignored).add(meta.key);
          decorations = decorations.remove(decorations.find().filter((deco) => (deco.spec as IssueSpec).key === meta.key));
          return { ...value, ignored, decorations };
        }
        decorations = decorations.remove(decorations.find(meta.from, meta.to));
        const fresh = meta.decorations.filter((deco) => !value.ignored.has((deco.spec as IssueSpec).key));
        return { ...value, decorations: decorations.add(tr.doc, fresh) };
      },
    },
    props: {
      decorations: (state) => grammarKey.getState(state)?.decorations,
      handleClick: (view, pos) => {
        const hit = grammarKey
          .getState(view.state)
          ?.decorations.find(pos, pos)
          .find((deco) => deco.from <= pos && pos <= deco.to);
        if (!hit) {
          popover?.hide();
          return false;
        }
        popover?.show(hit.from, hit.to, hit.spec as IssueSpec);
        return false;
      },
    },
    view: (view) => {
      popover = new Popover(view);
      let linted = new WeakSet<ProseNode>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let alive = true;

      const request = (node: ProseNode, pos: number) => {
        const { text } = blockText(node, pos);
        if (text.trim() === "") return;
        lint(text).then(
          (issues) => {
            if (!alive || !grammarKey.getState(view.state)?.enabled) return;
            const current = findBlock(view.state.doc, node);
            if (current < 0) return;
            const block = blockText(node, current);
            const ignored = grammarKey.getState(view.state)?.ignored ?? new Set<string>();
            sendMeta(view, {
              type: "result",
              from: current,
              to: current + node.nodeSize,
              decorations: decorate(block, issues, ignored),
            });
          },
          () => undefined,
        );
      };

      const scan = () => {
        if (!alive || !grammarKey.getState(view.state)?.enabled) return;
        view.state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return true;
          if (isLintable(node) && !linted.has(node)) {
            linted.add(node);
            request(node, pos);
          }
          return false;
        });
      };

      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(scan, DEBOUNCE_MS);
      };

      schedule();

      return {
        update: (updated, previous) => {
          const now = grammarKey.getState(updated.state);
          const before = grammarKey.getState(previous);
          if (updated.state.doc !== previous.doc) popover?.hide();
          if (now?.enabled && !before?.enabled) linted = new WeakSet();
          if (updated.state.doc !== previous.doc || now?.enabled !== before?.enabled) schedule();
        },
        destroy: () => {
          alive = false;
          clearTimeout(timer);
          popover?.destroy();
          popover = null;
        },
      };
    },
  });
}

export function grammarEditorPlugins(lint: GrammarLint, enabled = true): MilkdownPlugin[] {
  return [$prose(() => grammarPlugin(lint, enabled))];
}
