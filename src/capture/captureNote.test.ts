import { describe, expect, test } from "vitest";
import { captureNote } from "./captureNote";

const at = new Date(2026, 10, 13, 14, 5);
const frontmatter = "---\ntype: note\ncreated: 2026-11-13T14:05\n---\n\n";

describe("captureNote", () => {
  test("returns null for empty or whitespace-only text", () => {
    expect(captureNote("", at)).toBeNull();
    expect(captureNote("  \n ", at)).toBeNull();
  });

  test("titles the note with the time and the first six words of the first line", () => {
    const note = captureNote("Ask Sam about SSO / SCIM: tomorrow 🙂\nmore", at);
    expect(note?.title).toBe("2026-11-13 1405 Ask Sam about SSO / SCIM:");
    expect(note?.content.startsWith(frontmatter)).toBe(true);
  });

  test("keeps the whole text and ends it with one newline", () => {
    const note = captureNote("Ask Sam about SSO / SCIM: tomorrow 🙂\nmore", at);
    expect(note?.content).toBe(`${frontmatter}Ask Sam about SSO / SCIM: tomorrow 🙂\nmore\n`);
    expect(captureNote("done\n\n\n", at)?.content).toBe(`${frontmatter}done\n`);
  });

  test("skips leading blank lines for the title and the body", () => {
    const note = captureNote("\n  \nhello world\n", at);
    expect(note?.title).toBe("2026-11-13 1405 hello world");
    expect(note?.content).toBe(`${frontmatter}hello world\n`);
  });

  test("pads single-digit dates and times", () => {
    const note = captureNote("x", new Date(2026, 0, 2, 3, 4));
    expect(note?.title).toBe("2026-01-02 0304 x");
    expect(note?.content).toContain("created: 2026-01-02T03:04\n");
  });

  test("limits the title to 60 characters without splitting an emoji", () => {
    const long = "Supercalifragilisticexpialidocious 🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂 antidisestablishmentarianism";
    const title = captureNote(long, at)?.title ?? "";
    expect([...title].length).toBeLessThanOrEqual(60);
    expect(title.startsWith("2026-11-13 1405 Supercalifragilisticexpialidocious")).toBe(true);
    expect(title).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(title).toBe(title.trimEnd());
  });
});
