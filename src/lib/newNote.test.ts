import { beforeEach, describe, expect, test, vi } from "vitest";
import { createInboxNote, newNoteContent } from "./newNote";

const mocks = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

beforeEach(() => mocks.invoke.mockReset());

describe("newNoteContent", () => {
  test("is type note frontmatter with the local created minute and a blank line", () => {
    expect(newNoteContent(new Date(2026, 0, 5, 9, 7, 59))).toBe("---\ntype: note\ncreated: 2026-01-05T09:07\n---\n\n");
  });
});

describe("createInboxNote", () => {
  test("creates the note in Inbox", async () => {
    mocks.invoke.mockResolvedValue({
      path: "Inbox/Untitled.md",
      title: "Untitled",
      folder: "Inbox",
      modified_ms: 1,
      placeholder: false,
    });
    const meta = await createInboxNote("Untitled", new Date(2026, 10, 13, 15, 4));
    expect(mocks.invoke).toHaveBeenCalledWith("create_note", {
      folder: "Inbox",
      title: "Untitled",
      content: "---\ntype: note\ncreated: 2026-11-13T15:04\n---\n\n",
    });
    expect(meta.path).toBe("Inbox/Untitled.md");
  });
});
