export type Shortcut = "new-note" | "toggle-pinned" | "toggle-on-top" | "trash";

export interface KeyInput {
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  inText: boolean;
}

export function shortcutFor(input: KeyInput): Shortcut | null {
  if (!input.metaKey || input.ctrlKey || input.altKey) return null;
  const key = input.key.toLowerCase();
  if (input.shiftKey) {
    if (key === "p") return "toggle-pinned";
    if (key === "t") return "toggle-on-top";
    return null;
  }
  if (key === "n") return "new-note";
  if (key === "backspace" && !input.inText) return "trash";
  return null;
}

export const isTextTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
