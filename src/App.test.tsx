import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  destroyed: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: async () => {
      mocks.destroyed += 1;
    },
  }),
}));
vi.mock("./layout/MainWindow", () => ({ MainWindow: () => <div data-testid="main" /> }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.invoke.mockReset();
  mocks.listeners.clear();
  mocks.destroyed = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const quit = () => act(async () => mocks.listeners.get("quit-requested")?.({ payload: null }));

describe("App quit", () => {
  test("Quit Tack closes the app from the setup screen", async () => {
    mocks.invoke.mockResolvedValue({ root: "/v/Tack", exists: false, container_exists: false });
    act(() => root.render(<App />));
    await settle();
    expect(container.textContent).toContain("Set up Tack");
    await quit();
    expect(mocks.destroyed).toBe(1);
  });

  test("Quit Tack closes the app when the vault could not be opened", async () => {
    mocks.invoke.mockRejectedValue("permission denied");
    act(() => root.render(<App />));
    await settle();
    expect(container.textContent).toContain("Tack could not open the vault");
    await quit();
    expect(mocks.destroyed).toBe(1);
  });

  test("once the main window is shown, App leaves quitting to it", async () => {
    mocks.invoke.mockResolvedValue({ root: "/v/Tack", exists: true, container_exists: true });
    act(() => root.render(<App />));
    await settle();
    expect(container.querySelector('[data-testid="main"]')).not.toBeNull();
    expect(mocks.listeners.has("quit-requested")).toBe(false);
  });
});
