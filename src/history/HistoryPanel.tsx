import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DiffView } from "../claude/DiffView";
import { collapseDiff, lineDiff, type DiffRow } from "../claude/lineDiff";
import type { EditorApi } from "../editor/Editor";
import type { NoteSession } from "../editor/noteSession";
import { listSnapshots, readSnapshot, saveSnapshot, type HistoryEntry } from "../lib/history";
import { splitFrontmatter } from "../markdown/frontmatter";
import { relativeTime } from "./relativeTime";

interface HistoryPanelProps {
  note: NoteSession | null;
  editor: EditorApi | null;
  onClose(): void;
}

interface Selected {
  id: string;
  body: string;
  rows: DiffRow[];
  same: boolean;
}

const firstLine = (text: string) => text.split("\n")[0];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function HistoryPanel({ note, editor, onClose }: HistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [, setTick] = useState(0);
  const asideRef = useRef<HTMLElement>(null);
  const noteRef = useRef(note);
  const editorRef = useRef(editor);
  const path = note?.path ?? null;

  useEffect(() => {
    noteRef.current = note;
    editorRef.current = editor;
  }, [note, editor]);

  useEffect(() => asideRef.current?.focus(), []);

  useEffect(() => note?.subscribe(() => setTick((tick) => tick + 1)), [note]);

  const load = (target: string, isCurrent: () => boolean) =>
    listSnapshots(target).then(
      (found) => {
        if (!isCurrent()) return;
        setEntries(found);
        setError(null);
      },
      (e: unknown) => {
        if (isCurrent()) setError(firstLine(message(e)));
      },
    );

  useEffect(() => {
    setEntries(null);
    setSelected(null);
    setError(null);
    setRestoring(false);
    if (path === null) return;
    let stale = false;
    void load(path, () => !stale);
    return () => {
      stale = true;
    };
  }, [path]);

  const select = async (id: string) => {
    if (!note || !editor) return;
    setError(null);
    try {
      const body = splitFrontmatter(await readSnapshot(note.path, id)).body;
      if (noteRef.current !== note) return;
      const lines = lineDiff(editor.currentBody(), body);
      setSelected({
        id,
        body,
        rows: collapseDiff(lines),
        same: lines.every((line) => line.kind === "same"),
      });
    } catch (e) {
      if (noteRef.current === note) setError(firstLine(message(e)));
    }
  };

  const restore = async () => {
    const session = noteRef.current;
    if (!selected || restoring || !session || session.state !== "ready" || !editorRef.current) return;
    setError(null);
    setRestoring(true);
    const usable = () => noteRef.current === session && session.state === "ready";
    try {
      await saveSnapshot(session.path, session.fileContent(), "Before restore");
      if (noteRef.current !== session) return;
      if (!usable()) return setRestoring(false);
      editorRef.current?.replaceBody(selected.body);
    } catch (e) {
      if (noteRef.current === session) {
        setError(firstLine(message(e)));
        setRestoring(false);
      }
      return;
    }
    setSelected(null);
    setRestoring(false);
    await load(session.path, () => noteRef.current === session);
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onClose();
  };

  const now = Date.now();
  const canRestore =
    selected !== null && !selected.same && !restoring && note?.state === "ready" && editor !== null;

  return (
    <aside ref={asideRef} className="tack-claude tack-history" aria-label="Note history" onKeyDown={onPanelKeyDown} tabIndex={-1}>
      <div className="tack-claude-header">
        <h2>History</h2>
        <button type="button" title="Close (Esc)" onClick={onClose}>
          Close
        </button>
      </div>
      {note === null && <p className="tack-claude-hint">Open a note to see its history.</p>}
      {error && (
        <p className="tack-error tack-claude-error" role="alert">
          {error}
        </p>
      )}
      {entries !== null && entries.length === 0 && (
        <p className="tack-claude-hint">
          No history yet. Tack saves a version before Claude changes a note or you restore one.
        </p>
      )}
      {entries !== null && entries.length > 0 && (
        <ul className="tack-history-list">
          {entries.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="tack-history-entry"
                aria-pressed={selected?.id === item.id}
                onClick={() => void select(item.id)}
              >
                <span className="tack-history-time">{relativeTime(item.createdMs, now)}</span>
                <span className="tack-history-reason">{item.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <>
          {selected.same ? (
            <p className="tack-claude-hint">Same as current</p>
          ) : (
            <DiffView rows={selected.rows} label="Changes if restored" />
          )}
          <div className="tack-claude-actions">
            <button type="button" className="tack-primary" disabled={!canRestore} onClick={() => void restore()}>
              Restore this version
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
