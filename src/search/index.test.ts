import { describe, expect, test } from "vitest";
import { createSearchIndex, type IndexedNote } from "./index";

const note = (over: Partial<IndexedNote> & { path: string }): IndexedNote => ({
  title: over.path.split("/").pop()?.replace(/\.md$/, "") ?? "",
  folder: over.path.split("/").slice(0, -1).join("/"),
  body: "",
  tags: [],
  people: [],
  modifiedMs: 0,
  ...over,
});

const notes: IndexedNote[] = [
  note({
    path: "Knowledge/Kubernetes.md",
    body: "# Restarting pods\n\nRun this:\n\n    kubectl rollout restart deployment/api\n",
    tags: ["infra"],
  }),
  note({ path: "Projects/Workshop sync.md", body: "Weekly sync about auth.", people: ["Sam"] }),
  note({ path: "Meetings/2026/Standup.md", body: "We talked about deploy freeze.", tags: ["team"] }),
  note({ path: "Knowledge/Deploy.md", body: "How releases go out.", tags: ["infra"], people: ["Sam"] }),
];

describe("createSearchIndex", () => {
  test("typos still find the note and show the matching line", () => {
    const [hit] = createSearchIndex(notes).search("kubctl rolout");
    expect(hit?.path).toBe("Knowledge/Kubernetes.md");
    expect(hit?.line).toContain("kubectl rollout restart");
    expect(hit?.line).toBe(hit?.line.trim());
  });

  test("prefix finds a title", () => {
    const hits = createSearchIndex(notes).search("work");
    expect(hits[0]).toMatchObject({ path: "Projects/Workshop sync.md", title: "Workshop sync", line: "" });
  });

  test("a title match outranks a body match", () => {
    const hits = createSearchIndex(notes).search("deploy");
    expect(hits.map((hit) => hit.path).slice(0, 2)).toEqual(["Knowledge/Deploy.md", "Meetings/2026/Standup.md"]);
  });

  test("a tag filter excludes notes without the tag", () => {
    const index = createSearchIndex(notes);
    expect(index.search("deploy").map((hit) => hit.path)).toContain("Meetings/2026/Standup.md");
    const hits = index.search("deploy #infra");
    expect(hits.map((hit) => hit.path).sort()).toEqual(["Knowledge/Deploy.md", "Knowledge/Kubernetes.md"]);
  });

  test("person and folder filters, top-level folder matches subfolders", () => {
    const index = createSearchIndex(notes);
    expect(index.search("sync @sam").map((hit) => hit.path)).toEqual(["Projects/Workshop sync.md"]);
    expect(index.search("deploy in:meetings").map((hit) => hit.path)).toEqual(["Meetings/2026/Standup.md"]);
  });

  test("filters without text list matching notes, newest first", () => {
    const index = createSearchIndex([
      note({ path: "Inbox/a.md", tags: ["x"], modifiedMs: 1 }),
      note({ path: "Inbox/b.md", tags: ["x"], modifiedMs: 2 }),
      note({ path: "Inbox/c.md", modifiedMs: 3 }),
    ]);
    expect(index.search("#x").map((hit) => hit.path)).toEqual(["Inbox/b.md", "Inbox/a.md"]);
  });

  test("long matching lines are cut to 120 characters", () => {
    const index = createSearchIndex([note({ path: "Inbox/long.md", body: `zebra ${"x".repeat(300)}` })]);
    expect(index.search("zebra")[0]?.line).toHaveLength(120);
  });

  test("upsert makes new text findable and remove drops it", () => {
    const index = createSearchIndex(notes);
    index.upsert(note({ path: "Knowledge/Kubernetes.md", body: "helm upgrade --install" }));
    expect(index.search("helm").map((hit) => hit.path)).toEqual(["Knowledge/Kubernetes.md"]);
    expect(index.search("kubectl")).toEqual([]);
    index.remove("Knowledge/Kubernetes.md");
    expect(index.search("helm")).toEqual([]);
    expect(() => index.remove("Knowledge/Kubernetes.md")).not.toThrow();
  });

  test("recent lists notes newest first", () => {
    const index = createSearchIndex([
      note({ path: "Inbox/old.md", modifiedMs: 1 }),
      note({ path: "Inbox/new.md", modifiedMs: 5 }),
    ]);
    expect(index.recent().map((hit) => hit.path)).toEqual(["Inbox/new.md", "Inbox/old.md"]);
  });

  test("searchTitles ignores body text", () => {
    const index = createSearchIndex(notes);
    expect(index.searchTitles("sync").map((hit) => hit.title)).toEqual(["Workshop sync"]);
    expect(index.searchTitles("kubctl")).toEqual([]);
  });
});
