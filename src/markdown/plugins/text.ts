import type { Text } from "mdast";
import type { StringifyHandle } from "./mdast";

const WHITESPACE_TAIL = /^[^*_\\]*\s+$/;
// `#tag` can never open an ATX heading, and the escape would stop Obsidian reading it as a tag.
const ESCAPED_TAG = /^\\#(?=[^\s#])/gm;

export const stringifyText: StringifyHandle = (node: Text, _parent, state, info) => {
  if (WHITESPACE_TAIL.test(node.value)) return node.value;
  return state.safe(node.value, { ...info, encode: [] }).replace(ESCAPED_TAG, "#");
};
