import { describe, expect, test } from "vitest";
import { createSearchIndex, type IndexedNote } from "./index";

const WORDS = (
  "deployment cluster release service rollout pipeline meeting review budget roadmap " +
  "standup design backend frontend database migration index cache queue worker " +
  "customer invoice payment report weekly project person knowledge inbox shell " +
  "kubectl docker terraform helm grafana alert incident outage retro planning"
).split(" ");

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function generateNotes(count: number, wordsPerNote: number): IndexedNote[] {
  const random = seeded(42);
  const word = () => {
    const base = WORDS[Math.floor(random() * WORDS.length)] ?? "note";
    return random() < 0.3 ? `${base}${Math.floor(random() * 500)}` : base;
  };
  return Array.from({ length: count }, (_, i) => {
    const lines: string[] = [];
    for (let w = 0; w < wordsPerNote; w += 12) lines.push(Array.from({ length: 12 }, word).join(" "));
    return {
      path: `Knowledge/Note ${i}.md`,
      title: `${word()} ${word()} ${i}`,
      folder: "Knowledge",
      body: lines.join("\n"),
      tags: [word()],
      people: [],
      modifiedMs: i,
    };
  });
}

describe("search performance", () => {
  test("2,000 notes of ~300 words answer in under 50 ms", () => {
    const index = createSearchIndex(generateNotes(2000, 300));
    const runs = Array.from({ length: 5 }, () => {
      const start = performance.now();
      const hits = index.search("deplyment");
      const elapsed = performance.now() - start;
      expect(hits.length).toBeGreaterThan(0);
      return elapsed;
    }).sort((a, b) => a - b);
    expect(runs[2]).toBeLessThan(50);
  });
});
