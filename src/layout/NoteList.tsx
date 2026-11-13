import type { NoteMeta } from "../lib/vault";

interface NoteListProps {
  label: string;
  notes: NoteMeta[];
  activePath: string | null;
  onOpen(path: string): void;
}

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export function NoteList({ label, notes, activePath, onOpen }: NoteListProps) {
  return (
    <section className="tack-note-list" aria-label={`${label} notes`}>
      <h2 className="tack-list-heading">{label}</h2>
      {notes.length === 0 && <p className="tack-list-empty">No notes</p>}
      <ul>
        {notes.map((note) => (
          <li key={note.path}>
            <button
              type="button"
              className="tack-list-item"
              aria-current={note.path === activePath ? "true" : undefined}
              onClick={() => onOpen(note.path)}
            >
              <span className="tack-list-title">{note.title}</span>
              <span className="tack-list-meta">
                {note.folder && `${note.folder} · `}
                {dateFormat.format(note.modifiedMs)}
                {note.placeholder && " · in iCloud"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
