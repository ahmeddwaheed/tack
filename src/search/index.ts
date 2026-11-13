import MiniSearch, { type SearchResult } from "minisearch";
import { parseQuery, type ParsedQuery } from "./query";

export interface IndexedNote {
  path: string;
  title: string;
  folder: string;
  body: string;
  tags: string[];
  people: string[];
  modifiedMs: number;
}

export interface SearchHit {
  path: string;
  title: string;
  folder: string;
  line: string;
  score: number;
}

export interface SearchIndex {
  search(q: string, limit?: number): SearchHit[];
  searchTitles(q: string, limit?: number): SearchHit[];
  recent(limit?: number): SearchHit[];
  upsert(note: IndexedNote): void;
  remove(path: string): void;
}

const MAX_LINE = 120;

const SEARCH_OPTIONS = {
  boost: { title: 3, tags: 2, people: 2 },
  fuzzy: 0.2,
  prefix: true,
};

const lower = (values: string[]) => values.map((value) => value.toLowerCase());

const topFolder = (folder: string) => folder.split("/")[0]?.toLowerCase() ?? "";

function matchesFilters(note: IndexedNote, query: ParsedQuery): boolean {
  const tags = lower(note.tags);
  const people = lower(note.people);
  if (!lower(query.tags).every((tag) => tags.includes(tag))) return false;
  if (!lower(query.people).every((person) => people.includes(person))) return false;
  return query.folder === undefined || topFolder(note.folder) === query.folder.toLowerCase();
}

function matchingLine(body: string, result: SearchResult): string {
  const terms = Object.entries(result.match)
    .filter(([, fields]) => fields.includes("body"))
    .map(([term]) => term);
  if (terms.length === 0) return "";
  const line = body.split("\n").find((candidate) => {
    const text = candidate.toLowerCase();
    return terms.some((term) => text.includes(term));
  });
  return (line ?? "").trim().slice(0, MAX_LINE);
}

const hitOf = (note: IndexedNote, line = "", score = 0): SearchHit => ({
  path: note.path,
  title: note.title,
  folder: note.folder,
  line,
  score,
});

export function createSearchIndex(notes: IndexedNote[]): SearchIndex {
  const byPath = new Map<string, IndexedNote>();
  const mini = new MiniSearch<IndexedNote>({
    idField: "path",
    fields: ["title", "tags", "people", "body"],
    extractField: (document, field) => {
      const value = document[field as keyof IndexedNote];
      return Array.isArray(value) ? value.join(" ") : String(value);
    },
    searchOptions: SEARCH_OPTIONS,
  });

  const upsert = (note: IndexedNote) => {
    if (byPath.has(note.path)) mini.discard(note.path);
    byPath.set(note.path, note);
    mini.add(note);
  };

  const byNewest = (filter: (note: IndexedNote) => boolean, limit: number) =>
    [...byPath.values()]
      .filter(filter)
      .sort((a, b) => b.modifiedMs - a.modifiedMs)
      .slice(0, limit)
      .map((note) => hitOf(note));

  notes.forEach(upsert);

  return {
    search(q, limit = 20) {
      const query = parseQuery(q);
      const filter = (note: IndexedNote) => matchesFilters(note, query);
      if (query.text === "") {
        const filtered = query.tags.length + query.people.length > 0 || query.folder !== undefined;
        return filtered ? byNewest(filter, limit) : [];
      }
      const hits: SearchHit[] = [];
      for (const result of mini.search(query.text)) {
        const note = byPath.get(result.id as string);
        if (!note || !filter(note)) continue;
        hits.push(hitOf(note, matchingLine(note.body, result), result.score));
        if (hits.length === limit) break;
      }
      return hits;
    },
    searchTitles(q, limit = 20) {
      if (q.trim() === "") return byNewest(() => true, limit);
      return mini
        .search(q, { fields: ["title"] })
        .slice(0, limit)
        .flatMap((result) => {
          const note = byPath.get(result.id as string);
          return note ? [hitOf(note, "", result.score)] : [];
        });
    },
    recent(limit = 20) {
      return byNewest(() => true, limit);
    },
    upsert,
    remove(path) {
      if (!byPath.delete(path)) return;
      mini.discard(path);
    },
  };
}
