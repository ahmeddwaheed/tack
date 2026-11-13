import { describe, expect, test, vi } from "vitest";
import { createNoteSession, NoteConflictError, type NoteIO, type NoteSession } from "../editor/noteSession";
import { WriteConflictError } from "../lib/vault";
import { handleCloseRequest, switchNote, trashWithGuard, windowAction, type OpenNote } from "./noteGuard";

const ORIGINAL = "---\ntype: note\n---\n\nHello\n";

const fakeDisk = (initial = ORIGINAL) => {
  const disk = { content: initial, writes: [] as string[], refuse: false };
  const io: NoteIO = {
    read: async () => disk.content,
    write: async (_path, content, expected) => {
      if (disk.refuse || (expected !== undefined && expected !== disk.content)) throw new WriteConflictError("x");
      disk.content = content;
      disk.writes.push(content);
    },
    rename: async (path) => path,
  };
  return { disk, io };
};

const openNote = (session: NoteSession, pending?: string): OpenNote & { reveal: ReturnType<typeof vi.fn> } => {
  const reveal = vi.fn();
  return {
    session,
    sync: () => {
      if (pending !== undefined) session.edit(pending);
    },
    revealConflict: reveal,
    reveal,
  };
};

const ready = async (io: NoteIO, path = "Inbox/a.md") => {
  const session = createNoteSession(path, io);
  await session.loaded;
  return session;
};

describe("windowAction", () => {
  test("a plain close hides the window so quick capture keeps working", () => {
    expect(windowAction("close", "done")).toBe("hide");
  });

  test("only quitting destroys the window", () => {
    expect(windowAction("quit", "done")).toBe("destroy");
  });

  test("a conflict or an unsaved answer keeps the window shown for close and quit", () => {
    for (const kind of ["close", "quit"] as const) {
      expect(windowAction(kind, "blocked")).toBe("stay");
      expect(windowAction(kind, "unsaved")).toBe("stay");
    }
  });
});

describe("handleCloseRequest", () => {
  test("closes the window when no note is open", async () => {
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(null, closeWindow)).toBe("done");
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  test("saves unsaved edits, including ones still in the editor, before the window closes", async () => {
    const { disk, io } = fakeDisk();
    const session = await ready(io);
    session.edit("Typed\n");
    const order: string[] = [];
    const closeWindow = vi.fn(async () => {
      order.push(`close with ${disk.writes.length} write(s)`);
    });
    expect(await handleCloseRequest(openNote(session, "Typed and more\n"), closeWindow)).toBe("done");
    expect(disk.writes).toEqual(["---\ntype: note\n---\nTyped and more\n"]);
    expect(order).toEqual(["close with 1 write(s)"]);
  });

  test("a clean note closes without writing", async () => {
    const { disk, io } = fakeDisk();
    const session = await ready(io);
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(openNote(session), closeWindow)).toBe("done");
    expect(disk.writes).toEqual([]);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  test("a note in conflict keeps the window open and shows the banner", async () => {
    const { disk, io } = fakeDisk();
    const session = await ready(io);
    session.edit("Mine\n");
    session.onDiskChange("Theirs\n");
    const open = openNote(session);
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(open, closeWindow)).toBe("blocked");
    expect(closeWindow).not.toHaveBeenCalled();
    expect(open.reveal).toHaveBeenCalledTimes(1);
    expect(disk.writes).toEqual([]);
    expect(session.state).toBe("conflict");
    expect(session.body).toBe("Mine\n");
  });

  test("a save refused because the disk changed keeps the window open", async () => {
    const { disk, io } = fakeDisk();
    const session = await ready(io);
    session.edit("Mine\n");
    disk.content = "From the phone\n";
    const open = openNote(session);
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(open, closeWindow)).toBe("blocked");
    expect(closeWindow).not.toHaveBeenCalled();
    expect(open.reveal).toHaveBeenCalledTimes(1);
    expect(session.state).toBe("conflict");
    expect(disk.content).toBe("From the phone\n");
  });
});

describe("switchNote", () => {
  test("saves the current note before the next one opens", async () => {
    const { disk, io } = fakeDisk();
    const session = await ready(io);
    session.edit("Edited\n");
    const opened: string[] = [];
    const openPath = vi.fn((path: string) => {
      opened.push(`${path} after ${disk.writes.length} write(s)`);
    });
    expect(await switchNote(openNote(session), "Inbox/b.md", openPath)).toBe("done");
    expect(opened).toEqual(["Inbox/b.md after 1 write(s)"]);
  });

  test("is blocked while the current note is in conflict", async () => {
    const { disk, io } = fakeDisk();
    const session = await ready(io);
    session.edit("Mine\n");
    session.onDiskChange("Theirs\n");
    const open = openNote(session);
    const openPath = vi.fn();
    expect(await switchNote(open, "Inbox/b.md", openPath)).toBe("blocked");
    expect(openPath).not.toHaveBeenCalled();
    expect(open.reveal).toHaveBeenCalledTimes(1);
    expect(disk.writes).toEqual([]);
  });

  test("opening the note that is already open does nothing", async () => {
    const { io } = fakeDisk();
    const session = await ready(io, "Inbox/a.md");
    const openPath = vi.fn();
    expect(await switchNote(openNote(session), "Inbox/a.md", openPath)).toBe("done");
    expect(openPath).not.toHaveBeenCalled();
    expect(session.state).toBe("ready");
  });

  test("opens directly when no note is open", async () => {
    const openPath = vi.fn();
    expect(await switchNote(null, "Inbox/b.md", openPath)).toBe("done");
    expect(openPath).toHaveBeenCalledWith("Inbox/b.md");
  });
});

