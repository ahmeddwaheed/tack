import { beforeEach, describe, expect, test, vi } from "vitest";
import { onVaultChanged, writeNote, WriteConflictError } from "./vault";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string) => Promise<unknown>>(),
  unlisten: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(name, handler);
    return mocks.unlisten;
  },
}));

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.unlisten.mockReset();
  mocks.handlers.clear();
});

describe("onVaultChanged", () => {
  test("listens_to_vault_changed_and_starts_the_watcher", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const seen: string[][] = [];
    const stop = await onVaultChanged((paths) => seen.push(paths));
    expect(mocks.invoke).toHaveBeenCalledWith("watch_vault");
    mocks.handlers.get("vault-changed")?.({ payload: { paths: ["Inbox/a.md", "People/b.md"] } });
    expect(seen).toEqual([["Inbox/a.md", "People/b.md"]]);
    stop();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  test("stops_listening_when_the_watcher_cannot_start", async () => {
    mocks.invoke.mockRejectedValue("vault folder is missing");
    await expect(onVaultChanged(() => {})).rejects.toBe("vault folder is missing");
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});

describe("writeNote", () => {
  const meta = { path: "Inbox/a.md", title: "a", folder: "Inbox", modified_ms: 1, placeholder: false };

  test("passes_the_expected_disk_content", async () => {
    mocks.invoke.mockResolvedValue(meta);
    await writeNote("Inbox/a.md", "mine", "before");
    expect(mocks.invoke).toHaveBeenCalledWith("write_note", {
      path: "Inbox/a.md",
      content: "mine",
      expected: "before",
    });
    await writeNote("Inbox/a.md", "mine");
    expect(mocks.invoke).toHaveBeenLastCalledWith("write_note", {
      path: "Inbox/a.md",
      content: "mine",
      expected: null,
    });
  });

  test("maps_a_conflict_to_write_conflict_error", async () => {
    mocks.invoke.mockRejectedValue("CONFLICT: Inbox/a.md changed on disk");
    await expect(writeNote("Inbox/a.md", "mine", "before")).rejects.toBeInstanceOf(WriteConflictError);
    mocks.invoke.mockRejectedValue("disk full");
    await expect(writeNote("Inbox/a.md", "mine", "before")).rejects.toBe("disk full");
  });
});
