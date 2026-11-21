import { invoke } from "@tauri-apps/api/core";

export type Settings = {
  vaultRoot: string | null;
  captureHotkey: string;
  grammarEnabled: boolean;
  alwaysOnTop: boolean;
  pinned: string[];
  claudePath: string | null;
};

type RawSettings = {
  vault_root: string | null;
  capture_hotkey: string;
  grammar_enabled: boolean;
  always_on_top: boolean;
  pinned: string[];
  claude_path: string | null;
};

export const getSettings = async (): Promise<Settings> => {
  const raw = await invoke<RawSettings>("get_settings");
  return {
    vaultRoot: raw.vault_root,
    captureHotkey: raw.capture_hotkey,
    grammarEnabled: raw.grammar_enabled,
    alwaysOnTop: raw.always_on_top,
    pinned: raw.pinned,
    claudePath: raw.claude_path ?? null,
  };
};

export const setSettings = (settings: Settings) =>
  invoke<void>("set_settings", {
    settings: {
      vault_root: settings.vaultRoot,
      capture_hotkey: settings.captureHotkey,
      grammar_enabled: settings.grammarEnabled,
      always_on_top: settings.alwaysOnTop,
      pinned: settings.pinned,
      claude_path: settings.claudePath,
    },
  });

let settingsQueue: Promise<unknown> = Promise.resolve();

export function serializedSettings<T>(op: () => Promise<T>): Promise<T> {
  const result = settingsQueue.then(op, op);
  settingsQueue = result.catch(() => undefined);
  return result;
}

export const updateSettings = (change: (settings: Settings) => Settings | Promise<Settings>) =>
  serializedSettings(async () => {
    const next = await change(await getSettings());
    await setSettings(next);
    return next;
  });

export const toggleSetting = async (key: "alwaysOnTop" | "grammarEnabled"): Promise<boolean> =>
  (await updateSettings((settings) => ({ ...settings, [key]: !settings[key] })))[key];
