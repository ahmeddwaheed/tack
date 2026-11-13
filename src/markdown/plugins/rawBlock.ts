import type { Literal, Nodes, Parent, RootContent } from "mdast";
import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import { eachParent, sourceOf, type StringifyHandle } from "./mdast";

export interface RawBlockNode extends Literal {
  type: "tackRawBlock";
}

declare module "mdast" {
  interface RootContentMap {
    tackRawBlock: RawBlockNode;
  }
  interface BlockContentMap {
    tackRawBlock: RawBlockNode;
  }
}

const BLOCK_CONTAINERS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

function countCommentFences(text: string): number {
  return text.split("%%").length - 1;
}

function sliceOf(source: string, node: RootContent): string | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : source.slice(start, end);
}

function wrapCommentBlocks(root: Parent, source: string): void {
  const children: RootContent[] = [];
  let index = 0;
  while (index < root.children.length) {
    const first = root.children[index];
    const firstText = first.type === "paragraph" ? sliceOf(source, first) : undefined;
    if (firstText === undefined || !firstText.startsWith("%%")) {
      children.push(first);
      index += 1;
      continue;
    }
    let fences = countCommentFences(firstText);
    let last = index;
    while (fences % 2 === 1 && last + 1 < root.children.length) {
      last += 1;
      fences += countCommentFences(sliceOf(source, root.children[last]) ?? "");
    }
    const lastText = sliceOf(source, root.children[last]) ?? "";
    const closed = fences % 2 === 0 && lastText.trimEnd().endsWith("%%");
    const unterminated = fences % 2 === 1;
    if (!closed && !unterminated) {
      children.push(first);
      index += 1;
      continue;
    }
    const start = first.position?.start.offset ?? 0;
    const end = root.children[last].position?.end.offset ?? source.length;
    children.push({ type: "tackRawBlock", value: source.slice(start, end) });
    index = last + 1;
  }
  root.children = children;
}

export function remarkRawBlock() {
  return (tree: Nodes, file: { value?: unknown }) => {
    eachParent(tree, (parent) => {
      if (!BLOCK_CONTAINERS.has(parent.type)) return;
      parent.children = parent.children.map((child) =>
        child.type === "html" ? { type: "tackRawBlock", value: child.value } : child,
      ) as typeof parent.children;
    });
    const source = sourceOf(file);
    if (tree.type === "root" && source !== undefined) wrapCommentBlocks(tree, source);
  };
}

export const stringifyRawBlock: StringifyHandle = (node: RawBlockNode) => node.value;

export const rawBlockRemark = $remark("tackRawBlock", () => remarkRawBlock);

export const rawBlockSchema = $nodeSchema("raw_block", () => ({
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  parseDOM: [{ tag: 'pre[data-type="raw-block"]', preserveWhitespace: "full" }],
  toDOM: () => ["pre", { "data-type": "raw-block", class: "tack-raw-block" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "tackRawBlock",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "raw_block",
    runner: (state, node) => {
      state.addNode("tackRawBlock", undefined, node.textContent);
    },
  },
}));

export const rawBlockPlugins = [rawBlockRemark, rawBlockSchema].flat();
