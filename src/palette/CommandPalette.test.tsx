import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSearchIndex, type IndexedNote } from "../search/index";
import { CommandPalette, type PaletteAction } from "./CommandPalette";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const note = (path: string, body: string, modifiedMs: number): IndexedNote => ({
  path,
  title: path.split("/").pop()?.replace(/\.md$/, "") ?? "",
  folder: path.split("/")[0] ?? "",
  body,
  tags: [],
  people: [],
  modifiedMs,
});

const index = createSearchIndex([
  note("Knowledge/Kubernetes.md", "kubectl rollout restart deployment/api", 1),
  note("Projects/Acme sync.md", "auth", 3),
  note("Inbox/Groceries.md", "milk", 2),
]);

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

function render(overrides: { actions?: PaletteAction[] } = {}) {
  const onOpenNote = vi.fn<(path: string) => void>();
  const onCreateNote = vi.fn<(title: string) => void>();
  const actions = overrides.actions ?? [
    { id: "new", label: "New note", run: vi.fn() },
    { id: "pin", label: "Toggle pin on top", run: vi.fn() },
    { id: "grammar", label: "Toggle grammar", run: vi.fn() },
  ];
  act(() =>
    root.render(
      <CommandPalette index={index} actions={actions} onOpenNote={onOpenNote} onCreateNote={onCreateNote} />,
    ),
  );
  return { onOpenNote, onCreateNote, actions };
}

const dialog = () => container.querySelector('[role="dialog"]');
const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
const options = () => [...container.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");

function hotkey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true }));
  });
}

function typeQuery(value: string) {
  const field = input();
  if (!field) throw new Error("palette is closed");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(name: string, init: KeyboardEventInit = {}) {
  act(() => {
    input()?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
  });
}

describe("CommandPalette", () => {
  test("is closed until ⌘K or ⌘P", () => {
    render();
    expect(dialog()).toBeNull();
    hotkey("k");
    expect(dialog()).not.toBeNull();
    key("Escape");
    expect(dialog()).toBeNull();
    hotkey("p");
    expect(dialog()).not.toBeNull();
  });

  test("an empty query shows recent notes, then the actions", () => {
    render();
    hotkey("k");
    expect(options()).toEqual([
      expect.stringContaining("Acme sync"),
      expect.stringContaining("Groceries"),
      expect.stringContaining("Kubernetes"),
      "New note",
      "Toggle pin on top",
      "Toggle grammar",
    ]);
  });

  test("typing searches with typos and shows the matching line; Enter opens the note", () => {
    const { onOpenNote } = render();
    hotkey("k");
    typeQuery("kubctl");
    expect(options()[0]).toContain("Kubernetes");
    expect(options()[0]).toContain("kubectl rollout restart");
    key("Enter");
    expect(onOpenNote).toHaveBeenCalledWith("Knowledge/Kubernetes.md");
    expect(dialog()).toBeNull();
  });

  test("arrow keys move to an action and Enter runs it", () => {
    const { actions } = render();
    hotkey("k");
    typeQuery("toggle");
    expect(options()).toEqual(["Toggle pin on top", "Toggle grammar"]);
    key("ArrowDown");
    key("Enter");
    expect(actions[2]?.run).toHaveBeenCalledOnce();
    expect(actions[1]?.run).not.toHaveBeenCalled();
  });

  test("⌘Enter with no matching note creates one with the query as title", () => {
    const { onCreateNote, onOpenNote } = render();
    hotkey("k");
    typeQuery("Quarterly planning");
    key("Enter", { metaKey: true });
    expect(onCreateNote).toHaveBeenCalledWith("Quarterly planning");
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  test("⌘Enter does nothing when a note matches", () => {
    const { onCreateNote } = render();
    hotkey("k");
    typeQuery("groceries");
    key("Enter", { metaKey: true });
    expect(onCreateNote).not.toHaveBeenCalled();
  });

  test("Enter and Escape that end an IME composition do nothing", () => {
    const { onOpenNote, onCreateNote } = render();
    hotkey("k");
    typeQuery("kubctl");
    key("Enter", { isComposing: true });
    key("Enter", { isComposing: true, metaKey: true });
    key("Escape", { isComposing: true });
    key("ArrowDown", { isComposing: true });
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(onCreateNote).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("Kubernetes");
  });

  test("keyCode 229 is treated as composition", () => {
    const { onOpenNote } = render();
    hotkey("k");
    act(() => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(event, "keyCode", { value: 229 });
      input()?.dispatchEvent(event);
    });
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  test("clicking a result opens it", () => {
    const { onOpenNote } = render();
    hotkey("k");
    const first = container.querySelector<HTMLElement>('[role="option"]');
    act(() => first?.click());
    expect(onOpenNote).toHaveBeenCalledWith("Projects/Acme sync.md");
  });
});
