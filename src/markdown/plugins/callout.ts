import type { Literal, Nodes } from "mdast";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { $inputRule, $nodeSchema, $remark } from "@milkdown/kit/utils";
import { eachParent, mergeAdjacentText, type StringifyHandle } from "./mdast";

export interface CalloutMarkerNode extends Literal {
  type: "tackCalloutMarker";
}

declare module "mdast" {
  interface PhrasingContentMap {
    tackCalloutMarker: CalloutMarkerNode;
  }
  interface RootContentMap {
    tackCalloutMarker: CalloutMarkerNode;
  }
}

const MARKER = /^\[![\w-]+\][+-]?/;

export function remarkCallout() {
  return (tree: Nodes) => {
    eachParent(tree, (parent) => {
      if (parent.type !== "blockquote") return;
      const paragraph = parent.children[0];
      if (paragraph?.type !== "paragraph") return;
      mergeAdjacentText(paragraph);
      const text = paragraph.children[0];
      if (text?.type !== "text") return;
      const match = MARKER.exec(text.value);
      if (!match) return;
      const rest = text.value.slice(match[0].length);
      paragraph.children.splice(
        0,
        1,
        { type: "tackCalloutMarker", value: match[0] },
        ...(rest ? [{ type: "text" as const, value: rest }] : []),
      );
    });
  };
}

export const stringifyCalloutMarker: StringifyHandle = (node: CalloutMarkerNode) => node.value;

export const calloutRemark = $remark("tackCallout", () => remarkCallout);

export const calloutMarkerSchema = $nodeSchema("callout_marker", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { value: { default: "[!note]" } },
  parseDOM: [
    {
      tag: 'span[data-type="callout-marker"]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "[!note]" }),
    },
  ],
  toDOM: (node) => [
    "span",
    { "data-type": "callout-marker", "data-value": node.attrs.value, class: "tack-callout-marker" },
    node.attrs.value,
  ],
  parseMarkdown: {
    match: (node) => node.type === "tackCalloutMarker",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "callout_marker",
    runner: (state, node) => {
      state.addNode("tackCalloutMarker", undefined, node.attrs.value as string);
    },
  },
}));

const TYPED_MARKER = /^\[![\w-]+\]$/;

export const calloutInputRule = $inputRule(
  (ctx) =>
    new InputRule(TYPED_MARKER, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      const quote = $start.node(-1);
      if (quote?.type.name !== "blockquote" || $start.index(-1) !== 0) return null;
      if ($start.parent.type.name !== "paragraph" || $start.parentOffset !== 0) return null;
      return state.tr.replaceWith(start, end, calloutMarkerSchema.type(ctx).create({ value: match[0] }));
    }),
);

export const calloutPlugins = [calloutRemark, calloutMarkerSchema, calloutInputRule].flat();
