import { invoke } from "@tauri-apps/api/core";

export type HistoryEntry = {
  id: string;
  createdMs: number;
  reason: string;
  bytes: number;
};

type RawHistoryEntry = {
  id: string;
  created_ms: number;
  reason: string;
  bytes: number;
};

const toEntry = (raw: RawHistoryEntry): HistoryEntry => ({
  id: raw.id,
  createdMs: raw.created_ms,
  reason: raw.reason,
  bytes: raw.bytes,
});

export const saveSnapshot = async (
  path: string,
  content: string,
  reason: string,
): Promise<HistoryEntry> =>
  toEntry(await invoke<RawHistoryEntry>("history_save", { path, content, reason }));

export const listSnapshots = async (path: string): Promise<HistoryEntry[]> =>
  (await invoke<RawHistoryEntry[]>("history_list", { path })).map(toEntry);

export const readSnapshot = (path: string, id: string) =>
  invoke<string>("history_read", { path, id });
