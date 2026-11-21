import { emit } from "@tauri-apps/api/event";
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
  claude_path: null,
};

let conflicted = false;
const theirs = (content: string) =>
  content.replace("- [ ] Maya: write the release notes", "- [x] Maya: write the release notes");

type Args = Record<string, unknown>;

const SUMMARY = [
  "## Summary",
  "",
  "- Staging is stable; one more day of soak time before the next step.",
  "- The Search revamp beta needs the new index first.",
  "- No deploys on Friday afternoon.",
  "- Open tasks: feature flag to 50%, release notes, error budget check.",
  "",
].join("\n");

const noteBetweenMarkers = (prompt: string) => {
  const lines = prompt.split("\n");
  const start = lines.findIndex((line) => line.startsWith("<<<TACK_NOTE_START"));
  const end = lines.findIndex((line) => line.startsWith("<<<TACK_NOTE_END"));
  return lines.slice(start + 1, end).join("\n");
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const askClaude = async ({ requestId, prompt }: Args) => {
  await emit("claude-progress", { requestId, text: "Reading the note…" });
  await pause(150);
  await emit("claude-progress", { requestId, text: "Reading the note…\nWriting a summary…" });
  await pause(150);
  return `${SUMMARY}${noteBetweenMarkers(prompt as string).replace(/^\n+/, "")}`;
};

const olderMeeting = (content: string) =>
  content
    .replace("Staging is green since Monday. Sam wants one more day of soak time.", "Staging is green since monday, sam wants more soak time")
    .replace("- [ ] Sam: check the error budget after the restart\n", "");

const MINUTE = 60_000;
const historyEntries = () => [
  { id: "3", created_ms: Date.now() - 4 * MINUTE, reason: "Before Ask Claude: Summarize", bytes: 900 },
  { id: "2", created_ms: Date.now() - 2 * 60 * MINUTE, reason: "Before restore", bytes: 880 },
  { id: "1", created_ms: Date.now() - 26 * 60 * MINUTE, reason: "Before Ask Claude: Check", bytes: 860 },
];

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
  ask_claude: askClaude,
  cancel_claude: () => null,
  history_save: ({ reason }) => ({ id: "4", created_ms: Date.now(), reason, bytes: 900 }),
  history_list: historyEntries,
  history_read: ({ path, id }) => {
    const content = files.get(path as string) ?? "";
    return id === "1" ? olderMeeting(content) : content;
  },
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
