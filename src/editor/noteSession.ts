import { WriteConflictError } from "../lib/vault";
import { joinFrontmatter, splitFrontmatter } from "../markdown/frontmatter";

export const AUTOSAVE_DELAY_MS = 600;
export const RECENT_CONTENTS = 5;

export class NoteConflictError extends Error {
  constructor() {
    super("This note changed on another device. Keep mine or use theirs before closing it.");
    this.name = "NoteConflictError";
  }
}

export interface NoteIO {
  read(path: string): Promise<string>;
  write(path: string, content: string, expected?: string): Promise<void>;
  rename(path: string, newTitle: string): Promise<string>;
  watch?(onChange: (paths: string[]) => void): Promise<() => void>;
}

export type NoteSessionState = "loading" | "ready" | "conflict" | "error";

export interface NoteSession {
  readonly path: string;
  readonly state: NoteSessionState;
  readonly body: string;
  readonly dirty: boolean;
  readonly error: string | null;
  readonly revision: number;
  readonly theirs: string | null;
  readonly loaded: Promise<void>;
  edit(body: string): void;
  flush(): Promise<void>;
  onDiskChange(content: string): void;
  resolve(choice: "mine" | "theirs"): Promise<void>;
  rename(newTitle: string): Promise<void>;
  close(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createNoteSession(initialPath: string, io: NoteIO): NoteSession {
  let path = initialPath;
  let state: NoteSessionState = "loading";
  let frontmatter = "";
  let body = "";
  let dirty = false;
  let error: string | null = null;
  let revision = 0;
  let closed = false;
  let onDisk = "";
  let recent: string[] = [];
  let theirs: string | null = null;
  let inFlight: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());

  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const remember = (content: string) => {
    recent = [...recent.filter((c) => c !== content), content].slice(-RECENT_CONTENTS);
  };

  const forget = (content: string) => {
    recent = recent.filter((c) => c !== content);
  };

  const adopt = (content: string) => {
    const parts = splitFrontmatter(content);
    frontmatter = parts.frontmatter;
    body = parts.body;
    onDisk = content;
    recent = [];
    dirty = false;
    revision += 1;
  };

  const enqueue = (op: () => Promise<void>): Promise<void> => {
    queue = queue.then(op).catch((e: unknown) => {
      error = message(e);
    });
    return queue;
  };

  const enterConflict = (content: string) => {
    cancelTimer();
    theirs = content;
    state = "conflict";
    error = null;
  };

  const refusedBy = async () => {
    try {
      const disk = await io.read(path);
      if (state === "conflict") {
        theirs = disk;
      } else if (disk === joinFrontmatter(frontmatter, body)) {
        onDisk = disk;
        dirty = false;
      } else {
        enterConflict(disk);
      }
    } catch (e) {
      error = message(e);
    }
  };

  const writeIfDirty = async () => {
    if (state !== "ready" || !dirty) return;
    const content = joinFrontmatter(frontmatter, body);
    const alreadyKnown = recent.includes(content);
    remember(content);
    dirty = false;
    inFlight = content;
    try {
      await io.write(path, content, onDisk);
      onDisk = content;
      error = null;
    } catch (e) {
      if (!alreadyKnown) forget(content);
      dirty = true;
      if (e instanceof WriteConflictError) await refusedBy();
      else error = message(e);
    } finally {
      inFlight = null;
    }
    notify();
  };

  const flush = () => {
    cancelTimer();
    return enqueue(writeIfDirty);
  };

  const loaded = io.read(path).then(
    (content) => {
      if (closed) return;
      adopt(content);
      state = "ready";
      notify();
    },
    (e: unknown) => {
      state = "error";
      error = message(e);
      notify();
    },
  );

  return {
    get path() {
      return path;
    },
    get state() {
      return state;
    },
    get body() {
      return body;
    },
    get dirty() {
      return dirty;
    },
    get error() {
      return error;
    },
    get revision() {
      return revision;
    },
    get theirs() {
      return theirs;
    },
    loaded,

    edit(next) {
      if (closed || (state !== "ready" && state !== "conflict") || next === body) return;
      body = next;
      dirty = true;
      cancelTimer();
      if (state === "ready") timer = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
      notify();
    },

    flush,

    onDiskChange(content) {
      if (closed || state === "loading") return;
      if (state === "conflict") {
        theirs = content;
        notify();
        return;
      }
      if (content === onDisk || recent.includes(content)) return;
      if (content === joinFrontmatter(frontmatter, body)) {
        onDisk = content;
        return;
      }
      if (state === "ready" && (dirty || inFlight !== null)) {
        dirty = true;
        enterConflict(content);
      } else {
        adopt(content);
        state = "ready";
        error = null;
      }
      notify();
    },

    async resolve(choice) {
      if (state !== "conflict" || theirs === null) return;
      if (choice === "theirs") {
        adopt(theirs);
      } else {
        onDisk = theirs;
        dirty = true;
      }
      theirs = null;
      state = "ready";
      notify();
      await flush();
    },

    async rename(newTitle) {
      if (state !== "ready") {
        throw new Error(`Cannot rename the note while it is ${state === "loading" ? state : `in ${state}`}.`);
      }
      await flush();
      await enqueue(async () => {
        try {
          path = await io.rename(path, newTitle);
          error = null;
        } catch (e) {
          error = message(e);
        }
        notify();
      });
    },

    async close() {
      if (closed) return;
      if (state === "conflict") throw new NoteConflictError();
      await flush();
      closed = true;
      cancelTimer();
      listeners.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
