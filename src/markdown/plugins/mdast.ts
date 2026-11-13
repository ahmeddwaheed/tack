import type { Nodes, Parent, RootContent, Text } from "mdast";
import type { Options } from "remark-stringify";

export function eachParent(node: Nodes, visit: (parent: Parent) => void): void {
  if (!("children" in node)) return;
  visit(node);
  for (const child of node.children) eachParent(child, visit);
}

export function mergeAdjacentText(parent: Parent): void {
  const merged: RootContent[] = [];
  for (const child of parent.children) {
    const previous = merged[merged.length - 1];
    if (child.type === "text" && previous?.type === "text") {
      merged[merged.length - 1] = joinText(previous, child);
    } else {
      merged.push(child);
    }
  }
  parent.children = merged;
}

function joinText(first: Text, second: Text): Text {
  const joined: Text = { type: "text", value: first.value + second.value };
  if (first.position && second.position) {
    joined.position = { start: first.position.start, end: second.position.end };
  }
  return joined;
}

export function sourceOf(file: { value?: unknown }): string | undefined {
  return typeof file.value === "string" ? file.value : undefined;
}

export type StringifyHandle = NonNullable<NonNullable<Options["handlers"]>["text"]>;
