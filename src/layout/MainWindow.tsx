import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClaudePanel } from "../claude/ClaudePanel";
import { Editor, type EditorApi } from "../editor/Editor";
import { formatAccelerator, onCaptureSaved, setCaptureHotkey, unavailableCaptureHotkey } from "../lib/capture";
import { createInboxNote } from "../lib/newNote";
import { getSettings, toggleSetting, updateSettings } from "../lib/settings";
import { listNotes, moveNote, onVaultChanged, trashNote, type NoteMeta } from "../lib/vault";
import { onQuitRequested, restoreAlwaysOnTop, toggleAlwaysOnTop } from "../lib/window";
import { CommandPalette, type PaletteAction } from "../palette/CommandPalette";
import type { SearchIndex } from "../search/index";
import { startVaultIndex } from "../search/vaultIndex";
import { ConfirmDialog } from "./ConfirmDialog";
import { confirmSlot, type Pending } from "./confirmSlot";
import { HotkeyDialog } from "./HotkeyDialog";
import {
  releaseNote,
  switchNote,
  trashWithGuard,
  windowAction,
  type ConfirmDiscard,
  type GuardOutcome,
  type OpenNote,
  type WindowLeave,
} from "./noteGuard";
import { NoteList } from "./NoteList";
import { isTextTarget, shortcutFor } from "./shortcuts";
import { Sidebar } from "./Sidebar";
import {
  FOLDER_SECTIONS,
  renamePinned,
  sidebarSections,
  togglePinned,
  vaultFolderOf,
  type SidebarSectionId,
  type VaultFolder,
} from "./sidebarModel";

const FLASH_MS = 2000;
const SEARCH_UNAVAILABLE = "Search is unavailable";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  focus: "confirm" | "cancel";
}

const unsavedMessage = (title: string) => `Couldn't save "${title}". Close anyway?`;

const updatePinned = async (change: (pinned: string[]) => string[]) =>
  (await updateSettings((settings) => ({ ...settings, pinned: change(settings.pinned) }))).pinned;

