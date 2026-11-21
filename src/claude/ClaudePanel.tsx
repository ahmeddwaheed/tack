import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { EditorApi } from "../editor/Editor";
import type { NoteSession } from "../editor/noteSession";
import { noteTitle } from "../layout/noteGuard";
import { askClaude, ClaudeError, type ClaudeRun } from "../lib/claude";
import { saveSnapshot } from "../lib/history";
import { splitFrontmatter } from "../markdown/frontmatter";
import { DiffView } from "./DiffView";
import { collapseDiff, lineDiff, type DiffRow } from "./lineDiff";
import { buildAskPrompt, EmptyResultError, extractNoteBody, noteMarkers, QUICK_ACTIONS } from "./prompt";

interface ClaudePanelProps {
  note: NoteSession | null;
  editor: EditorApi | null;
  onClose(): void;
}

interface Request {
  instruction: string;
  reason: string;
}

type Phase =
  | { kind: "idle"; error: string | null }
  | { kind: "running"; request: Request; progress: string }
  | {
      kind: "result";
      request: Request;
      bodySent: string;
      after: string;
      rows: DiffRow[];
      changed: boolean;
      error: string | null;
      stale: boolean;
      applying: boolean;
    };

const IDLE: Phase = { kind: "idle", error: null };
const REASON_LENGTH = 40;
const PROGRESS_TAIL = 800;
const STALE = "The note changed while Claude worked. Ask again.";
const EMPTY = "Claude returned an empty note. Nothing was changed.";

const firstLine = (text: string) => text.split("\n")[0];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const errorText = (error: unknown): string | null => {
  if (error instanceof ClaudeError) {
    if (error.kind === "cancelled") return null;
    return error.kind === "failed" ? firstLine(error.message) : error.message;
  }
  if (error instanceof EmptyResultError) return EMPTY;
  return firstLine(message(error));
};

const withoutFrontmatter = (output: string, bodySent: string) => {
  if (splitFrontmatter(bodySent).frontmatter !== "") return output;
  const { frontmatter, body: rest } = splitFrontmatter(output);
  if (frontmatter === "") return output;
  if (rest.trim() === "") throw new EmptyResultError();
  return rest.replace(/^(?:[ \t]*\r?\n)+/, "");
};

const isComposing = (event: KeyboardEvent) =>
  // WebKit reports keyCode 229 without isComposing for the key that ends an IME composition.
  event.nativeEvent.isComposing || event.keyCode === 229;

