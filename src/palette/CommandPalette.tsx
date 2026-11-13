import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SearchHit, SearchIndex } from "../search/index";

export interface PaletteAction {
  id: string;
  label: string;
  run(): void | Promise<void>;
}

interface CommandPaletteProps {
  index: SearchIndex | null;
  actions: PaletteAction[];
  onOpenNote(path: string): void;
  onCreateNote(title: string): void;
}

type Item = { kind: "note"; hit: SearchHit } | { kind: "action"; action: PaletteAction };

const RECENT_LIMIT = 10;
const OPEN_KEYS = new Set(["k", "p"]);

const isOpenShortcut = (event: globalThis.KeyboardEvent) =>
  event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && OPEN_KEYS.has(event.key.toLowerCase());

export function CommandPalette({ index, actions, onOpenNote, onCreateNote }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isOpenShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      setSelected(0);
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const notes = useMemo(() => {
    if (!open || !index) return [];
    return query.trim() === "" ? index.recent(RECENT_LIMIT) : index.search(query);
  }, [open, index, query]);

  const items = useMemo<Item[]>(() => {
    const needle = query.trim().toLowerCase();
    const matchingActions = actions.filter((action) => action.label.toLowerCase().includes(needle));
    return [
      ...notes.map((hit): Item => ({ kind: "note", hit })),
      ...matchingActions.map((action): Item => ({ kind: "action", action })),
    ];
  }, [notes, actions, query]);

  if (!open) return null;

  const close = () => setOpen(false);

  const activate = (item: Item | undefined) => {
    if (!item) return;
    close();
    if (item.kind === "note") onOpenNote(item.hit.path);
    else void item.action.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // WebKit reports keyCode 229 without isComposing for the key that ends an IME composition.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (items.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelected((current) => (current + step + items.length) % items.length);
        return;
      }
      case "Enter": {
        event.preventDefault();
        if (!event.metaKey) return activate(items[selected]);
        const title = query.trim();
        if (notes.length > 0 || title === "") return;
        close();
        onCreateNote(title);
        return;
      }
      case "Escape":
        event.preventDefault();
        close();
        return;
    }
  };

  return (
    <div className="tack-palette-backdrop" onMouseDown={close}>
      <div
        className="tack-palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="tack-palette-input"
          aria-label="Search notes"
          placeholder="Search notes, #tag, @person, in:folder"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="tack-palette-list" role="listbox" aria-label="Results">
          {items.map((item, i) => (
            <div
              key={item.kind === "note" ? `note:${item.hit.path}` : `action:${item.action.id}`}
              role="option"
              aria-selected={i === selected}
              className={`tack-palette-item tack-palette-${item.kind}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => activate(item)}
            >
              {item.kind === "note" ? (
                <>
                  <span className="tack-palette-title">{item.hit.title}</span>
                  <span className="tack-palette-folder">{item.hit.folder}</span>
                  {item.hit.line && <span className="tack-palette-line">{item.hit.line}</span>}
                </>
              ) : (
                item.action.label
              )}
            </div>
          ))}
          {items.length === 0 && query.trim() !== "" && (
            <p className="tack-palette-empty">No matches. ⌘Enter creates “{query.trim()}” in Inbox.</p>
          )}
        </div>
      </div>
    </div>
  );
}
