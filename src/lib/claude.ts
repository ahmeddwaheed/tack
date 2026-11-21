import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ClaudeErrorKind = "missing" | "login" | "timeout" | "cancelled" | "failed";

const MESSAGES: Record<Exclude<ClaudeErrorKind, "failed">, string> = {
  missing: "Claude Code is not installed. Install it, or set its path in settings.",
  login: "Claude Code is not signed in. Run `claude` in Terminal and log in.",
  timeout: "Claude took longer than 2 minutes. Try again.",
  cancelled: "Cancelled.",
};

const PREFIXES: [string, ClaudeErrorKind][] = [
  ["CLAUDE_MISSING:", "missing"],
  ["CLAUDE_LOGIN:", "login"],
  ["CLAUDE_TIMEOUT:", "timeout"],
  ["CLAUDE_CANCELLED:", "cancelled"],
  ["CLAUDE_FAILED:", "failed"],
];

export class ClaudeError extends Error {
  constructor(
    readonly kind: ClaudeErrorKind,
    detail = "",
  ) {
    super(kind === "failed" ? `Claude failed: ${detail || "unknown error"}` : MESSAGES[kind]);
    this.name = "ClaudeError";
  }
}

const toClaudeError = (raw: unknown): ClaudeError => {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw);
  const match = PREFIXES.find(([prefix]) => text.startsWith(prefix));
  return match ? new ClaudeError(match[1], text.slice(match[0].length).trim()) : new ClaudeError("failed", text);
};

export type ClaudeRun = {
  requestId: string;
  result: Promise<string>;
  cancel(): Promise<void>;
};

export const askClaude = (prompt: string, onProgress: (text: string) => void): ClaudeRun => {
  const requestId = crypto.randomUUID();
  let cancelled = false;
  let settled = false;
  const result = (async () => {
    const unlisten = await listen<{ requestId: string; text: string }>("claude-progress", (event) => {
      if (event.payload.requestId === requestId) onProgress(event.payload.text);
    });
    try {
      if (cancelled) throw new ClaudeError("cancelled");
      const text = await invoke<string>("ask_claude", { requestId, prompt });
      if (cancelled) throw new ClaudeError("cancelled");
      return text;
    } catch (e) {
      if (e instanceof ClaudeError) throw e;
      throw cancelled ? new ClaudeError("cancelled") : toClaudeError(e);
    } finally {
      settled = true;
      unlisten();
    }
  })();
  const cancel = async () => {
    if (settled) return;
    cancelled = true;
    await invoke<void>("cancel_claude", { requestId });
  };
  return { requestId, result, cancel };
};
