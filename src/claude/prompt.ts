export type QuickActionId = "rewrite" | "check" | "summarize" | "actions" | "howto";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  instruction: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "rewrite",
    label: "Rewrite",
    instruction: "Rewrite the note so it is clearer and shorter. Keep the same meaning.",
  },
  {
    id: "check",
    label: "Check",
    instruction:
      "Fix grammar, spelling and unclear sentences only. Keep the structure and everything else as it is.",
  },
  {
    id: "summarize",
    label: "Summarize",
    instruction:
      "Add a `## Summary` section with 3 to 6 bullets at the top of the note. Keep the rest of the note unchanged.",
  },
  {
    id: "actions",
    label: "Action items",
    instruction:
      "Add a `## Action items` section at the top of the note, with the action items from the note as `- [ ]` tasks. Keep the rest of the note unchanged.",
  },
  {
    id: "howto",
    label: "Make it a how-to",
    instruction:
      "Restructure the note into a step-by-step guide with a short intro and numbered steps. Keep commands in code blocks.",
  },
];

const NOTE_START = "<<<TACK_NOTE_START>>>";
const NOTE_END = "<<<TACK_NOTE_END>>>";

export class EmptyResultError extends Error {
  constructor() {
    super("Claude returned an empty result.");
    this.name = "EmptyResultError";
  }
}

export function buildAskPrompt(instruction: string, body: string, title: string): string {
  return [
    "You edit one Markdown note.",
    "Return ONLY the complete new note body in Markdown. No preamble, no explanation, and no code fence around it.",
    "Keep [[wikilinks]], ![[embeds]], `- [ ]` tasks, callouts such as `> [!note]` and code blocks intact.",
    "Write in English.",
    `The note sits between ${NOTE_START} and ${NOTE_END}. Do not include these markers in your answer.`,
    "",
    `Instruction: ${instruction}`,
    "",
    `Note title: ${title}`,
    NOTE_START,
    body,
    NOTE_END,
  ].join("\n");
}

function isBalancedFences(lines: string[]): boolean {
  let open = false;
  for (const line of lines) {
    if (/^```/.test(line)) open = !open;
  }
  return !open;
}

function stripOuterFence(text: string): string {
  const lines = text.split("\n");
  if (lines.length < 2) return text;
  const first = lines[0].trim();
  const last = lines[lines.length - 1].trim();
  if (!/^```(markdown|md)?$/.test(first) || last !== "```") return text;
  const inner = lines.slice(1, -1);
  return isBalancedFences(inner) ? inner.join("\n") : text;
}

export function extractNoteBody(output: string): string {
  let text = stripOuterFence(output.trim()).trim();
  if (text.startsWith(NOTE_START)) text = text.slice(NOTE_START.length);
  if (text.endsWith(NOTE_END)) text = text.slice(0, -NOTE_END.length);
  text = stripOuterFence(text.trim()).trim();
  if (text === "") throw new EmptyResultError();
  return `${text}\n`;
}
