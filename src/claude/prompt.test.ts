import { describe, expect, it } from "vitest";
import {
  EmptyResultError,
  QUICK_ACTIONS,
  buildAskPrompt,
  extractNoteBody,
} from "./prompt";

describe("QUICK_ACTIONS", () => {
  it("lists every action with its label", () => {
    expect(QUICK_ACTIONS.map((a) => [a.id, a.label])).toEqual([
      ["rewrite", "Rewrite"],
      ["check", "Check"],
      ["summarize", "Summarize"],
      ["actions", "Action items"],
      ["howto", "Make it a how-to"],
    ]);
    for (const a of QUICK_ACTIONS) expect(a.instruction.length).toBeGreaterThan(10);
  });
});

describe("buildAskPrompt", () => {
  const prompt = buildAskPrompt("Make it shorter", "# Hello\n\n- [ ] task\n", "My note");

  it("includes instruction, title and body", () => {
    expect(prompt).toContain("Make it shorter");
    expect(prompt).toContain("My note");
    expect(prompt).toContain("# Hello\n\n- [ ] task");
  });

  it("states the output rules", () => {
    expect(prompt).toContain("ONLY the complete new note body");
    expect(prompt).toContain("[[wikilinks]]");
    expect(prompt).toContain("<<<TACK_NOTE_START>>>");
    expect(prompt).toContain("<<<TACK_NOTE_END>>>");
  });

  it("places the note between the markers after the instruction", () => {
    const start = prompt.indexOf("<<<TACK_NOTE_START>>>\n");
    expect(prompt.indexOf("Make it shorter")).toBeLessThan(start);
    expect(prompt.indexOf("# Hello")).toBeGreaterThan(start);
    expect(prompt.indexOf("# Hello")).toBeLessThan(prompt.lastIndexOf("<<<TACK_NOTE_END>>>"));
  });
});

describe("extractNoteBody", () => {
  it("strips an outer markdown fence", () => {
    expect(extractNoteBody("```markdown\n# A\n```")).toBe("# A\n");
  });

  it("strips plain and md fences", () => {
    expect(extractNoteBody("```\n# A\n```")).toBe("# A\n");
    expect(extractNoteBody("```md\n# A\n```\n")).toBe("# A\n");
  });

  it("keeps an inner code block", () => {
    const text = "# A\n\n```sh\nls\n```";
    expect(extractNoteBody(text)).toBe(`${text}\n`);
  });

  it("keeps a fence that does not wrap everything", () => {
    const text = "```sh\nls\n```\n\nafter";
    expect(extractNoteBody(text)).toBe(`${text}\n`);
  });

  it("keeps a body that only starts and ends with separate code blocks", () => {
    const text = "```sh\nls\n```\n\ntext\n\n```sh\npwd\n```";
    expect(extractNoteBody(text)).toBe(`${text}\n`);
  });

  it("strips echoed markers", () => {
    expect(extractNoteBody("<<<TACK_NOTE_START>>>\n# A\n<<<TACK_NOTE_END>>>")).toBe("# A\n");
  });

  it("ends with exactly one newline", () => {
    expect(extractNoteBody("# A\n\n\n")).toBe("# A\n");
  });

  it("throws on empty output", () => {
    expect(() => extractNoteBody("  \n")).toThrow(EmptyResultError);
    expect(() => extractNoteBody("```markdown\n\n```")).toThrow(EmptyResultError);
  });
});
