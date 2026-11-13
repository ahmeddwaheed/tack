import { beforeEach, describe, expect, test, vi } from "vitest";
import { toggleSetting, updateSettings } from "./settings";

const mocks = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const stored = {
  vault_root: null,
  capture_hotkey: "Alt+Space",
  grammar_enabled: true,
  always_on_top: false,
  pinned: ["Inbox/a.md"],
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command) => (command === "get_settings" ? stored : undefined));
});

describe("toggleSetting", () => {
  test("flips one flag and keeps the rest", async () => {
    expect(await toggleSetting("grammarEnabled")).toBe(false);
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_settings", {
      settings: { ...stored, grammar_enabled: false },
    });
  });

  test("flips always on top", async () => {
    expect(await toggleSetting("alwaysOnTop")).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_settings", {
      settings: { ...stored, always_on_top: true },
    });
  });
});

describe("updateSettings", () => {
  test("concurrent updates run one after another so none is lost", async () => {
    let disk = { ...stored };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    mocks.invoke.mockImplementation(async (command, args) => {
      await tick();
      if (command === "get_settings") return { ...disk };
      if (command === "set_settings") disk = (args as { settings: typeof stored }).settings;
      return undefined;
    });
    await Promise.all([
      toggleSetting("grammarEnabled"),
      toggleSetting("alwaysOnTop"),
      updateSettings((settings) => ({ ...settings, pinned: [...settings.pinned, "Inbox/b.md"] })),
    ]);
    expect(disk).toEqual({ ...stored, grammar_enabled: false, always_on_top: true, pinned: ["Inbox/a.md", "Inbox/b.md"] });
  });

  test("a failed update does not block the next one", async () => {
    mocks.invoke.mockImplementationOnce(async () => {
      throw "disk full";
    });
    await expect(toggleSetting("grammarEnabled")).rejects.toBe("disk full");
    expect(await toggleSetting("grammarEnabled")).toBe(false);
  });
});
