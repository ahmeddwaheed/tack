import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SetupScreen } from "./SetupScreen";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  open: vi.fn<(options: unknown) => Promise<string | null>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const stored = {
  vault_root: null,
  capture_hotkey: "Alt+Space",
  grammar_enabled: true,
  always_on_top: false,
  pinned: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command) => (command === "get_settings" ? stored : undefined));
  mocks.open.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (containerExists = true) => {
  const onReady = vi.fn();
  const onCheckAgain = vi.fn();
  act(() =>
    root.render(
      <SetupScreen
        root="/Users/me/iCloud/Tack"
        containerExists={containerExists}
        onReady={onReady}
        onCheckAgain={onCheckAgain}
      />,
    ),
  );
  const button = (label: string) => {
    const found = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!found) throw new Error(`no button ${label}`);
    return found;
  };
  return { onReady, onCheckAgain, button };
};

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
  });
};

describe("SetupScreen", () => {
  test("explains the iCloud vault and shows where Tack looks", () => {
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("Install Obsidian on your iPhone.");
    expect(text).toContain("create a vault named “Tack” and store it in iCloud");
    expect(text).toContain("Wait until the “Tack” folder appears on this Mac.");
    expect(text).toContain("/Users/me/iCloud/Tack");
  });

  test("tells Ahmed to make Obsidian put new notes in Inbox", () => {
    render();
    expect(container.textContent).toContain(
      "In Obsidian, open Settings → Files and links and set “Default location for new notes” to the Inbox folder.",
    );
  });

  test("Use this folder is off until Obsidian's iCloud folder exists on this Mac", async () => {
    const { button, onCheckAgain } = render(false);
    expect(button("Use this folder").disabled).toBe(true);
    expect(container.textContent).toContain("Obsidian's iCloud folder is not on this Mac yet.");
    await click(button("Check again"));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  test("Use this folder initializes the vault", async () => {
    const { onReady, button } = render();
    await click(button("Use this folder"));
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["vault_init"]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("Choose another folder saves the root before initializing", async () => {
    mocks.open.mockResolvedValue("/Users/me/Notes/Tack");
    const { onReady, button } = render();
    await click(button("Choose another folder"));
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
    expect(mocks.invoke.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ["get_settings", undefined],
      ["set_settings", { settings: { ...stored, vault_root: "/Users/me/Notes/Tack" } }],
      ["vault_init", undefined],
    ]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("a cancelled picker changes nothing", async () => {
    mocks.open.mockResolvedValue(null);
    const { onReady, button } = render();
    await click(button("Choose another folder"));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  test("a failed init shows the error and stays on setup", async () => {
    mocks.invoke.mockRejectedValue("permission denied");
    const { onReady, button } = render();
    await click(button("Use this folder"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("permission denied");
    expect(onReady).not.toHaveBeenCalled();
  });
});
