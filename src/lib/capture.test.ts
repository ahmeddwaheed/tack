import { beforeEach, describe, expect, test, vi } from "vitest";
import { formatAccelerator, setCaptureHotkey, unavailableCaptureHotkey } from "./capture";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn() }));

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("formatAccelerator", () => {
  test("shows modifiers as Mac symbols", () => {
    expect(formatAccelerator("Alt+Space")).toBe("⌥Space");
    expect(formatAccelerator("Ctrl+Shift+Space")).toBe("⌃⇧Space");
    expect(formatAccelerator("CmdOrCtrl+Option+KeyN")).toBe("⌘⌥N");
    expect(formatAccelerator("Super+Digit1")).toBe("⌘1");
  });
});

describe("capture hotkey commands", () => {
  test("asks Rust which saved hotkey could not be registered", async () => {
    mocks.invoke.mockResolvedValue("Alt+Space");
    expect(await unavailableCaptureHotkey()).toBe("Alt+Space");
    expect(mocks.invoke).toHaveBeenCalledWith("unavailable_capture_hotkey");
  });

  test("sets a new hotkey by its accelerator string", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    await setCaptureHotkey("Ctrl+Shift+Space");
    expect(mocks.invoke).toHaveBeenCalledWith("set_capture_hotkey", { accel: "Ctrl+Shift+Space" });
  });
});
