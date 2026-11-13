import type { Literal, Nodes, RootContent, Text } from "mdast";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { $inputRule, $nodeSchema, $remark } from "@milkdown/kit/utils";
import { eachParent, mergeAdjacentText, type StringifyHandle } from "./mdast";

export interface WikilinkNode extends Literal {
  type: "tackWikilink";
}

declare module "mdast" {
  interface PhrasingContentMap {
    tackWikilink: WikilinkNode;
  }
  interface RootContentMap {
    tackWikilink: WikilinkNode;
  }
}

const WIKILINK = /!?\[\[[^[\]\n]+\]\]/g;

function splitText(text: Text): RootContent[] {
  const parts: RootContent[] = [];
  let last = 0;
  for (const match of text.value.matchAll(WIKILINK)) {
    if (match.index > last) parts.push({ type: "text", value: text.value.slice(last, match.index) });
    parts.push({ type: "tackWikilink", value: match[0] });
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return [text];
  if (last < text.value.length) parts.push({ type: "text", value: text.value.slice(last) });
  return parts;
}

export function remarkWikilink() {
  return (tree: Nodes) => {
    eachParent(tree, (parent) => {
      mergeAdjacentText(parent);
      parent.children = parent.children.flatMap((child) =>
        child.type === "text" ? splitText(child) : [child],
      ) as typeof parent.children;
    });
  };
}

export const stringifyWikilink: StringifyHandle = (node: WikilinkNode, _parent, state) =>
  state.stack.includes("tableCell") ? node.value.replace(/\|/g, "\\|") : node.value;

export const wikilinkRemark = $remark("tackWikilink", () => remarkWikilink);

export const wikilinkSchema = $nodeSchema("wikilink", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { value: { default: "" } },
  parseDOM: [
    {
      tag: 'span[data-type="wikilink"]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }),
    },
  ],
  toDOM: (node) => [
    "span",
    { "data-type": "wikilink", "data-value": node.attrs.value, class: "tack-wikilink" },
    node.attrs.value,
  ],
  parseMarkdown: {
    match: (node) => node.type === "tackWikilink",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "wikilink",
    runner: (state, node) => {
      state.addNode("tackWikilink", undefined, node.attrs.value as string);
    },
  },
}));

const TYPED_WIKILINK = /(!?\[\[[^[\]\n]+\]\])$/;

export const wikilinkInputRule = $inputRule(
  (ctx) =>
    new InputRule(TYPED_WIKILINK, (state, match, start, end) => {
      const value = match[1];
      if (value === undefined) return null;
      const $start = state.doc.resolve(start);
      if ($start.marks().some((mark) => mark.type.spec.code)) return null;
      const before = $start.parent.textBetween(0, $start.parentOffset, undefined, "\ufffc");
      // An open backtick means inline code is being typed; its input rule would drop the atom.
      if ((before.match(/`/g)?.length ?? 0) % 2 === 1) return null;
      return state.tr.replaceWith(start, end, wikilinkSchema.type(ctx).create({ value }));
    }),
);

export const wikilinkPlugins = [wikilinkRemark, wikilinkSchema, wikilinkInputRule].flat();
