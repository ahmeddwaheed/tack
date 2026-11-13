import { describe, expect, test } from "vitest";
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from "./frontmatter";

const fixtures = import.meta.glob<string>("./fixtures/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const extraInputs = [
  "---\nfoo: [\n---\nbody",
  "no frontmatter",
  "",
  "---\n---\nempty frontmatter",
  "---\r\ntype: note\r\n---\r\nwindows endings\r\n",
  "---\ntype: note\n---",
  "---\ntype: note\nno closing fence",
  "text\n---\nnot: frontmatter\n---\n",
];

describe("splitFrontmatter / joinFrontmatter", () => {
  test.each(Object.entries(fixtures))("identity on %s", (_name, src) => {
    expect(joinFrontmatter(...split(src))).toBe(src);
  });

  test.each(extraInputs)("identity on %j", (src) => {
    expect(joinFrontmatter(...split(src))).toBe(src);
  });

  test("frontmatter is the exact original bytes including both fences", () => {
    const src = fixtures["./fixtures/frontmatter.md"];
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter.startsWith("---\ntype: meeting\n")).toBe(true);
    expect(frontmatter.endsWith('project: "[[Tack]]"\n---\n')).toBe(true);
    expect(body.startsWith("# Planning with Sam")).toBe(true);
  });

  test("no frontmatter gives empty frontmatter and the whole body", () => {
    expect(splitFrontmatter("no frontmatter")).toEqual({
      frontmatter: "",
      body: "no frontmatter",
    });
  });

  test("a byte order mark stays with the frontmatter", () => {
    expect(splitFrontmatter("\uFEFF---\ntype: note\n---\nbody")).toEqual({
      frontmatter: "\uFEFF---\ntype: note\n---\n",
      body: "body",
    });
    expect(parseFrontmatter("\uFEFF---\ntype: note\n---\n").type).toBe("note");
  });

  test("unclosed fence is not frontmatter", () => {
    expect(splitFrontmatter("---\ntype: note\nno closing fence").frontmatter).toBe("");
  });

  test("invalid yaml is still split so its bytes are kept", () => {
    expect(splitFrontmatter("---\nfoo: [\n---\nbody")).toEqual({
      frontmatter: "---\nfoo: [\n---\n",
      body: "body",
    });
  });
});

describe("parseFrontmatter", () => {
  test("reads tags and strips wikilink brackets from people", () => {
    const fields = parseFrontmatter('---\ntags: [a, b]\npeople: ["[[Sam]]"]\n---\n');
    expect(fields.tags).toEqual(["a", "b"]);
    expect(fields.people).toEqual(["Sam"]);
  });

  test("reads type and project from the fixture", () => {
    const { frontmatter } = splitFrontmatter(fixtures["./fixtures/frontmatter.md"]);
    expect(parseFrontmatter(frontmatter)).toEqual({
      type: "meeting",
      tags: ["planning", "tack"],
      people: ["Sam", "Alex"],
      project: "Tack",
    });
  });

  test("invalid yaml gives empty fields without throwing", () => {
    expect(parseFrontmatter("---\nfoo: [\n---\n")).toEqual({ tags: [], people: [] });
  });

  test("empty frontmatter gives empty fields", () => {
    expect(parseFrontmatter("")).toEqual({ tags: [], people: [] });
  });

  test("a single string tag becomes a list and wrong types are ignored", () => {
    expect(parseFrontmatter("---\ntype: 3\ntags: solo\npeople: Sam\n---\n")).toEqual({
      tags: ["solo"],
      people: ["Sam"],
    });
  });
});

function split(src: string): [string, string] {
  const { frontmatter, body } = splitFrontmatter(src);
  return [frontmatter, body];
}
