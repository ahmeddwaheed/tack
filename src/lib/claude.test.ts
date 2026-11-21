import { beforeEach, describe, expect, test, vi } from "vitest";
import { askClaude, ClaudeError } from "./claude";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  unlisten: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(name, handler);
    return mocks.unlisten;
  },
}));

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.unlisten.mockReset();
  mocks.handlers.clear();
});

const failWith = async (raw: string) => {
  mocks.invoke.mockRejectedValue(raw);
  const error = await askClaude("p", () => {}).result.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ClaudeError);
  return error as ClaudeError;
};

describe("askClaude", () => {
  test("resolves_with_the_result_and_reports_only_its_own_progress", async () => {
    const seen: string[] = [];
    let release: (value: string) => void = () => {};
    mocks.invoke.mockImplementation((command) =>
      command === "ask_claude" ? new Promise((resolve) => (release = resolve)) : Promise.resolve(),
    );
    const run = askClaude("Fix typos", (text) => seen.push(text));
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("ask_claude", { requestId: run.requestId, prompt: "Fix typos" }));
    const progress = mocks.handlers.get("claude-progress");
    progress?.({ payload: { requestId: "other", text: "nope" } });
    progress?.({ payload: { requestId: run.requestId, text: "Hel" } });
    release("Hello");
    expect(await run.result).toBe("Hello");
    expect(seen).toEqual(["Hel"]);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  test("request_ids_are_unique", () => {
    mocks.invoke.mockResolvedValue("x");
    expect(askClaude("a", () => {}).requestId).not.toBe(askClaude("b", () => {}).requestId);
  });

  test("cancel_invokes_cancel_claude_with_the_request_id", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const run = askClaude("p", () => {});
    run.result.catch(() => {});
    await run.cancel();
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_claude", { requestId: run.requestId });
  });

  test("cancel_before_the_request_starts_never_runs_claude", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const run = askClaude("p", () => {});
    await run.cancel();
    const error = await run.result.catch((e: unknown) => e);
    expect((error as ClaudeError).kind).toBe("cancelled");
    expect(mocks.invoke).not.toHaveBeenCalledWith("ask_claude", expect.anything());
  });

  test.each([
    ["CLAUDE_MISSING: not found", "missing"],
    ["CLAUDE_LOGIN: Invalid API key", "login"],
    ["CLAUDE_TIMEOUT: too slow", "timeout"],
    ["CLAUDE_CANCELLED: cancelled", "cancelled"],
    ["CLAUDE_FAILED: overloaded", "failed"],
    ["something else", "failed"],
  ] as const)("maps %s to %s", async (raw, kind) => {
    const error = await failWith(raw);
    expect(error.kind).toBe(kind);
    expect(error.message.length).toBeGreaterThan(0);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  test("failed_errors_carry_the_detail", async () => {
    expect((await failWith("CLAUDE_FAILED: overloaded")).message).toContain("overloaded");
  });
});
