import { beforeEach, describe, expect, test, vi } from "vitest";
import { restoreAlwaysOnTop, toggleAlwaysOnTop } from "./window";

const mocks = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const stored = (alwaysOnTop: boolean) => ({
  vault_root: null,
  capture_hotkey: "Alt+Space",
  grammar_enabled: true,
  always_on_top: alwaysOnTop,
  pinned: [],
  claude_path: null,
});

const calls = () => mocks.invoke.mock.calls.map(([command, args]) => [command, args]);

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("always on top", () => {
  test("toggle applies the new value to the window and persists it", async () => {
    mocks.invoke.mockImplementation(async (command) => (command === "get_settings" ? stored(false) : undefined));
    expect(await toggleAlwaysOnTop()).toBe(true);
    expect(calls()).toEqual([
      ["get_settings", undefined],
      ["set_always_on_top", { on: true }],
      ["set_settings", { settings: stored(true) }],
    ]);
  });

  test("toggle does not persist a value the window refused", async () => {
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "get_settings") return stored(true);
      if (command === "set_always_on_top") throw "no window";
      return undefined;
    });
    await expect(toggleAlwaysOnTop()).rejects.toBe("no window");
    expect(mocks.invoke).not.toHaveBeenCalledWith("set_settings", expect.anything());
  });

  test("restore applies the stored value", async () => {
    mocks.invoke.mockImplementation(async (command) => (command === "get_settings" ? stored(true) : undefined));
    expect(await restoreAlwaysOnTop()).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_always_on_top", { on: true });
  });
});
