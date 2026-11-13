import { parse } from "yaml";

export interface NoteFields {
  type?: string;
  tags: string[];
  people: string[];
  project?: string;
}

const FRONTMATTER = /^\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/;

export function splitFrontmatter(src: string): { frontmatter: string; body: string } {
  const match = FRONTMATTER.exec(src);
  if (!match) return { frontmatter: "", body: src };
  return { frontmatter: match[0], body: src.slice(match[0].length) };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body;
}

export function parseFrontmatter(frontmatter: string): NoteFields {
  const data = readYaml(frontmatter);
  const fields: NoteFields = {
    tags: stringList(data.tags),
    people: stringList(data.people).map(stripWikilink),
  };
  if (typeof data.type === "string") fields.type = data.type;
  if (typeof data.project === "string") fields.project = stripWikilink(data.project);
  return fields;
}

function readYaml(frontmatter: string): Record<string, unknown> {
  const inner = frontmatter.replace(/^\uFEFF?---\r?\n/, "").replace(/---(?:\r?\n)?$/, "");
  try {
    const data: unknown = parse(inner);
    return isRecord(data) ? data : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stripWikilink(value: string): string {
  const match = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(value.trim());
  return match ? match[1] : value;
}
