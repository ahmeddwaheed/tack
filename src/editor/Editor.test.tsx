import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Editor } from "./Editor";
import type { NoteIO } from "./noteSession";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const SRC = "---\ntype: note\n---\n# Hello\n\nWorld.\n";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
});

function fakeIO(read: () => Promise<string> = () => Promise.resolve(SRC)) {
  const writes: { path: string; content: string }[] = [];
  const reads: string[] = [];
  const io: NoteIO = {
    read: (path) => {
      reads.push(path);
      return read();
    },
    write: async (path, content) => {
      writes.push({ path, content });
    },
    rename: async (_, newTitle) => `Inbox/${newTitle}.md`,
  };
  return { io, writes, reads };
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

describe("Editor", () => {
  test("opening and closing a note never writes", async () => {
    const { io, writes } = fakeIO();
    act(() => root.render(<Editor path="Inbox/Hello.md" io={io} />));
    await settle();
    expect(container.querySelector(".milkdown")).not.toBeNull();
    expect(container.querySelector("input")?.value).toBe("Hello");
    act(() => root.unmount());
    await settle();
    expect(writes).toEqual([]);
  });

  test("renaming continues the session on the new path", async () => {
    const { io, writes, reads } = fakeIO();
    const onPathChange = vi.fn();
    act(() => root.render(<Editor path="Inbox/Hello.md" io={io} onPathChange={onPathChange} />));
    await settle();
    const input = container.querySelector("input");
    if (!input) throw new Error("no title input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      input.focus();
      setter?.call(input, "Renamed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input.blur());
    await settle();
    expect(onPathChange).toHaveBeenCalledWith("Inbox/Renamed.md");
    act(() => root.render(<Editor path="Inbox/Renamed.md" io={io} onPathChange={onPathChange} />));
    await settle();
    expect(container.querySelector("input")?.value).toBe("Renamed");
    expect(container.querySelectorAll(".milkdown")).toHaveLength(1);
    expect(reads).toEqual(["Inbox/Hello.md"]);
    act(() => root.unmount());
    await settle();
    expect(writes).toEqual([]);
  });

  test("a failed read shows the error and no editor", async () => {
    const { io, writes } = fakeIO(() => Promise.reject(new Error("iCloud download timed out")));
    act(() => root.render(<Editor path="Inbox/Hello.md" io={io} />));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("iCloud download timed out");
    expect(container.querySelector(".milkdown")).toBeNull();
    act(() => root.unmount());
    await settle();
    expect(writes).toEqual([]);
  });
});
