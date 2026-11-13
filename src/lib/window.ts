import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSettings, updateSettings } from "./settings";

export const setAlwaysOnTop = (on: boolean) => invoke<void>("set_always_on_top", { on });

export async function toggleAlwaysOnTop(): Promise<boolean> {
  const next = await updateSettings(async (settings) => {
    const on = !settings.alwaysOnTop;
    await setAlwaysOnTop(on);
    return { ...settings, alwaysOnTop: on };
  });
  return next.alwaysOnTop;
}

export async function restoreAlwaysOnTop(): Promise<boolean> {
  const { alwaysOnTop } = await getSettings();
  await setAlwaysOnTop(alwaysOnTop);
  return alwaysOnTop;
}

export const QUIT_REQUESTED_EVENT = "quit-requested";

export const onQuitRequested = (handler: () => void) => listen(QUIT_REQUESTED_EVENT, () => handler());
