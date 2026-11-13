import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type VaultStatus = { root: string; exists: boolean; containerExists: boolean };

type RawVaultStatus = { root: string; exists: boolean; container_exists: boolean };

export type NoteMeta = {
  path: string;
  title: string;
  folder: string;
  modifiedMs: number;
  placeholder: boolean;
};

type RawNoteMeta = {
  path: string;
  title: string;
  folder: string;
  modified_ms: number;
  placeholder: boolean;
};

const toNoteMeta = (raw: RawNoteMeta): NoteMeta => ({
  path: raw.path,
  title: raw.title,
  folder: raw.folder,
  modifiedMs: raw.modified_ms,
  placeholder: raw.placeholder,
});

export const vaultStatus = async (): Promise<VaultStatus> => {
  const raw = await invoke<RawVaultStatus>("vault_status");
  return { root: raw.root, exists: raw.exists, containerExists: raw.container_exists };
};

export const vaultInit = () => invoke<void>("vault_init");

export const listNotes = async (): Promise<NoteMeta[]> =>
  (await invoke<RawNoteMeta[]>("list_notes")).map(toNoteMeta);

export const readNote = (path: string) => invoke<string>("read_note", { path });

export class WriteConflictError extends Error {
  constructor(path: string) {
    super(`${path} changed on disk`);
    this.name = "WriteConflictError";
  }
}

const CONFLICT_PREFIX = "CONFLICT:";

export const writeNote = async (
  path: string,
  content: string,
  expected?: string,
): Promise<NoteMeta> => {
  try {
    return toNoteMeta(
      await invoke<RawNoteMeta>("write_note", { path, content, expected: expected ?? null }),
    );
  } catch (e) {
    if (typeof e === "string" && e.startsWith(CONFLICT_PREFIX)) throw new WriteConflictError(path);
    throw e;
  }
};

export const createNote = async (
  folder: string,
  title: string,
  content: string,
): Promise<NoteMeta> =>
  toNoteMeta(await invoke<RawNoteMeta>("create_note", { folder, title, content }));

export const renameNote = async (path: string, newTitle: string): Promise<NoteMeta> =>
  toNoteMeta(await invoke<RawNoteMeta>("rename_note", { path, newTitle }));

export const moveNote = async (path: string, folder: string): Promise<NoteMeta> =>
  toNoteMeta(await invoke<RawNoteMeta>("move_note", { path, folder }));

export const trashNote = (path: string) => invoke<void>("trash_note", { path });

export const onVaultChanged = async (cb: (paths: string[]) => void): Promise<() => void> => {
  const unlisten = await listen<{ paths: string[] }>("vault-changed", (event) => cb(event.payload.paths));
  try {
    await invoke<void>("watch_vault");
  } catch (e) {
    unlisten();
    throw e;
  }
  return unlisten;
};
