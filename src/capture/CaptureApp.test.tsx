import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CaptureApp } from "./CaptureApp";

type Handler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  emit: vi.fn<(event: string, payload?: unknown) => Promise<void>>(),
  destroy: vi.fn<() => Promise<void>>(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  focusListener: null as ((event: { payload: boolean }) => void) | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: Handler) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
  emit: mocks.emit,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      mocks.focusListener = handler;
      return () => (mocks.focusListener = null);
    },
    destroy: mocks.destroy,
  }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const savedMeta = {
  path: "Inbox/2026-11-13 1405 call mom.md",
  title: "2026-11-13 1405 call mom",
  folder: "Inbox",
  modified_ms: 1,
  placeholder: false,
};

let container: HTMLDivElement;
let root: Root;
let failCreate: boolean;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 13, 14, 5));
  failCreate = false;
  mocks.listeners.clear();
  mocks.focusListener = null;
  mocks.emit.mockReset();
  mocks.emit.mockResolvedValue(undefined);
  mocks.destroy.mockReset();
  mocks.destroy.mockResolvedValue(undefined);
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "create_note") {
      if (failCreate) throw "disk full";
      return savedMeta;
    }
    return undefined;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const settle = () => act(() => Promise.resolve().then(() => new Promise<void>((r) => queueMicrotask(r))));

const render = async () => {
  await act(async () => root.render(<CaptureApp />));
  const area = container.querySelector("textarea");
  if (!area) throw new Error("no textarea");
  return area;
};

const type = (area: HTMLTextAreaElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });

const press = async (area: HTMLTextAreaElement, init: KeyboardEventInit) => {
  await act(async () => {
    area.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  await settle();
};

const commands = () => mocks.invoke.mock.calls.map(([command]) => command);
const created = () => mocks.invoke.mock.calls.filter(([command]) => command === "create_note");
const errorLine = () => container.querySelector('[role="alert"]')?.textContent ?? null;

describe("CaptureApp", () => {
  test("Esc saves the text to Inbox, announces it and hides the panel", async () => {
    const area = await render();
    type(area, "call mom");
    await press(area, { key: "Escape" });

    expect(created()).toEqual([
      [
        "create_note",
        {
          folder: "Inbox",
          title: "2026-11-13 1405 call mom",
          content: "---\ntype: note\ncreated: 2026-11-13T14:05\n---\n\ncall mom\n",
        },
      ],
    ]);
    expect(commands()).toEqual(["create_note", "hide_capture"]);
    expect(mocks.emit).toHaveBeenCalledWith("capture-saved", expect.objectContaining({ path: savedMeta.path }));
    expect(area.value).toBe("");
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  test("⌘Enter saves and hides like Esc", async () => {
    const area = await render();
    type(area, "call mom");
    await press(area, { key: "Enter", metaKey: true });
    expect(commands()).toEqual(["create_note", "hide_capture"]);
  });

  test("Enter without ⌘ only types", async () => {
    const area = await render();
    type(area, "call mom");
    await press(area, { key: "Enter" });
    expect(commands()).toEqual([]);
  });

  test("Esc with empty or whitespace-only text hides without creating a file", async () => {
    const area = await render();
    await press(area, { key: "Escape" });
    type(area, "  \n ");
    await press(area, { key: "Escape" });
    expect(commands()).toEqual(["hide_capture", "hide_capture"]);
    expect(area.value).toBe("");
  });

  test("Esc during IME composition does not save", async () => {
    const area = await render();
    type(area, "にほ");
    await press(area, { key: "Escape", isComposing: true });
    expect(commands()).toEqual([]);
  });

  test("losing focus saves the text and hides the panel", async () => {
    const area = await render();
    type(area, "call mom");
    await act(async () => mocks.focusListener?.({ payload: false }));
    await settle();
    expect(commands()).toEqual(["create_note", "hide_capture"]);
  });

  test("gaining focus does not save", async () => {
    const area = await render();
    type(area, "call mom");
    await act(async () => mocks.focusListener?.({ payload: true }));
    await settle();
    expect(commands()).toEqual([]);
  });

  test("a failed save keeps the panel open with the text and an error line", async () => {
    const area = await render();
    type(area, "call mom");
    failCreate = true;
    await press(area, { key: "Escape" });

    expect(commands()).toEqual(["create_note"]);
    expect(area.value).toBe("call mom");
    expect(errorLine()).toBe("Couldn't save. Try again.");
    expect(mocks.emit).not.toHaveBeenCalled();

    failCreate = false;
    await press(area, { key: "Escape" });
    expect(commands()).toEqual(["create_note", "create_note", "hide_capture"]);
    expect(errorLine()).toBeNull();
  });

  test("the hotkey pressed while the panel is open saves and hides", async () => {
    const area = await render();
    type(area, "call mom");
    await act(async () => mocks.listeners.get("capture-dismiss")?.({ payload: null }));
    await settle();
    expect(commands()).toEqual(["create_note", "hide_capture"]);
  });

  test("showing the panel focuses the text area, clears an old error and never wipes typed text", async () => {
    const area = await render();
    type(area, "call mom");
    failCreate = true;
    await press(area, { key: "Escape" });
    area.blur();

    await act(async () => mocks.listeners.get("capture-shown")?.({ payload: null }));
    expect(document.activeElement).toBe(area);
    expect(errorLine()).toBeNull();
    expect(area.value).toBe("call mom");
  });

  test("quitting saves unsaved text, then closes the panel", async () => {
    const area = await render();
    type(area, "call mom");
    await act(async () => mocks.listeners.get("capture-quit")?.({ payload: null }));
    await settle();
    expect(commands()).toEqual(["create_note"]);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  test("quitting with an empty panel closes it without creating a file", async () => {
    await render();
    await act(async () => mocks.listeners.get("capture-quit")?.({ payload: null }));
    await settle();
    expect(commands()).toEqual([]);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  test("a quit that arrives while the panel is hiding still closes it", async () => {
    let finishHide: () => void = () => undefined;
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "hide_capture") await new Promise<void>((resolve) => (finishHide = resolve));
      return undefined;
    });
    const area = await render();
    await press(area, { key: "Escape" });
    expect(commands()).toEqual(["hide_capture"]);

    await act(async () => mocks.listeners.get("capture-quit")?.({ payload: null }));
    await act(async () => finishHide());
    await settle();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  test("quitting keeps the panel open when the save fails, and closes after a later save", async () => {
    const area = await render();
    type(area, "call mom");
    failCreate = true;
    await act(async () => mocks.listeners.get("capture-quit")?.({ payload: null }));
    await settle();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(area.value).toBe("call mom");
    expect(errorLine()).toBe("Couldn't save. Try again.");

    failCreate = false;
    await press(area, { key: "Escape" });
    expect(commands()).toEqual(["create_note", "create_note"]);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
