import { onVaultChanged, readNote, renameNote, writeNote } from "../lib/vault";
import type { NoteIO } from "./noteSession";

export const vaultNoteIO: NoteIO = {
  read: readNote,
  write: async (path, content, expected) => {
    await writeNote(path, content, expected);
  },
  rename: async (path, newTitle) => (await renameNote(path, newTitle)).path,
  watch: onVaultChanged,
};
