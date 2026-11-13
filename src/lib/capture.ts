import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { serializedSettings } from "./settings";
import type { NoteMeta } from "./vault";

export const CAPTURE_SAVED = "capture-saved";
export const CAPTURE_SHOWN = "capture-shown";
export const CAPTURE_DISMISS = "capture-dismiss";
export const CAPTURE_QUIT = "capture-quit";

export const hideCapture = () => invoke<void>("hide_capture");

export const announceCaptureSaved = (meta: NoteMeta) => emit(CAPTURE_SAVED, meta);

export const onCaptureSaved = (cb: (meta: NoteMeta) => void) =>
  listen<NoteMeta>(CAPTURE_SAVED, (event) => cb(event.payload));

export const unavailableCaptureHotkey = () => invoke<string | null>("unavailable_capture_hotkey");

export const setCaptureHotkey = (accel: string) =>
  serializedSettings(() => invoke<void>("set_capture_hotkey", { accel }));

const SYMBOLS: Record<string, string> = {
  alt: "⌥",
  option: "⌥",
  ctrl: "⌃",
  control: "⌃",
  shift: "⇧",
  cmd: "⌘",
  command: "⌘",
  cmdorctrl: "⌘",
  commandorcontrol: "⌘",
  super: "⌘",
  meta: "⌘",
};

export const formatAccelerator = (accel: string) =>
  accel
    .split("+")
    .map((part) => part.trim())
    .map((part) => SYMBOLS[part.toLowerCase()] ?? part.replace(/^(Key|Digit)(?=.)/, ""))
    .join("");
