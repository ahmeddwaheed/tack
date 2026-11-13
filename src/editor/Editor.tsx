import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { useEffect, useRef, useState } from "react";
import { lintText } from "../grammar/harper";
import type { OpenNote } from "../layout/noteGuard";
import { TitleField } from "../layout/TitleField";
import type { TitleSearch } from "./linkPicker";
import { mountNoteEditor, type NoteEditor } from "./mountNoteEditor";
import { createNoteSession, type NoteIO, type NoteSession } from "./noteSession";
import { vaultNoteIO } from "./vaultNoteIO";

interface EditorProps {
  path: string;
  io?: NoteIO;
  onPathChange?(path: string): void;
  onConflictChange?(conflict: boolean): void;
  searchTitles?: TitleSearch;
  onOpen?(note: OpenNote | null): void;
  grammarEnabled?: boolean;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const titleOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

export function Editor({ path, io = vaultNoteIO, onPathChange, onConflictChange, searchTitles, onOpen, grammarEnabled = true }: EditorProps) {
  const [session, setSession] = useState<NoteSession | null>(null);
  const [openedPath, setOpenedPath] = useState(path);
  const [, setTick] = useState(0);
  const [watchError, setWatchError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NoteEditor | null>(null);
  const searchTitlesRef = useRef(searchTitles);
  const onOpenRef = useRef(onOpen);
  const grammarEnabledRef = useRef(grammarEnabled);
  const bannerRef = useRef<HTMLDivElement>(null);
  const [revealRequest, setRevealRequest] = useState(0);

  useEffect(() => {
    searchTitlesRef.current = searchTitles;
    onOpenRef.current = onOpen;
  }, [searchTitles, onOpen]);

  useEffect(() => {
    grammarEnabledRef.current = grammarEnabled;
    editorRef.current?.setGrammarEnabled(grammarEnabled);
  }, [grammarEnabled]);

  useEffect(() => {
    if (revealRequest > 0) bannerRef.current?.focus();
  }, [revealRequest]);

  const conflict = session?.state === "conflict";

  if (path !== openedPath && path !== session?.path && !conflict) setOpenedPath(path);

  useEffect(() => {
    const opened = createNoteSession(openedPath, io);
    const unsubscribe = opened.subscribe(() => setTick((tick) => tick + 1));
    setSession(opened);
    onOpenRef.current?.({
      session: opened,
      sync: () => editorRef.current?.sync(),
      revealConflict: () => setRevealRequest((request) => request + 1),
    });
    return () => {
      onOpenRef.current?.(null);
      unsubscribe();
      editorRef.current?.sync();
      // A session in conflict refuses to close. Switching is blocked then, so this only happens when the window goes away.
      opened.close().catch(() => undefined);
    };
  }, [openedPath, io]);

  useEffect(() => {
    if (!session || !io.watch) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let reads = Promise.resolve();
    const onChange = (paths: string[]) => {
      const changed = session.path;
      if (!paths.includes(changed)) return;
      reads = reads
        .then(() => io.read(changed))
        .then((content) => {
          if (stopped || session.path !== changed) return;
          // Keystrokes still in Milkdown's debounce must reach the session first, or a dirty note looks clean and gets reloaded.
          editorRef.current?.sync();
          session.onDiskChange(content);
        })
        .catch(() => undefined);
    };
    setWatchError(null);
    io.watch(onChange).then(
      (stop) => (stopped ? stop() : (unlisten = stop)),
      (e: unknown) => setWatchError(`Not watching for changes from other devices: ${message(e)}`),
    );
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [session, io]);

  useEffect(() => {
    onConflictChange?.(conflict);
  }, [conflict, onConflictChange]);

  const editable = session?.state === "ready" || session?.state === "conflict";
  const revision = session?.revision;

  useEffect(() => {
    const host = hostRef.current;
    if (!session || !editable || !host) return;
    const mountPoint = document.createElement("div");
    host.append(mountPoint);
    let cancelled = false;
    let mounted: NoteEditor | null = null;
    const dispose = (editor: NoteEditor) => {
      void editor.destroy().finally(() => mountPoint.remove());
    };
    const titles = (query: string) => searchTitlesRef.current?.(query) ?? [];
    void mountNoteEditor(mountPoint, session, titles, {
      lint: lintText,
      enabled: grammarEnabledRef.current,
    }).then((editor) => {
      if (cancelled) return dispose(editor);
      mounted = editor;
      editorRef.current = editor;
    });
    return () => {
      cancelled = true;
      if (mounted === null) return;
      if (editorRef.current === mounted) editorRef.current = null;
      dispose(mounted);
    };
  }, [session, editable, revision]);

  const rename = async (newTitle: string) => {
    if (!session) return;
    try {
      await session.rename(newTitle);
    } catch {
      return;
    }
    onPathChange?.(session.path);
  };

  const keepMine = () => {
    editorRef.current?.sync();
    void session?.resolve("mine");
  };

  return (
    <div className="tack-note">
      <TitleField title={titleOf(session?.path ?? path)} onRename={(title) => void rename(title)} />
      {conflict && (
        <div ref={bannerRef} tabIndex={-1} className="tack-conflict" role="alertdialog" aria-label="Note conflict">
          <p>This note changed on another device.</p>
          <button type="button" onClick={keepMine}>
            Keep mine
          </button>
          <button type="button" onClick={() => void session.resolve("theirs")}>
            Use theirs
          </button>
        </div>
      )}
      {session?.state === "loading" && <p className="tack-status">Loading…</p>}
      {session?.error && (
        <p className="tack-error" role="alert">
          {session.error}
        </p>
      )}
      {watchError && (
        <p className="tack-error" role="alert">
          {watchError}
        </p>
      )}
      <div ref={hostRef} className="tack-editor" hidden={!editable} />
    </div>
  );
}
