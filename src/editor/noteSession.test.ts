import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { splitFrontmatter } from "../markdown/frontmatter";
import { WriteConflictError } from "../lib/vault";
import { createNoteSession, NoteConflictError, type NoteIO } from "./noteSession";

const ORIGINAL = "---\ntype: note\ntags: [a]\n---\n# Title\n\nBody text.\n";

interface FakeIO extends NoteIO {
  writes: { path: string; content: string }[];
  renames: { path: string; newTitle: string }[];
}

function fakeIO(read: () => Promise<string> = () => Promise.resolve(ORIGINAL)): FakeIO {
  const writes: { path: string; content: string }[] = [];
  const renames: { path: string; newTitle: string }[] = [];
  return {
    writes,
    renames,
    read: () => read(),
    write: async (path, content) => {
      writes.push({ path, content });
    },
    rename: async (path, newTitle) => {
      renames.push({ path, newTitle });
      return `Inbox/${newTitle}.md`;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("noteSession", () => {
  test("opening_and_closing_without_edits_never_writes", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    expect(session.state).toBe("ready");
    expect(session.body).toBe("# Title\n\nBody text.\n");
    await vi.advanceTimersByTimeAsync(2000);
    await session.close();
    expect(io.writes).toEqual([]);
  });

  test("edit_saves_after_600ms_with_original_frontmatter", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("# Title\n\nChanged.\n");
    expect(session.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(io.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(io.writes).toEqual([
      { path: "Inbox/a.md", content: "---\ntype: note\ntags: [a]\n---\n# Title\n\nChanged.\n" },
    ]);
    expect(session.dirty).toBe(false);
  });

  test("two_edits_within_600ms_write_once", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("one\n");
    await vi.advanceTimersByTimeAsync(400);
    session.edit("two\n");
    await vi.advanceTimersByTimeAsync(400);
    expect(io.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(io.writes.map((w) => w.content)).toEqual(["---\ntype: note\ntags: [a]\n---\ntwo\n"]);
  });

  test("no_write_while_loading", async () => {
    const io = fakeIO(() => new Promise<string>(() => {}));
    const session = createNoteSession("Inbox/a.md", io);
    expect(session.state).toBe("loading");
    session.edit("typed before load\n");
    await vi.advanceTimersByTimeAsync(1000);
    await session.flush();
    expect(io.writes).toEqual([]);
  });

  test("own_write_echo_is_ignored", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    await vi.advanceTimersByTimeAsync(600);
    const lastWritten = io.writes[0]?.content ?? "";
    const revision = session.revision;
    session.onDiskChange(lastWritten);
    expect(session.state).toBe("ready");
    expect(session.body).toBe("mine\n");
    expect(session.revision).toBe(revision);
  });

  test("echo_of_the_original_read_is_ignored", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    const revision = session.revision;
    session.onDiskChange(ORIGINAL);
    expect(session.state).toBe("ready");
    expect(session.revision).toBe(revision);
  });

  test("failed_read_never_writes", async () => {
    const io = fakeIO(() => Promise.reject(new Error("iCloud download timed out")));
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    expect(session.state).toBe("error");
    expect(session.error).toBe("iCloud download timed out");
    session.edit("");
    await vi.advanceTimersByTimeAsync(1000);
    await session.close();
    expect(io.writes).toEqual([]);
  });

  test("close_flushes_a_pending_edit", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("pending\n");
    await session.close();
    expect(io.writes.map((w) => w.content)).toEqual(["---\ntype: note\ntags: [a]\n---\npending\n"]);
    session.edit("after close\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(io.writes).toHaveLength(1);
  });

  test("edit_with_unchanged_body_is_not_dirty", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit(session.body);
    expect(session.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(io.writes).toEqual([]);
  });

  test("failed_write_stays_dirty_and_shows_the_error", async () => {
    const io = fakeIO();
    io.write = () => Promise.reject(new Error("placeholder only"));
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(session.dirty).toBe(true);
    expect(session.error).toBe("placeholder only");
  });

  test("disk_change_without_local_edits_reloads", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    const revision = session.revision;
    session.onDiskChange("---\ntype: meeting\n---\nFrom the phone.\n");
    expect(session.state).toBe("ready");
    expect(session.body).toBe("From the phone.\n");
    expect(session.revision).toBe(revision + 1);
    session.edit("Then mine.\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(io.writes.map((w) => w.content)).toEqual(["---\ntype: meeting\n---\nThen mine.\n"]);
  });

  test("disk_change_with_unsaved_edits_is_a_conflict_and_blocks_writes", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    session.onDiskChange("theirs\n");
    expect(session.state).toBe("conflict");
    await vi.advanceTimersByTimeAsync(1000);
    await session.flush();
    expect(io.writes).toEqual([]);
  });

  test("resolve_mine_writes_mine", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    session.onDiskChange("theirs\n");
    await session.resolve("mine");
    expect(session.state).toBe("ready");
    expect(io.writes.map((w) => w.content)).toEqual(["---\ntype: note\ntags: [a]\n---\nmine\n"]);
  });

  test("resolve_theirs_adopts_theirs_without_writing", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    session.onDiskChange("theirs\n");
    await session.resolve("theirs");
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.state).toBe("ready");
    expect(session.body).toBe("theirs\n");
    expect(session.dirty).toBe(false);
    expect(io.writes).toEqual([]);
  });

  test("rename_flushes_then_continues_on_the_new_path", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("before rename\n");
    await session.rename("b");
    expect(io.writes.map((w) => w.path)).toEqual(["Inbox/a.md"]);
    expect(io.renames).toEqual([{ path: "Inbox/a.md", newTitle: "b" }]);
    expect(session.path).toBe("Inbox/b.md");
    session.edit("after rename\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(io.writes.map((w) => w.path)).toEqual(["Inbox/a.md", "Inbox/b.md"]);
  });

  test("a_throwing_listener_does_not_stop_later_autosaves", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    let thrown = false;
    session.subscribe(() => {
      if (!thrown && !session.dirty) {
        thrown = true;
        throw new Error("listener failed");
      }
    });
    session.edit("one\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(session.error).toBe("listener failed");
    session.edit("two\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(io.writes.map((w) => w.content)).toEqual([
      "---\ntype: note\ntags: [a]\n---\none\n",
      "---\ntype: note\ntags: [a]\n---\ntwo\n",
    ]);
    expect(session.error).toBeNull();
  });

  test("subscribers_are_notified_of_state_changes", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    await session.loaded;
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    session.edit("x\n");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("noteSession external edits", () => {
  const THEIRS = "---\ntype: note\n---\nFrom the phone.\n";
  const withFrontmatter = (body: string) => `---\ntype: note\ntags: [a]\n---\n${body}`;

  async function openDirtyConflict() {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    session.onDiskChange(THEIRS);
    return { io, session };
  }

  test("disk_change_when_clean_reloads_body", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    const revision = session.revision;
    session.onDiskChange(THEIRS);
    expect(session.state).toBe("ready");
    expect(session.body).toBe("From the phone.\n");
    expect(session.dirty).toBe(false);
    expect(session.theirs).toBeNull();
    expect(session.revision).toBe(revision + 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(io.writes).toEqual([]);
  });

  test("disk_change_when_dirty_enters_conflict_and_does_not_write", async () => {
    const { io, session } = await openDirtyConflict();
    expect(session.state).toBe("conflict");
    expect(session.body).toBe("mine\n");
    expect(session.theirs).toBe(THEIRS);
    session.edit("mine, still typing\n");
    await vi.advanceTimersByTimeAsync(2000);
    await session.flush();
    expect(io.writes).toEqual([]);
    expect(session.body).toBe("mine, still typing\n");
  });

  test("a_newer_disk_change_during_a_conflict_replaces_theirs", async () => {
    const { session } = await openDirtyConflict();
    session.onDiskChange("newer\n");
    expect(session.state).toBe("conflict");
    expect(session.theirs).toBe("newer\n");
  });

  test("resolve_mine_writes_local_body", async () => {
    const { io, session } = await openDirtyConflict();
    await session.resolve("mine");
    expect(session.state).toBe("ready");
    expect(session.theirs).toBeNull();
    expect(io.writes).toEqual([{ path: "Inbox/a.md", content: withFrontmatter("mine\n") }]);
    session.onDiskChange(withFrontmatter("mine\n"));
    expect(session.state).toBe("ready");
    expect(session.body).toBe("mine\n");
  });

  test("resolve_theirs_replaces_body_without_write", async () => {
    const { io, session } = await openDirtyConflict();
    const revision = session.revision;
    await session.resolve("theirs");
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.state).toBe("ready");
    expect(session.body).toBe("From the phone.\n");
    expect(session.dirty).toBe(false);
    expect(session.theirs).toBeNull();
    expect(session.revision).toBe(revision + 1);
    expect(io.writes).toEqual([]);
  });

  test("a_late_echo_of_an_older_own_write_is_ignored", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("A\n");
    await vi.advanceTimersByTimeAsync(600);
    session.edit("B\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(io.writes.map((w) => w.content)).toEqual([withFrontmatter("A\n"), withFrontmatter("B\n")]);
    const revision = session.revision;
    session.onDiskChange(withFrontmatter("A\n"));
    expect(session.state).toBe("ready");
    expect(session.body).toBe("B\n");
    expect(session.revision).toBe(revision);
    session.edit("C\n");
    session.onDiskChange(withFrontmatter("A\n"));
    expect(session.state).toBe("ready");
  });

  test("only_the_last_five_own_writes_count_as_echoes", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    for (const body of ["1\n", "2\n", "3\n", "4\n", "5\n", "6\n"]) {
      session.edit(body);
      await vi.advanceTimersByTimeAsync(600);
    }
    session.onDiskChange(withFrontmatter("2\n"));
    expect(session.body).toBe("6\n");
    session.onDiskChange(withFrontmatter("1\n"));
    expect(session.body).toBe("1\n");
  });

  test("a_failed_write_is_not_treated_as_an_echo", async () => {
    const io = fakeIO();
    io.write = () => Promise.reject(new Error("disk full"));
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    await vi.advanceTimersByTimeAsync(600);
    session.edit("mine 2\n");
    session.onDiskChange(withFrontmatter("mine\n"));
    expect(session.state).toBe("conflict");
  });

  test("a_reverted_external_change_is_adopted", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.onDiskChange(THEIRS);
    expect(session.body).toBe("From the phone.\n");
    session.onDiskChange(ORIGINAL);
    expect(session.state).toBe("ready");
    expect(session.body).toBe("# Title\n\nBody text.\n");
  });

  test("an_unchanged_disk_event_while_dirty_is_not_a_conflict", async () => {
    const io = fakeIO();
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("mine\n");
    session.onDiskChange(ORIGINAL);
    expect(session.state).toBe("ready");
    expect(session.dirty).toBe(true);
  });

  function diskIO(initial: string) {
    const disk = { content: initial };
    const writes: { content: string; expected: string | undefined }[] = [];
    const io: NoteIO = {
      read: async () => disk.content,
      write: async (_, content, expected) => {
        if (expected !== undefined && expected !== disk.content) throw new WriteConflictError("Inbox/a.md");
        writes.push({ content, expected });
        disk.content = content;
      },
      rename: async (path) => path,
    };
    return { io, disk, writes };
  }

  test("writes_pass_the_last_known_disk_content_as_expected", async () => {
    const { io, writes } = diskIO(ORIGINAL);
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("one\n");
    await vi.advanceTimersByTimeAsync(600);
    session.edit("two\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([
      { content: withFrontmatter("one\n"), expected: ORIGINAL },
      { content: withFrontmatter("two\n"), expected: withFrontmatter("one\n") },
    ]);
  });

  test("a_disk_change_not_yet_reported_refuses_the_autosave_and_enters_conflict", async () => {
    const { io, disk, writes } = diskIO(ORIGINAL);
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    disk.content = THEIRS;
    session.edit("mine\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([]);
    expect(disk.content).toBe(THEIRS);
    expect(session.state).toBe("conflict");
    expect(session.body).toBe("mine\n");
    expect(session.theirs).toBe(THEIRS);
    expect(session.dirty).toBe(true);
    expect(session.error).toBeNull();
    session.onDiskChange(THEIRS);
    expect(session.state).toBe("conflict");
    await session.resolve("mine");
    expect(writes).toEqual([{ content: withFrontmatter("mine\n"), expected: THEIRS }]);
    expect(session.state).toBe("ready");
  });

  test("a_refused_write_whose_disk_matches_mine_is_not_a_conflict", async () => {
    const { io, disk, writes } = diskIO(ORIGINAL);
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    disk.content = withFrontmatter("same\n");
    session.edit("same\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([]);
    expect(session.state).toBe("ready");
    expect(session.dirty).toBe(false);
  });

  test("a_phone_edit_during_an_in_flight_save_is_a_conflict_and_keeps_my_text", async () => {
    const { io, disk, writes } = diskIO(ORIGINAL);
    let rejectWrite: (e: unknown) => void = () => {};
    const write = io.write;
    io.write = (path, content, expected) => {
      if (disk.content !== ORIGINAL) return write(path, content, expected);
      return new Promise<void>((_, reject) => {
        rejectWrite = reject;
      });
    };
    const session = createNoteSession("Inbox/a.md", io);
    await session.loaded;
    session.edit("typed on the mac\n");
    await vi.advanceTimersByTimeAsync(600);
    disk.content = THEIRS;
    session.onDiskChange(THEIRS);
    rejectWrite(new WriteConflictError("Inbox/a.md"));
    await session.flush();
    expect(session.state).toBe("conflict");
    expect(session.body).toBe("typed on the mac\n");
    expect(session.theirs).toBe(THEIRS);
    expect(session.dirty).toBe(true);
    expect(writes).toEqual([]);
    await session.resolve("mine");
    expect(writes).toEqual([{ content: withFrontmatter("typed on the mac\n"), expected: THEIRS }]);
  });

  test("close_during_conflict_rejects_and_keeps_both_sides", async () => {
    const { io, session } = await openDirtyConflict();
    await expect(session.close()).rejects.toBeInstanceOf(NoteConflictError);
    expect(session.state).toBe("conflict");
    expect(session.body).toBe("mine\n");
    expect(session.theirs).toBe(THEIRS);
    expect(io.writes).toEqual([]);
    await session.resolve("mine");
    expect(io.writes.map((w) => w.content)).toEqual([withFrontmatter("mine\n")]);
    await session.close();
  });

  test("rename_is_rejected_unless_ready", async () => {
    const loadingIO = fakeIO(() => new Promise<string>(() => {}));
    const loading = createNoteSession("Inbox/a.md", loadingIO);
    await expect(loading.rename("b")).rejects.toThrow("Cannot rename the note while it is loading.");
    const { io, session } = await openDirtyConflict();
    await expect(session.rename("b")).rejects.toThrow("Cannot rename the note while it is in conflict.");
    expect(io.renames).toEqual([]);
    expect(session.path).toBe("Inbox/a.md");
  });
});

const fixtures = import.meta.glob<string>("../markdown/fixtures/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("noteSession with fixtures", () => {
  test.each(Object.entries(fixtures))("%s opened and closed is never written", async (_, src) => {
    const io = fakeIO(() => Promise.resolve(src));
    const session = createNoteSession("Inbox/fixture.md", io);
    await session.loaded;
    await vi.advanceTimersByTimeAsync(2000);
    await session.close();
    expect(io.writes).toEqual([]);
  });

  test.each(Object.entries(fixtures))("%s edited keeps the frontmatter bytes", async (_, src) => {
    const io = fakeIO(() => Promise.resolve(src));
    const session = createNoteSession("Inbox/fixture.md", io);
    await session.loaded;
    session.edit(`${session.body}\nAdded line.\n`);
    await session.close();
    const written = io.writes[0]?.content ?? "";
    expect(splitFrontmatter(written).frontmatter).toBe(splitFrontmatter(src).frontmatter);
  });
});
