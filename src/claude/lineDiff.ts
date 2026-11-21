import { diffLines } from "diff";

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

export type DiffRow = DiffLine | { kind: "skip"; count: number };

const COLLAPSE_OVER = 4;
const CONTEXT = 2;

const withFinalNewline = (text: string) => (text === "" || text.endsWith("\n") ? text : `${text}\n`);

export function lineDiff(before: string, after: string): DiffLine[] {
  return diffLines(withFinalNewline(before), withFinalNewline(after)).flatMap((change) => {
    const kind = change.added ? "add" : change.removed ? "del" : "same";
    return change.value
      .replace(/\n$/, "")
      .split("\n")
      .map((text) => ({ kind, text }));
  });
}

export function collapseDiff(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "same") {
      rows.push(lines[i++]);
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].kind === "same") end++;
    const run = lines.slice(i, end);
    const head = i === 0 ? 0 : CONTEXT;
    const tail = end === lines.length ? 0 : CONTEXT;
    if (run.length > COLLAPSE_OVER && run.length > head + tail) {
      rows.push(...run.slice(0, head), { kind: "skip", count: run.length - head - tail }, ...run.slice(run.length - tail));
    } else {
      rows.push(...run);
    }
    i = end;
  }
  return rows;
}