const failingDisk = () => {
  const { disk, io } = fakeDisk();
  const failing: NoteIO = {
    ...io,
    write: async () => {
      throw new Error("disk full");
    },
  };
  return { disk, io: failing };
};

const conflictOnClose = (path = "Inbox/a.md"): OpenNote & { reveal: ReturnType<typeof vi.fn> } => {
  const reveal = vi.fn();
  const session = {
    path,
    state: "ready",
    dirty: false,
    flush: async () => undefined,
    close: async () => {
      throw new NoteConflictError();
    },
  } as unknown as NoteSession;
  return { session, sync: () => undefined, revealConflict: reveal, reveal };
};

describe("unsaved edits after a failed save", () => {
  test("close reports unsaved and keeps the note open with its text", async () => {
    const { io } = failingDisk();
    const session = await ready(io);
    session.edit("Unsaved\n");
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(openNote(session), closeWindow)).toBe("unsaved");
    expect(closeWindow).not.toHaveBeenCalled();
    expect(session.body).toBe("Unsaved\n");
    expect(session.dirty).toBe(true);
    session.edit("Still editable\n");
    expect(session.body).toBe("Still editable\n");
  });

  test("close asks with the note title and keeps the window open when the user keeps it", async () => {
    const { io } = failingDisk();
    const session = await ready(io, "Inbox/Groceries.md");
    session.edit("Unsaved\n");
    const confirmDiscard = vi.fn(async () => false);
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(openNote(session), closeWindow, confirmDiscard)).toBe("unsaved");
    expect(confirmDiscard).toHaveBeenCalledWith("Groceries");
    expect(closeWindow).not.toHaveBeenCalled();
    expect(session.body).toBe("Unsaved\n");
  });

  test("close goes ahead only after an explicit discard", async () => {
    const { io } = failingDisk();
    const session = await ready(io);
    session.edit("Unsaved\n");
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(openNote(session), closeWindow, async () => true)).toBe("done");
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  test("switch reports unsaved and does not open the next note", async () => {
    const { io } = failingDisk();
    const session = await ready(io);
    session.edit("Unsaved\n");
    const openPath = vi.fn();
    expect(await switchNote(openNote(session), "Inbox/b.md", openPath, async () => false)).toBe("unsaved");
    expect(openPath).not.toHaveBeenCalled();
    expect(session.body).toBe("Unsaved\n");
  });
});

describe("a conflict that appears while closing", () => {
  test("close is blocked and the banner revealed", async () => {
    const open = conflictOnClose();
    const closeWindow = vi.fn(async () => undefined);
    expect(await handleCloseRequest(open, closeWindow)).toBe("blocked");
    expect(closeWindow).not.toHaveBeenCalled();
    expect(open.reveal).toHaveBeenCalledTimes(1);
  });

  test("switch is blocked and the banner revealed", async () => {
    const open = conflictOnClose();
    const openPath = vi.fn();
    expect(await switchNote(open, "Inbox/b.md", openPath)).toBe("blocked");
    expect(openPath).not.toHaveBeenCalled();
    expect(open.reveal).toHaveBeenCalledTimes(1);
  });
});

describe("trashWithGuard", () => {
  test("trashes the named note and leaves a different open note alone", async () => {
    const { disk, io } = fakeDisk();
    const current = await ready(io, "Inbox/b.md");
    current.edit("B edits\n");
    const trash = vi.fn(async () => undefined);
    expect(await trashWithGuard(openNote(current), "Inbox/a.md", trash)).toBe("done");
    expect(trash).toHaveBeenCalledWith("Inbox/a.md");
    expect(trash).toHaveBeenCalledTimes(1);
    expect(current.state).toBe("ready");
    expect(current.body).toBe("B edits\n");
    expect(disk.writes).toEqual([]);
  });

  test("saves and closes the open note before trashing it", async () => {
    const { disk, io } = fakeDisk();
    const session = await ready(io, "Inbox/a.md");
    session.edit("Edited\n");
    const order: string[] = [];
    const trash = vi.fn(async (path: string) => {
      order.push(`${path} after ${disk.writes.length} write(s)`);
    });
    expect(await trashWithGuard(openNote(session), "Inbox/a.md", trash)).toBe("done");
    expect(order).toEqual(["Inbox/a.md after 1 write(s)"]);
  });

  test("does not trash the open note while it is in conflict", async () => {
    const { io } = fakeDisk();
    const session = await ready(io, "Inbox/a.md");
    session.edit("Mine\n");
    session.onDiskChange("Theirs\n");
    const open = openNote(session);
    const trash = vi.fn(async () => undefined);
    expect(await trashWithGuard(open, "Inbox/a.md", trash)).toBe("blocked");
    expect(trash).not.toHaveBeenCalled();
    expect(open.reveal).toHaveBeenCalledTimes(1);
  });
});
