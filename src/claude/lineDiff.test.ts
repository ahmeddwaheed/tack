import { describe, expect, test } from "vitest";
import { collapseDiff, lineDiff } from "./lineDiff";

describe("lineDiff", () => {
  test("marks kept, added and removed lines", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  test("a missing final newline does not count as a change", () => {
    expect(lineDiff("a\nb", "a\nb\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  test("keeps empty lines", () => {
    expect(lineDiff("a\n\nb\n", "a\n\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "" },
      { kind: "del", text: "b" },
      { kind: "add", text: "c" },
    ]);
  });
});

const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`).join("\n") + "\n";

describe("collapseDiff", () => {
  test("keeps short unchanged runs", () => {
    const rows = collapseDiff(lineDiff(lines("s", 4) + "x\n", lines("s", 4) + "y\n"));
    expect(rows.filter((row) => row.kind === "same")).toHaveLength(4);
    expect(rows.some((row) => row.kind === "skip")).toBe(false);
  });

  test("collapses a long run between changes to 2 lines of context each side", () => {
    const before = `x\n${lines("s", 10)}y\n`;
    const after = `X\n${lines("s", 10)}Y\n`;
    expect(collapseDiff(lineDiff(before, after))).toEqual([
      { kind: "del", text: "x" },
      { kind: "add", text: "X" },
      { kind: "same", text: "s1" },
      { kind: "same", text: "s2" },
      { kind: "skip", count: 6 },
      { kind: "same", text: "s9" },
      { kind: "same", text: "s10" },
      { kind: "del", text: "y" },
      { kind: "add", text: "Y" },
    ]);
  });

  test("a long run at the start or end only keeps the context next to the change", () => {
    const before = `${lines("a", 6)}x\n${lines("b", 6)}`;
    const after = `${lines("a", 6)}y\n${lines("b", 6)}`;
    expect(collapseDiff(lineDiff(before, after))).toEqual([
      { kind: "skip", count: 4 },
      { kind: "same", text: "a5" },
      { kind: "same", text: "a6" },
      { kind: "del", text: "x" },
      { kind: "add", text: "y" },
      { kind: "same", text: "b1" },
      { kind: "same", text: "b2" },
      { kind: "skip", count: 4 },
    ]);
  });
});
