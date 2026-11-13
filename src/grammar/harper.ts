import type { Lint, Linter } from "harper.js";

export interface GrammarIssue {
  start: number;
  end: number;
  message: string;
  suggestions: string[];
}

type Harper = typeof import("harper.js");

let started: Promise<{ harper: Harper; linter: Linter }> | null = null;

const start = async () => {
  const [harper, { binary }] = await Promise.all([import("harper.js"), import("harper.js/binary")]);
  return { harper, linter: new harper.WorkerLinter({ binary, dialect: harper.Dialect.American }) };
};

export const toGrammarIssues = (lints: Lint[], insertAfter: number): GrammarIssue[] =>
  lints.map((lint) => {
    const span = lint.span();
    return {
      start: span.start,
      end: span.end,
      message: lint.message(),
      suggestions: lint.suggestions().map((suggestion) => {
        const replacement = suggestion.get_replacement_text();
        return suggestion.kind() === insertAfter ? lint.get_problem_text() + replacement : replacement;
      }),
    };
  });

export async function lintText(text: string): Promise<GrammarIssue[]> {
  started ??= start().catch((error: unknown) => {
    started = null;
    throw error;
  });
  const { harper, linter } = await started;
  const lints = await linter.lint(text, { language: "plaintext" });
  return toGrammarIssues(lints, harper.SuggestionKind.InsertAfter);
}
