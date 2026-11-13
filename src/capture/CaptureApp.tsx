import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { announceCaptureSaved, CAPTURE_DISMISS, CAPTURE_QUIT, CAPTURE_SHOWN, hideCapture } from "../lib/capture";
import { createNote } from "../lib/vault";
import { captureNote } from "./captureNote";
import "../styles/tokens.css";
import "../styles/capture.css";

const SAVE_FAILED = "Couldn't save. Try again.";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isSubmitKey = (event: KeyboardEvent) =>
  event.key === "Escape" || (event.key === "Enter" && event.metaKey);

export function CaptureApp() {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef("");
  const busyRef = useRef(false);
  const quittingRef = useRef(false);

  const changeText = useCallback((value: string) => {
    textRef.current = value;
    setText(value);
  }, []);

  const finish = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    try {
      const note = captureNote(textRef.current, new Date());
      if (note) {
        try {
          const meta = await createNote("Inbox", note.title, note.content);
          announceCaptureSaved(meta).catch(() => undefined);
        } catch {
          setError(SAVE_FAILED);
          return;
        }
      }
      changeText("");
      setError(null);
      if (!quittingRef.current) await hideCapture();
      if (quittingRef.current) await getCurrentWindow().destroy();
    } catch (e) {
      setError(message(e));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }, [changeText]);

  useEffect(() => {
    const stops = [
      listen(CAPTURE_SHOWN, () => {
        setError(null);
        areaRef.current?.focus();
      }),
      listen(CAPTURE_DISMISS, () => void finish()),
      listen(CAPTURE_QUIT, () => {
        quittingRef.current = true;
        void finish();
      }),
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused) void finish();
      }),
    ];
    return () => {
      for (const stop of stops) void stop.then((unlisten) => unlisten());
    };
  }, [finish]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || !isSubmitKey(event)) return;
    event.preventDefault();
    void finish();
  };

  return (
    <main className="tack-capture">
      <textarea
        ref={areaRef}
        className="tack-capture-input"
        aria-label="Quick capture"
        placeholder="Capture a thought…"
        autoFocus
        value={text}
        readOnly={saving}
        onChange={(event) => changeText(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <footer className="tack-capture-footer">
        {error ? (
          <p className="tack-capture-error" role="alert">
            {error}
          </p>
        ) : (
          <span>Esc saves to Inbox</span>
        )}
      </footer>
    </main>
  );
}
