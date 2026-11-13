import { describe, expect, test } from "vitest";
import { Dialect, LocalLinter, SuggestionKind } from "harper.js";
import { binaryInlined as binary } from "harper.js/binaryInlined";
import { toGrammarIssues } from "./harper";

const lintWithHarper = async (text: string) => {
  const linter = new LocalLinter({ binary, dialect: Dialect.American });
  try {
    return toGrammarIssues(await linter.lint(text, { language: "plaintext" }), SuggestionKind.InsertAfter);
  } finally {
    await linter.dispose();
  }
};

const flagged = (text: string, issues: { start: number; end: number }[]) =>
  issues.map((issue) => text.slice(issue.start, issue.end));

describe("harper.js", () => {
  test("flags a subject-verb agreement error with a suggestion", async () => {
    const text = "He are happy.";
    const issues = await lintWithHarper(text);
    expect(flagged(text, issues)).toContain("are");
    expect(issues[0]?.suggestions.length).toBeGreaterThan(0);
  }, 30_000);

  test("reports ranges that index the original string after an emoji", async () => {
    const text = "😀 I has a dog.";
    const issues = await lintWithHarper(text);
    expect(flagged(text, issues)).toContain("has");
  }, 30_000);
});
