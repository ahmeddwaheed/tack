import { createNote, type NoteMeta } from "./vault";

const pad = (value: number) => String(value).padStart(2, "0");

export const createdStamp = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const newNoteContent = (date = new Date()) => `---\ntype: note\ncreated: ${createdStamp(date)}\n---\n\n`;

export const createInboxNote = (title: string, date = new Date()): Promise<NoteMeta> =>
  createNote("Inbox", title, newNoteContent(date));
