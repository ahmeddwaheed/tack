import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HotkeyDialog } from "./HotkeyDialog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const type = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const render = (onSave: (accel: string) => Promise<void>) => {
  const onClose = vi.fn();
  act(() => root.render(<HotkeyDialog current="Alt+Space" onSave={onSave} onClose={onClose} />));
  const input = container.querySelector("input") as HTMLInputElement;
  const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save") as HTMLButtonElement;
  return { input, save, onClose };
};

describe("HotkeyDialog", () => {
  test("starts with the current hotkey focused and saves the new one", async () => {
    const onSave = vi.fn(async () => undefined);
    const { input, save, onClose } = render(onSave);
    expect(input.value).toBe("Alt+Space");
    expect(document.activeElement).toBe(input);
    type(input, " Ctrl+Shift+Space ");
    await act(async () => save.click());
    await settle();
    expect(onSave).toHaveBeenCalledWith("Ctrl+Shift+Space");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("shows the error inline and stays open when the hotkey is refused", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("HotKey already registered")));
    const { input, save, onClose } = render(onSave);
    type(input, "Alt+Space");
    await act(async () => save.click());
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("HotKey already registered");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("an empty hotkey cannot be saved and Escape closes", () => {
    const onSave = vi.fn(async () => undefined);
    const { input, save, onClose } = render(onSave);
    type(input, "   ");
    expect(save.disabled).toBe(true);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
