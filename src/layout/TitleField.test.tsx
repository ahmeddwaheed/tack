import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TitleField } from "./TitleField";

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

function render(onRename: (title: string) => void, title = "Old") {
  act(() => root.render(<TitleField title={title} onRename={onRename} />));
  const input = container.querySelector("input");
  if (!input) throw new Error("no input");
  return input;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const key = (input: HTMLInputElement, name: string) =>
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });

describe("TitleField", () => {
  test("enter renames once with the trimmed title", () => {
    const onRename = vi.fn();
    const input = render(onRename);
    act(() => input.focus());
    type(input, "  New title ");
    key(input, "Enter");
    act(() => input.blur());
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("New title");
  });

  test("blur renames", () => {
    const onRename = vi.fn();
    const input = render(onRename);
    act(() => input.focus());
    type(input, "Blurred");
    act(() => input.blur());
    expect(onRename).toHaveBeenCalledWith("Blurred");
  });

  test("unchanged or empty title does not rename and reverts", () => {
    const onRename = vi.fn();
    const input = render(onRename);
    act(() => input.focus());
    type(input, "   ");
    act(() => input.blur());
    act(() => input.focus());
    type(input, "Old");
    act(() => input.blur());
    expect(onRename).not.toHaveBeenCalled();
    expect(input.value).toBe("Old");
  });

  test("escape reverts without renaming", () => {
    const onRename = vi.fn();
    const input = render(onRename);
    act(() => input.focus());
    type(input, "Discard me");
    key(input, "Escape");
    expect(onRename).not.toHaveBeenCalled();
    expect(input.value).toBe("Old");
  });
});
