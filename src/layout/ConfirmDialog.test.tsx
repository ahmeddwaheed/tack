import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

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

const render = () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  act(() =>
    root.render(
      <ConfirmDialog
        message={'Move "Groceries" to Trash?'}
        confirmLabel="Move to Trash"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    ),
  );
  const buttons = [...container.querySelectorAll("button")];
  return { onConfirm, onCancel, buttons };
};

describe("ConfirmDialog", () => {
  test("shows the trash question with Move to Trash focused", () => {
    const { buttons } = render();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('Move "Groceries" to Trash?');
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Move to Trash"]);
    expect(document.activeElement).toBe(buttons[1]);
  });

  test("buttons confirm and cancel", () => {
    const { onConfirm, onCancel, buttons } = render();
    act(() => buttons[1].click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    act(() => buttons[0].click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Escape cancels", () => {
    const { onConfirm, onCancel, buttons } = render();
    act(() => {
      buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
