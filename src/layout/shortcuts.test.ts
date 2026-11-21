import { describe, expect, test } from "vitest";
import { shortcutFor, type KeyInput } from "./shortcuts";

const key = (input: Partial<KeyInput> & { key: string }): KeyInput => ({
  metaKey: true,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  inText: false,
  ...input,
});

describe("shortcutFor", () => {
  test("maps the main window shortcuts", () => {
    expect(shortcutFor(key({ key: "n" }))).toBe("new-note");
    expect(shortcutFor(key({ key: "P", shiftKey: true }))).toBe("toggle-pinned");
    expect(shortcutFor(key({ key: "T", shiftKey: true }))).toBe("toggle-on-top");
    expect(shortcutFor(key({ key: "Backspace" }))).toBe("trash");
    expect(shortcutFor(key({ key: "j" }))).toBe("toggle-claude");
    expect(shortcutFor(key({ key: "H", shiftKey: true }))).toBe("toggle-history");
  });

  test("new note and the toggles also work while typing", () => {
    expect(shortcutFor(key({ key: "n", inText: true }))).toBe("new-note");
    expect(shortcutFor(key({ key: "p", shiftKey: true, inText: true }))).toBe("toggle-pinned");
    expect(shortcutFor(key({ key: "t", shiftKey: true, inText: true }))).toBe("toggle-on-top");
    expect(shortcutFor(key({ key: "J", inText: true }))).toBe("toggle-claude");
    expect(shortcutFor(key({ key: "h", shiftKey: true, inText: true }))).toBe("toggle-history");
  });

  test("Cmd+Backspace inside text keeps deleting to the line start", () => {
    expect(shortcutFor(key({ key: "Backspace", inText: true }))).toBeNull();
  });

  test("ignores other keys and modifiers", () => {
    expect(shortcutFor(key({ key: "n", metaKey: false }))).toBeNull();
    expect(shortcutFor(key({ key: "p" }))).toBeNull();
    expect(shortcutFor(key({ key: "t" }))).toBeNull();
    expect(shortcutFor(key({ key: "j", shiftKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: "j", metaKey: false }))).toBeNull();
    expect(shortcutFor(key({ key: "n", shiftKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: "n", altKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: "n", ctrlKey: true }))).toBeNull();
  });
});