export function ClaudePanel({ note, editor, onClose }: ClaudePanelProps) {
  const [phase, setPhaseState] = useState<Phase>(IDLE);
  const [instruction, setInstruction] = useState("");
  const [, setTick] = useState(0);
  const phaseRef = useRef<Phase>(IDLE);
  const runRef = useRef<ClaudeRun | null>(null);
  const noteRef = useRef(note);
  const editorRef = useRef(editor);

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  useEffect(() => {
    noteRef.current = note;
    editorRef.current = editor;
  }, [note, editor]);

  useEffect(() => note?.subscribe(() => setTick((tick) => tick + 1)), [note]);

  useEffect(() => {
    phaseRef.current = IDLE;
    setPhaseState(IDLE);
    return () => {
      const run = runRef.current;
      runRef.current = null;
      run?.cancel().catch(() => undefined);
    };
  }, [note]);

  const canAsk = note !== null && editor !== null;
  const running = phase.kind === "running";

  const start = (request: Request) => {
    if (!note || !editor || runRef.current) return;
    const bodySent = editor.currentBody();
    const markers = noteMarkers(bodySent);
    const prompt = buildAskPrompt(request.instruction, bodySent, noteTitle(note.path), markers);
    const run = askClaude(prompt, (progress) => {
      if (runRef.current === run) setPhase({ kind: "running", request, progress });
    });
    runRef.current = run;
    setPhase({ kind: "running", request, progress: "" });
    run.result
      .then((output) => {
        const after = withoutFrontmatter(extractNoteBody(output, markers), bodySent);
        const lines = lineDiff(bodySent, after);
        return {
          after,
          rows: collapseDiff(lines),
          changed: lines.some((line) => line.kind !== "same"),
        };
      })
      .then(
        ({ after, rows, changed }) => {
          if (runRef.current !== run) return;
          runRef.current = null;
          setPhase({
            kind: "result",
            request,
            bodySent,
            after,
            rows,
            changed,
            error: null,
            stale: false,
            applying: false,
          });
        },
        (error: unknown) => {
          if (runRef.current !== run) return;
          runRef.current = null;
          setPhase({ kind: "idle", error: errorText(error) });
        },
      );
  };

  const cancel = () => {
    const run = runRef.current;
    runRef.current = null;
    setPhase(IDLE);
    run?.cancel().catch(() => undefined);
  };

  const submit = () => {
    const text = instruction.trim();
    if (text === "") return;
    start({ instruction: text, reason: text.slice(0, REASON_LENGTH) });
  };

  const accept = async () => {
    const current = phaseRef.current;
    const session = noteRef.current;
    if (current.kind !== "result" || current.applying || current.stale || !session || session.state !== "ready") return;
    const isStale = () => editorRef.current?.currentBody() !== current.bodySent;
    if (isStale()) return setPhase({ ...current, stale: true, error: STALE });
    const applying = { ...current, applying: true, error: null };
    setPhase(applying);
    const stillHere = () => phaseRef.current === applying && noteRef.current === session;
    try {
      await saveSnapshot(session.path, session.fileContent(), `Before Ask Claude: ${current.request.reason}`);
    } catch (e) {
      if (stillHere()) setPhase({ ...current, error: firstLine(message(e)) });
      return;
    }
    if (!stillHere()) return;
    if (session.state !== "ready") return setPhase(current);
    if (isStale()) return setPhase({ ...current, stale: true, error: STALE });
    try {
      editorRef.current?.replaceBody(current.after);
    } catch (e) {
      return setPhase({ ...current, error: firstLine(message(e)) });
    }
    setInstruction("");
    setPhase(IDLE);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isComposing(event)) return;
    event.preventDefault();
    if (!running) submit();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || isComposing(event) || phase.kind !== "idle") return;
    event.preventDefault();
    onClose();
  };

  const error = phase.kind === "running" ? null : phase.error;
  const canAccept =
    phase.kind === "result" &&
    phase.changed &&
    !phase.stale &&
    !phase.applying &&
    note?.state === "ready" &&
    editor !== null;

  return (
    <aside className="tack-claude" aria-label="Ask Claude" onKeyDown={onPanelKeyDown}>
      <div className="tack-claude-header">
        <h2>Ask Claude</h2>
        <button type="button" title="Close (Esc)" onClick={onClose}>
          Close
        </button>
      </div>
      <input
        className="tack-claude-input"
        aria-label="Instruction"
        placeholder="Ask Claude to change this note…"
        autoFocus
        disabled={!canAsk}
        value={instruction}
        onChange={(event) => setInstruction(event.currentTarget.value)}
        onKeyDown={onInputKeyDown}
      />
      <div className="tack-claude-quick">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!canAsk || running}
            onClick={() => start({ instruction: action.instruction, reason: action.label })}
          >
            {action.label}
          </button>
        ))}
      </div>
      {!canAsk && <p className="tack-claude-hint">Open a note to ask Claude.</p>}
      {phase.kind === "running" && (
        <div className="tack-claude-progress" role="status">
          <p>Claude is working…</p>
          {phase.progress && <pre>{phase.progress.slice(-PROGRESS_TAIL)}</pre>}
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="tack-error tack-claude-error" role="alert">
          {error}
        </p>
      )}
      {phase.kind === "result" && (
        <>
          {!phase.changed && <p className="tack-claude-hint">Claude made no changes.</p>}
          <DiffView rows={phase.rows} label="Proposed change" />
          <div className="tack-claude-actions">
            <button type="button" className="tack-primary" disabled={!canAccept} onClick={() => void accept()}>
              Accept
            </button>
            <button type="button" disabled={phase.applying} onClick={() => setPhase(IDLE)}>
              Reject
            </button>
            <button type="button" disabled={phase.applying || !canAsk} onClick={() => start(phase.request)}>
              Ask again
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
