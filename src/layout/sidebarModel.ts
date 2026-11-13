import type { NoteMeta } from "../lib/vault";

export type SidebarSectionId =
  | "inbox"
  | "meetings"
  | "people"
  | "projects"
  | "knowledge"
  | "weekly"
  | "recent"
  | "pinned"
  | "other";

export interface SidebarSection {
  id: SidebarSectionId;
  label: string;
  notes: NoteMeta[];
}

export const RECENT_LIMIT = 10;

export const FOLDER_SECTIONS = [
  { id: "inbox", label: "Inbox" },
  { id: "meetings", label: "Meetings" },
  { id: "people", label: "People" },
  { id: "projects", label: "Projects" },
  { id: "knowledge", label: "Knowledge" },
  { id: "weekly", label: "Weekly" },
] as const satisfies readonly { id: SidebarSectionId; label: string }[];

export type VaultFolder = (typeof FOLDER_SECTIONS)[number]["label"];

export const topFolder = (note: NoteMeta) => note.folder.split("/")[0];

export const vaultFolderOf = (note: NoteMeta): VaultFolder | null =>
  FOLDER_SECTIONS.find(({ label }) => label === topFolder(note))?.label ?? null;

const newestFirst = (notes: NoteMeta[]) => [...notes].sort((a, b) => b.modifiedMs - a.modifiedMs);

export function sidebarSections(notes: NoteMeta[], pinned: string[]): SidebarSection[] {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const sorted = newestFirst(notes);
  const other = sorted.filter((note) => vaultFolderOf(note) === null);
  return [
    {
      id: "pinned",
      label: "Pinned",
      notes: pinned.flatMap((path) => byPath.get(path) ?? []),
    },
    { id: "recent", label: "Recent", notes: sorted.slice(0, RECENT_LIMIT) },
    ...FOLDER_SECTIONS.map(({ id, label }) => ({
      id,
      label,
      notes: sorted.filter((note) => topFolder(note) === label),
    })),
    ...(other.length > 0 ? [{ id: "other" as const, label: "Other", notes: other }] : []),
  ];
}

export const togglePinned = (pinned: string[], path: string) =>
  pinned.includes(path) ? pinned.filter((p) => p !== path) : [...pinned, path];

export const renamePinned = (pinned: string[], from: string, to: string) =>
  pinned.map((p) => (p === from ? to : p));
