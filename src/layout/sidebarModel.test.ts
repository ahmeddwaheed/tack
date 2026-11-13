import { describe, expect, test } from "vitest";
import type { NoteMeta } from "../lib/vault";
import { renamePinned, sidebarSections, togglePinned, vaultFolderOf, type SidebarSection } from "./sidebarModel";

const note = (path: string, modifiedMs: number): NoteMeta => {
  const parts = path.split("/");
  return {
    path,
    title: (parts.pop() ?? path).replace(/\.md$/, ""),
    folder: parts.join("/"),
    modifiedMs,
    placeholder: false,
  };
};

const section = (sections: SidebarSection[], id: SidebarSection["id"]) => {
  const found = sections.find((s) => s.id === id);
  if (!found) throw new Error(`missing section ${id}`);
  return found;
};

const paths = (s: SidebarSection) => s.notes.map((n) => n.path);

describe("sidebarSections", () => {
  test("has every section once with its label", () => {
    const sections = sidebarSections([], []);
    expect(sections.map((s) => [s.id, s.label])).toEqual([
      ["pinned", "Pinned"],
      ["recent", "Recent"],
      ["inbox", "Inbox"],
      ["meetings", "Meetings"],
      ["people", "People"],
      ["projects", "Projects"],
      ["knowledge", "Knowledge"],
      ["weekly", "Weekly"],
    ]);
    expect(sections.every((s) => s.notes.length === 0)).toBe(true);
  });

  test("counts notes per top level folder, subfolders included", () => {
    const notes = [
      note("Inbox/a.md", 1),
      note("Inbox/b.md", 2),
      note("Meetings/2026/standup.md", 3),
      note("Meetings/retro.md", 4),
      note("People/Ann.md", 5),
      note("Projects/Tack.md", 6),
      note("Knowledge/Rust.md", 7),
      note("Weekly/2026-W46.md", 8),
      note("Archive/old.md", 9),
    ];
    const sections = sidebarSections(notes, []);
    expect(section(sections, "inbox").notes).toHaveLength(2);
    expect(section(sections, "meetings").notes).toHaveLength(2);
    expect(section(sections, "people").notes).toHaveLength(1);
    expect(section(sections, "projects").notes).toHaveLength(1);
    expect(section(sections, "knowledge").notes).toHaveLength(1);
    expect(section(sections, "weekly").notes).toHaveLength(1);
  });

  test("notes at the vault root or in other folders show under Other, which only appears when needed", () => {
    const notes = [note("Inbox/a.md", 1), note("Untitled.md", 3), note("Clippings/web.md", 2)];
    const sections = sidebarSections(notes, []);
    expect(sections[sections.length - 1]?.label).toBe("Other");
    expect(paths(section(sections, "other"))).toEqual(["Untitled.md", "Clippings/web.md"]);
    expect(paths(section(sections, "recent"))).toContain("Untitled.md");
    expect(sidebarSections([note("Inbox/a.md", 1)], []).some((s) => s.id === "other")).toBe(false);
  });

  test("vaultFolderOf names one of the six folders or null", () => {
    expect(vaultFolderOf(note("Meetings/2026/x.md", 1))).toBe("Meetings");
    expect(vaultFolderOf(note("Untitled.md", 1))).toBeNull();
    expect(vaultFolderOf(note("Clippings/x.md", 1))).toBeNull();
  });

  test("folder sections are sorted newest first", () => {
    const notes = [note("Inbox/old.md", 10), note("Inbox/new.md", 30), note("Inbox/mid.md", 20)];
    expect(paths(section(sidebarSections(notes, []), "inbox"))).toEqual([
      "Inbox/new.md",
      "Inbox/mid.md",
      "Inbox/old.md",
    ]);
  });

  test("recent holds the 10 newest notes across folders, newest first", () => {
    const notes = Array.from({ length: 14 }, (_, i) => note(`${i % 2 ? "Inbox" : "People"}/n${i}.md`, i * 100));
    const recent = paths(section(sidebarSections(notes, []), "recent"));
    expect(recent).toHaveLength(10);
    expect(recent).toEqual(
      [13, 12, 11, 10, 9, 8, 7, 6, 5, 4].map((i) => `${i % 2 ? "Inbox" : "People"}/n${i}.md`),
    );
  });

  test("pinned keeps the order from settings", () => {
    const notes = [note("Inbox/a.md", 3), note("People/b.md", 2), note("Projects/c.md", 1)];
    const pinned = section(sidebarSections(notes, ["Projects/c.md", "Inbox/a.md", "People/b.md"]), "pinned");
    expect(paths(pinned)).toEqual(["Projects/c.md", "Inbox/a.md", "People/b.md"]);
  });

  test("a pinned path that is not in the vault is ignored", () => {
    const notes = [note("Inbox/a.md", 3)];
    const pinned = section(sidebarSections(notes, ["Inbox/gone.md", "Inbox/a.md"]), "pinned");
    expect(paths(pinned)).toEqual(["Inbox/a.md"]);
  });

  test("does not reorder the input", () => {
    const notes = [note("Inbox/a.md", 1), note("Inbox/b.md", 2)];
    sidebarSections(notes, []);
    expect(notes.map((n) => n.path)).toEqual(["Inbox/a.md", "Inbox/b.md"]);
  });
});

describe("pinned helpers", () => {
  test("togglePinned appends a new path and removes a pinned one", () => {
    expect(togglePinned(["Inbox/a.md"], "Inbox/b.md")).toEqual(["Inbox/a.md", "Inbox/b.md"]);
    expect(togglePinned(["Inbox/a.md", "Inbox/b.md"], "Inbox/a.md")).toEqual(["Inbox/b.md"]);
  });

  test("renamePinned keeps the position of a renamed note", () => {
    expect(renamePinned(["Inbox/a.md", "Inbox/b.md"], "Inbox/a.md", "People/a.md")).toEqual([
      "People/a.md",
      "Inbox/b.md",
    ]);
    expect(renamePinned(["Inbox/b.md"], "Inbox/a.md", "Inbox/c.md")).toEqual(["Inbox/b.md"]);
  });
});