export function MainWindow() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [onTop, setOnTop] = useState(false);
  const [grammarEnabled, setGrammarEnabled] = useState(true);
  const [path, setPath] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [sectionId, setSectionId] = useState<SidebarSectionId>("recent");
  const [navOpen, setNavOpen] = useState(false);
  const [confirm, setConfirm] = useState<Pending<ConfirmRequest> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [flash, setFlash] = useState("");
  const [hotkey, setHotkey] = useState("Alt+Space");
  const [hotkeyUnavailable, setHotkeyUnavailable] = useState<string | null>(null);
  const [hotkeyDialogOpen, setHotkeyDialogOpen] = useState(false);
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [openSession, setOpenSession] = useState<OpenNote["session"] | null>(null);
  const [editorApi, setEditorApi] = useState<EditorApi | null>(null);
  const openRef = useRef<OpenNote | null>(null);
  const pathRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const fail = useCallback((e: unknown) => setError(message(e)), []);

  const ask = useMemo(() => confirmSlot<ConfirmRequest>(setConfirm), []);

  const confirmClose = useCallback<ConfirmDiscard>(
    (title) =>
      ask({ message: unsavedMessage(title), confirmLabel: "Close anyway", cancelLabel: "Keep open", focus: "cancel" }),
    [ask],
  );

  const confirmLeave = useCallback<ConfirmDiscard>(
    (title) =>
      ask({
        message: unsavedMessage(title),
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        focus: "cancel",
      }),
    [ask],
  );

  const refreshNotes = useCallback(async () => {
    try {
      const found = await listNotes();
      setNotes(found);
      return found;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [fail]);

  useEffect(() => {
    void refreshNotes().then((found) => {
      const newest = sidebarSections(found ?? [], []).find((s) => s.id === "recent")?.notes[0];
      setPath((current) => current ?? newest?.path ?? null);
    });
    getSettings().then((settings) => {
      setPinned(settings.pinned);
      setGrammarEnabled(settings.grammarEnabled);
      setHotkey(settings.captureHotkey);
    }, fail);
    unavailableCaptureHotkey().then(setHotkeyUnavailable, fail);
    restoreAlwaysOnTop().then(setOnTop, fail);
  }, [refreshNotes, fail]);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    onVaultChanged(() => void refreshNotes()).then(
      (stop) => (stopped ? stop() : (unlisten = stop)),
      (e: unknown) => setError(`Not watching the vault: ${message(e)}`),
    );
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [refreshNotes]);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCaptureSaved(() => {
      void refreshNotes();
      setFlash("Saved to Inbox");
      clearTimeout(timer);
      timer = setTimeout(() => setFlash(""), FLASH_MS);
    }).then((stop) => (stopped ? stop() : (unlisten = stop)), fail);
    return () => {
      stopped = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [refreshNotes, fail]);

  useEffect(
    () =>
      startVaultIndex(
        (built) => {
          setIndex(built);
          setError((current) => (current?.startsWith(SEARCH_UNAVAILABLE) ? null : current));
        },
        (e) => setError(`${SEARCH_UNAVAILABLE}: ${message(e)}`),
      ),
    [],
  );

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let leaving = false;
    const reveal = async () => {
      await appWindow.show();
      await appWindow.setFocus();
    };
    const confirmVisibly: ConfirmDiscard = async (title) => {
      await reveal();
      return confirmClose(title);
    };
    const leave = async (kind: WindowLeave) => {
      if (leaving) return;
      leaving = true;
      try {
        const action = windowAction(kind, await releaseNote(openRef.current, confirmVisibly));
        if (action === "destroy") {
          await appWindow.destroy();
        } else if (action === "hide") {
          await appWindow.hide();
          setEditorKey((key) => key + 1);
        } else {
          await reveal();
        }
      } catch (e) {
        fail(e);
      } finally {
        leaving = false;
      }
    };
    let stopped = false;
    let stopQuit: (() => void) | undefined;
    onQuitRequested(() => void leave("quit")).then((stop) => (stopped ? stop() : (stopQuit = stop)), fail);
    const stopClose = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await leave("close");
    });
    return () => {
      stopped = true;
      stopQuit?.();
      void stopClose.then((stop) => stop());
    };
  }, [confirmClose, fail]);

  const sections = useMemo(() => sidebarSections(notes, pinned), [notes, pinned]);
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];
  const current = notes.find((note) => note.path === path) ?? null;

  const openNote = useCallback(
    async (target: string) => {
      try {
        const outcome = await switchNote(openRef.current, target, setPath, confirmLeave);
        if (outcome === "done") setNavOpen(false);
      } catch (e) {
        fail(e);
      }
    },
    [confirmLeave, fail],
  );

  const blockedByConflict = () => {
    if (openRef.current?.session.state !== "conflict") return false;
    openRef.current.revealConflict();
    return true;
  };

  const createAndOpen = async (title: string) => {
    if (blockedByConflict()) return;
    try {
      const meta = await createInboxNote(title);
      index?.upsert({ ...meta, body: "", tags: [], people: [] });
      await refreshNotes();
      await openNote(meta.path);
    } catch (e) {
      fail(e);
    }
  };

  const onRenamed = (renamed: string) => {
    const previous = pathRef.current;
    setPath(renamed);
    void refreshNotes();
    if (previous && previous !== renamed) {
      updatePinned((list) => renamePinned(list, previous, renamed)).then(setPinned, fail);
    }
  };

  const exclusively = async (action: () => Promise<GuardOutcome>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await action();
    } catch (e) {
      fail(e);
      setEditorKey((key) => key + 1);
    } finally {
      busyRef.current = false;
    }
  };

  const move = (folder: VaultFolder) =>
    exclusively(async () => {
      const from = pathRef.current;
      if (!from) return "done";
      const outcome = await releaseNote(openRef.current, confirmLeave);
      if (outcome !== "done") return outcome;
      const meta = await moveNote(from, folder);
      setPath(meta.path);
      await refreshNotes();
      setPinned(await updatePinned((list) => renamePinned(list, from, meta.path)));
      return "done";
    });

  const trash = (target: string) =>
    exclusively(async () => {
      const wasOpen = pathRef.current === target;
      const outcome = await trashWithGuard(openRef.current, target, trashNote, confirmLeave);
      if (outcome !== "done") return outcome;
      index?.remove(target);
      const remaining = (await refreshNotes()) ?? [];
      if (wasOpen) {
        const next =
          sidebarSections(remaining, pinned).find((s) => s.id === sectionId)?.notes[0] ?? remaining[0];
        setPath(next?.path ?? null);
      }
      setPinned(await updatePinned((list) => list.filter((p) => p !== target)));
      return "done";
    });

  const askTrash = async () => {
    if (!current) return;
    const target = current.path;
    const ok = await ask({
      message: `Move "${current.title}" to Trash?`,
      confirmLabel: "Move to Trash",
      cancelLabel: "Cancel",
      focus: "confirm",
    });
    if (ok) await trash(target);
  };

  const togglePinnedNote = () => {
    const target = pathRef.current;
    if (target) updatePinned((list) => togglePinned(list, target)).then(setPinned, fail);
  };

  const toggleOnTop = () => {
    toggleAlwaysOnTop().then(setOnTop, fail);
  };

  const toggleClaude = () => setClaudeOpen((open) => !open);

  const shortcutsRef = useRef({ createAndOpen, togglePinnedNote, toggleOnTop, askTrash, toggleClaude });
  useEffect(() => {
    shortcutsRef.current = { createAndOpen, togglePinnedNote, toggleOnTop, askTrash, toggleClaude };
  });
  const dialogOpen = confirm !== null || hotkeyDialogOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogOpen) return;
      const shortcut = shortcutFor({
        key: event.key,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        inText: isTextTarget(event.target),
      });
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      const handlers = shortcutsRef.current;
      if (shortcut === "new-note") void handlers.createAndOpen("Untitled");
      else if (shortcut === "toggle-pinned") handlers.togglePinnedNote();
      else if (shortcut === "toggle-on-top") handlers.toggleOnTop();
      else if (shortcut === "toggle-claude") handlers.toggleClaude();
      else void handlers.askTrash();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dialogOpen]);

  const actions: PaletteAction[] = [
    { id: "new-note", label: "New note", run: () => createAndOpen("Untitled") },
    { id: "toggle-pin", label: "Toggle pin on top", run: toggleOnTop },
    { id: "toggle-pinned", label: "Pin or unpin note", run: togglePinnedNote },
    { id: "trash", label: "Move note to Trash", run: askTrash },
    { id: "ask-claude", label: "Ask Claude", run: () => setClaudeOpen(true) },
    {
      id: "toggle-grammar",
      label: "Toggle grammar",
      run: () => {
        toggleSetting("grammarEnabled").then(setGrammarEnabled, fail);
      },
    },
    { id: "change-hotkey", label: "Change capture hotkey…", run: () => setHotkeyDialogOpen(true) },
  ];

  const saveHotkey = async (accel: string) => {
    await setCaptureHotkey(accel);
    setHotkey(accel);
    setHotkeyUnavailable(null);
  };

  const onOpen = useCallback((note: OpenNote | null) => {
    openRef.current = note;
    setOpenSession(note?.session ?? null);
  }, []);

  const searchTitles = useCallback(
    (query: string) => index?.searchTitles(query).map((hit) => hit.title) ?? [],
    [index],
  );

  const isPinned = path !== null && pinned.includes(path);

  return (
    <div
      className="tack-window"
      data-nav-open={navOpen ? "true" : undefined}
      data-claude-open={claudeOpen ? "true" : undefined}
    >
      <div className="tack-nav">
        <Sidebar sections={sections} selected={section.id} onSelect={setSectionId} />
        <NoteList
          label={section.label}
          notes={section.notes}
          activePath={path}
          onOpen={(target) => void openNote(target)}
        />
      </div>
      <button
        type="button"
        className="tack-nav-scrim"
        aria-label="Close note list"
        tabIndex={-1}
        onClick={() => setNavOpen(false)}
      />
      <main className="tack-main">
        <div className="tack-toolbar">
          <button
            type="button"
            className="tack-nav-toggle"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            Notes
          </button>
          <span className="tack-toolbar-spacer" />
          {current && (
            <>
              <select
                aria-label="Folder"
                value={vaultFolderOf(current) ?? ""}
                onChange={(event) => void move(event.currentTarget.value as VaultFolder)}
              >
                {vaultFolderOf(current) === null && (
                  <option value="" disabled>
                    Other
                  </option>
                )}
                {FOLDER_SECTIONS.map(({ label }) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" aria-pressed={isPinned} title="Pin note (⌘⇧P)" onClick={togglePinnedNote}>
                {isPinned ? "Pinned" : "Pin"}
              </button>
              <button type="button" title="Move to Trash (⌘⌫)" onClick={askTrash}>
                Trash
              </button>
            </>
          )}
          <button type="button" aria-pressed={onTop} title="Keep window on top (⌘⇧T)" onClick={toggleOnTop}>
            On top
          </button>
          <button type="button" aria-pressed={claudeOpen} title="Ask Claude (⌘J)" onClick={toggleClaude}>
            Ask Claude
          </button>
        </div>
        {error && (
          <p className="tack-error tack-banner" role="alert">
            {error}
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </p>
        )}
        {hotkeyUnavailable && (
          <p className="tack-error tack-banner" role="alert">
            Quick capture hotkey {formatAccelerator(hotkeyUnavailable)} is not available. Change it in ⌘K → Change
            capture hotkey.
            <button type="button" onClick={() => setHotkeyUnavailable(null)}>
              Dismiss
            </button>
          </p>
        )}
        {path ? (
          <Editor
            key={editorKey}
            path={path}
            onPathChange={onRenamed}
            searchTitles={searchTitles}
            grammarEnabled={grammarEnabled}
            onOpen={onOpen}
            onEditorReady={setEditorApi}
          />
        ) : (
          <p className="tack-empty">No note open. Press ⌘N to start one.</p>
        )}
      </main>
      {claudeOpen && <ClaudePanel note={openSession} editor={editorApi} onClose={() => setClaudeOpen(false)} />}
      <p className="tack-flash" role="status">
        {flash}
      </p>
      <CommandPalette
        index={index}
        actions={actions}
        onOpenNote={(target) => void openNote(target)}
        onCreateNote={(title) => void createAndOpen(title)}
      />
      {hotkeyDialogOpen && (
        <HotkeyDialog current={hotkey} onSave={saveHotkey} onClose={() => setHotkeyDialogOpen(false)} />
      )}
      {confirm && (
        <ConfirmDialog
          key={confirm.message + confirm.confirmLabel}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          cancelLabel={confirm.cancelLabel}
          focus={confirm.focus}
          onConfirm={() => confirm.resolve(true)}
          onCancel={() => confirm.resolve(false)}
        />
      )}
    </div>
  );
}
