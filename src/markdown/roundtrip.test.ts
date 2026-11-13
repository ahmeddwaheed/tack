import { describe, expect, test } from "vitest";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { splitFrontmatter } from "./frontmatter";
import { roundTripBody, tackStringifyOptions } from "./pipeline";

const fixtures = import.meta.glob<string>("./fixtures/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const normalizer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFrontmatter)
  .use(remarkStringify, tackStringifyOptions);

function normalize(markdown: string): string {
  return String(normalizer.processSync(markdown));
}

function body(name: string): string {
  const src = fixtures[`./fixtures/${name}`];
  if (src === undefined) throw new Error(`missing fixture ${name}`);
  return splitFrontmatter(src).body;
}

const names = Object.keys(fixtures).map((path) => path.replace("./fixtures/", ""));

describe("round trip", () => {
  test("all fixtures are present", () => {
    expect(names.sort()).toEqual([
      "callouts.md",
      "code-fences.md",
      "comments-html.md",
      "footnotes.md",
      "frontmatter.md",
      "headings-lists.md",
      "math.md",
      "tables.md",
      "tasks.md",
      "wikilinks.md",
    ]);
  });

  test.each(names)("%s keeps its content", async (name) => {
    const input = body(name);
    expect(normalize(await roundTripBody(input))).toBe(normalize(input));
  });

  test.each(names)("%s is stable on a second round trip", async (name) => {
    const once = await roundTripBody(body(name));
    expect(await roundTripBody(once)).toBe(once);
  });
});

describe("obsidian syntax is written back unescaped", () => {
  test("wikilinks and embeds", async () => {
    const out = await roundTripBody(body("wikilinks.md"));
    expect(out).toContain("[[Note]]");
    expect(out).toContain("[[Sam|my manager]]");
    expect(out).toContain("[[Projects/Tack#Milestone 1]]");
    expect(out).toContain("[[Note#Heading|a heading alias]]");
    expect(out).toContain("![[image.png]]");
    expect(out).toContain("![[diagram.excalidraw]]");
    expect(out).not.toContain("\\[");
    expect(out).not.toContain("\\!");
  });

  test("callouts", async () => {
    const out = await roundTripBody(body("callouts.md"));
    expect(out).toContain("> [!note] Title");
    expect(out).toContain("> [!warning]- Folded warning");
    expect(out).toContain("> [!tip]");
    expect(out).not.toContain("\\[");
  });

  test("comments and html", async () => {
    const out = await roundTripBody(body("comments-html.md"));
    expect(out).toContain("%%hidden%%");
    expect(out).toContain("%%\nA block comment\nspanning lines\n%%");
    expect(out).toContain("<details>\n<summary>Click to expand</summary>");
    expect(out).toContain("<kbd>Cmd</kbd>+<kbd>K</kbd>");
    expect(out).toContain("<!-- an html comment -->");
    expect(out).toContain("%%\nA comment with a blank line\n\n- and a *list* that stays raw\n%%");
    expect(out).not.toContain("\\%");
  });

  test("math", async () => {
    const out = await roundTripBody(body("math.md"));
    expect(out).toContain("$x^2 + y^2 = z^2$");
    expect(out).toContain("$$\n\\int_0^1 f(x)\\,dx = F(1) - F(0)\n$$");
    expect(out).toContain("\\begin{aligned}");
    expect(out).not.toContain("\\$");
    expect(out).not.toContain("\\[");
  });

  test("footnotes", async () => {
    const out = await roundTripBody(body("footnotes.md"));
    expect(out).toContain("source[^1]");
    expect(out).toContain("[^1]: The first footnote.");
    expect(out).toContain("[^note]: A named footnote with [[Note]] and `code`.");
  });

  test("obsidian tags at the start of a line", async () => {
    const out = await roundTripBody(body("headings-lists.md"));
    expect(out).toContain("\n#planning #tack/m1 tags at the start of a line.\n");
    expect(await roundTripBody("\\# not a heading\n")).toBe("\\# not a heading\n");
  });

  test("standalone images", async () => {
    const out = await roundTripBody(body("headings-lists.md"));
    expect(out).toContain("![Architecture diagram](assets/diagram.png)");
    expect(out).toContain("![logo](assets/logo.png)");
  });

  test("tasks", async () => {
    const out = await roundTripBody(body("tasks.md"));
    expect(out).toContain("- [ ] Write the brief");
    expect(out).toContain("- [x] Review PR");
    expect(out).toContain("    - [ ] Follow up with design");
  });

  test("tables keep wikilinks unescaped", async () => {
    const out = await roundTripBody(body("tables.md"));
    expect(out).toContain("[[Note]] link");
    expect(out).toContain("[[Sam\\|my manager]]");
    expect(out).not.toContain("\\[");
  });
});
