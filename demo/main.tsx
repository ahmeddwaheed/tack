import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../src/App";
import { CaptureApp } from "../src/capture/CaptureApp";
import { DRAFT, demoNotes, MEETING } from "./vault";
import "./demo.css";

const scene = new URLSearchParams(location.search).get("scene") ?? "main";
const NOW = new Date("2026-11-10T11:30:00").getTime();
const VAULT_ROOT = "/Users/demo/Notes/Tack";

const files = new Map(demoNotes.map((n) => [n.path, n.content]));
const modified = new Map(
  demoNotes.map((n) => [n.path, NOW - (scene === "grammar" && n.path === DRAFT ? 1 : n.minutesAgo) * 60_000]),
);

const metaOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return {
    path,
    title: path.slice(slash + 1).replace(/\.md$/, ""),
    folder: slash < 0 ? "" : path.slice(0, slash),
    modified_ms: modified.get(path) ?? NOW,
    placeholder: false,
  };
};

let settings = {
  vault_root: VAULT_ROOT,
  capture_hotkey: "Alt+Space",
  grammar_enabled: true,
  always_on_top: false,
  pinned: [MEETING],
};

let conflicted = false;
const theirs = (content: string) =>
  content.replace("- [ ] Maya: write the release notes", "- [x] Maya: write the release notes");

type Args = Record<string, unknown>;

const commands: Record<string, (args: Args) => unknown> = {
  vault_status: () => ({ root: VAULT_ROOT, exists: true, container_exists: true }),
  vault_init: () => null,
  list_notes: () => [...files.keys()].map(metaOf),
  read_note: ({ path }) => {
    const content = files.get(path as string) ?? "";
    if (conflicted && path === MEETING) return theirs(content);
    return content;
  },
  write_note: ({ path, content }) => {
    if (scene === "conflict") {
      conflicted = true;
      throw `CONFLICT: ${String(path)}`;
    }
    files.set(path as string, content as string);
    modified.set(path as string, NOW);
    return metaOf(path as string);
  },
  create_note: ({ folder, title, content }) => {
    const path = `${String(folder)}/${String(title)}.md`;
    files.set(path, content as string);
    modified.set(path, NOW);
    return metaOf(path);
  },
  rename_note: ({ path }) => metaOf(path as string),
  move_note: ({ path }) => metaOf(path as string),
  trash_note: () => null,
  get_settings: () => settings,
  set_settings: (args) => {
    settings = args.settings as typeof settings;
    return null;
  },
  watch_vault: () => null,
  set_always_on_top: () => null,
  hide_capture: () => null,
  set_capture_hotkey: () => null,
  unavailable_capture_hotkey: () => null,
};

mockWindows(scene === "capture" ? "capture" : "main");
mockIPC(
  (cmd, args) => {
    const handler = commands[cmd];
    if (handler) return handler((args ?? {}) as Args);
    if (cmd.startsWith("plugin:")) return null;
    throw new Error(`Demo has no mock for ${cmd}`);
  },
  { shouldMockEvents: true },
);

document.documentElement.dataset.scene = scene;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {scene === "capture" ? (
      <div className="demo-desktop">
        <div className="demo-panel" data-demo-frame>
          <CaptureApp />
        </div>
      </div>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
