# Tack Milestone 2 (Ask Claude + History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Ask Claude" panel that rewrites, checks or summarizes the open note through the local `claude` CLI, shows the change as a diff to accept or reject, and a per-note history of snapshots that can be restored.

**Architecture:** Rust runs the `claude` CLI as a child process (`claude -p … --output-format stream-json`), streams progress to the UI as events, and owns a snapshot store in the app data dir (outside iCloud). The UI builds the prompt, shows a line diff, and applies an accepted result through the editor as one undoable change, so the existing note session saves it with compare-and-write.

**Tech Stack:** Tauri 2, Rust (`tokio` process via `tauri::async_runtime`), React + TypeScript, Milkdown Crepe, `diff` (jsdiff) for line diffs.

**Spec:** `docs/superpowers/specs/2026-11-13-tack-design.md` — sections 2 (goal 6), 4, 5, 8.5. Milestone 1 plan for existing interfaces: `docs/superpowers/plans/2026-11-13-tack-milestone-1.md`.

## Global Constraints

- Free only. Claude runs through the user's existing `claude` CLI login. No API keys.
- The app works without Claude: if the CLI is missing or not logged in, only Claude features show a clear message.
- Note content is never lost: every Claude change and every restore takes a snapshot of the current file first.
- Snapshots live in the Tauri app data dir (`history/`), never in the iCloud vault.
- Claude never writes files itself: it only returns text. Tack applies it.
- English only. No comments unless a non-obvious "why". Exact dependency pins (`.npmrc` save-exact; check `package.json` for `^`). Repo-local git email is the GitHub noreply address; don't change git config.
- Existing behaviour stays: compare-and-write saves, conflict banner, close guard, Markdown round-trip safety.

## Review Focus

1. **The note changes while Claude works** (user types, or the phone edits) → "Accept" is blocked with "The note changed while Claude worked. Ask again."; nothing is overwritten. Test in Task 5.
2. **Claude returns the note inside a ```` ```markdown ```` fence, or empty text** → the outer fence is removed; empty output is an error and is never applied. Test in Task 3.
3. **CLI missing, not logged in, killed by Cancel, or slower than 120 s** → a clear message, the panel returns to idle, the note is unchanged, no orphan process. Test in Task 2 and Task 5.
4. **Accept or Restore while the note is in conflict or still loading** → disabled. Test in Task 5 and Task 6.
5. **A note with a long history** → only the newest 50 snapshots are kept; after rename or move, the history follows the note. Test in Task 1.

---

## File Structure

```
src-tauri/src/history.rs     snapshot store: save, list, read, prune, move on rename
src-tauri/src/claude.rs      CLI path resolution, process run, stream parsing, cancel, timeout
src-tauri/src/lib.rs         register commands, manage ClaudeState
src-tauri/src/vault.rs       rename_note / move_note also move history
src/lib/history.ts           typed wrappers for history commands
src/lib/claude.ts            typed wrappers for ask/cancel + progress event
src/claude/prompt.ts         quick actions, buildAskPrompt, extractNoteBody
src/claude/ClaudePanel.tsx   input, quick buttons, progress, diff, accept/reject
src/claude/lineDiff.ts       diff rows for display
src/history/HistoryPanel.tsx snapshot list, preview, restore
src/editor/mountNoteEditor.ts NoteEditor.replaceBody
src/editor/Editor.tsx        expose replaceBody to the main window
src/layout/MainWindow.tsx    right-side panel slot, palette actions, shortcuts
```

---

### Task 1: Snapshot store (Rust)

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/vault.rs` (rename/move), `src/lib/history.ts` (new)

**Interfaces:**
- Produces (Tauri commands, `#[tauri::command(async)]`, errors `String`):
  - `history_save(path: String, content: String, reason: String) -> HistoryEntry`
  - `history_list(path: String) -> Vec<HistoryEntry>` newest first
  - `history_read(path: String, id: String) -> String`
  - `HistoryEntry { id: String, created_ms: u64, reason: String, bytes: u64 }` (TS camelCase: `createdMs`)
  - Rust `history::move_history(root: &Path, from: &str, to: &str) -> Result<(), String>` called by rename/move after a successful file rename
  - TS `src/lib/history.ts`: `saveSnapshot(path, content, reason)`, `listSnapshots(path)`, `readSnapshot(path, id)`, type `HistoryEntry`
- Storage: `<app_data>/history/<key>/<id>.md` where `<key>` is the vault-relative note path percent-encoded (`/` → `%2F`), `<id>` = zero-padded `created_ms` + `-` + 4-digit counter (sortable, unique). Reason metadata in `<id>.json` `{ "reason": "…" }`. Keep newest **50** per note. Writes are temp-file + rename.
- `path` must pass the vault note-path rules (reuse `resolve_note` validation; don't touch the vault).

- [ ] **Step 1:** Failing tests (TempDir as app data): `save_then_list_newest_first`, `read_returns_exact_bytes` (emoji, `\r\n`), `keeps_only_newest_50`, `ids_unique_within_same_ms`, `move_history_follows_rename` (list under new path has the entries, old path empty), `rejects_invalid_note_path` (`../x.md`, `.obsidian/x.md`, `Inbox`), `read_unknown_id_is_err`.
- [ ] **Step 2:** `cargo test --manifest-path src-tauri/Cargo.toml history` → FAIL.
- [ ] **Step 3:** Implement; hook `move_history` into `rename_note` and `move_note` (history failure must not fail the rename — log it).
- [ ] **Step 4:** Tests PASS; `cargo clippy -- -D warnings` clean; `pnpm tsc --noEmit` clean.
- [ ] **Step 5:** Commit `feat: note history snapshots`.

### Task 2: Claude runner (Rust)

**Files:**
- Create: `src-tauri/src/claude.rs`, `src-tauri/tests/fixtures/fake-claude.sh` (test-only script)
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/settings.rs` (`claude_path: Option<String>`, default `None`), `src/lib/claude.ts` (new), `src/lib/settings.ts`

**Interfaces:**
- Produces:
  - `ask_claude(request_id: String, prompt: String) -> Result<String, String>` (async): runs the CLI, resolves with the final result text.
  - `cancel_claude(request_id: String) -> ()` kills the child (and its process group).
  - Event `claude-progress` payload `{ requestId: string, text: string }` (accumulated assistant text so far).
  - Error prefixes (TS maps them): `CLAUDE_MISSING:`, `CLAUDE_LOGIN:`, `CLAUDE_TIMEOUT:`, `CLAUDE_CANCELLED:`, `CLAUDE_FAILED:`.
  - Pure fns: `parse_stream_line(line: &str) -> Option<StreamEvent>` with `StreamEvent::{Text(String), Result { text: String, is_error: bool }}`; `classify_failure(stderr: &str, result_text: &str) -> &'static str` (login words: "login", "/login", "Invalid API key", "not logged in" → `CLAUDE_LOGIN:`).
  - `resolve_claude_path(settings_path: Option<&str>) -> Option<PathBuf>`: settings value if it exists; else `zsh -lc 'command -v claude'` (GUI apps don't get the shell PATH); else `~/.claude/local/claude`, `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`.
  - TS `src/lib/claude.ts`: `askClaude(prompt, onProgress): { requestId: string; result: Promise<string>; cancel(): Promise<void> }`; `ClaudeError` with `kind: "missing" | "login" | "timeout" | "cancelled" | "failed"` and a user message.
- Command line (exact): `claude -p --output-format stream-json --verbose --no-session-persistence --disallowedTools "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Read,Glob,Grep,Task"`, prompt on **stdin**, current dir = a fresh empty temp dir. Timeout **120 s**. Child killed on drop.

- [ ] **Step 1:** Failing tests: `parse_stream_line` for an assistant text line, a `result` line (success and `is_error: true`), and junk (→ `None`); `classify_failure` cases; `resolve_claude_path` prefers an existing settings path and ignores a missing one; integration tests that point `claude_path` at `fake-claude.sh` (modes via env var: success stream, login error, sleep forever): success returns the result text and emits ≥1 progress event; login → `CLAUDE_LOGIN:`; cancel during sleep → `CLAUDE_CANCELLED:` and the child is gone; a 1 s test timeout → `CLAUDE_TIMEOUT:` (make the timeout injectable for tests).
- [ ] **Step 2:** `cargo test claude` → FAIL.
- [ ] **Step 3:** Implement with `tokio::process::Command` (`kill_on_drop(true)`), a `ClaudeState` map of running children keyed by request id.
- [ ] **Step 4:** TS wrapper + tests for error mapping (mock invoke). All tests PASS, clippy clean.
- [ ] **Step 5:** Commit `feat: run claude cli with streaming and cancel`.

### Task 3: Prompt and result helpers (TS)

**Files:**
- Create: `src/claude/prompt.ts`, `src/claude/prompt.test.ts`

**Interfaces:**
- Produces:
  - `QUICK_ACTIONS: { id: "rewrite" | "check" | "summarize" | "actions" | "howto"; label: string; instruction: string }[]` — labels exactly: `Rewrite`, `Check`, `Summarize`, `Action items`, `Make it a how-to`.
  - `buildAskPrompt(instruction: string, body: string, title: string): string` — tells Claude: you edit one Markdown note; return ONLY the complete new note body in Markdown, no preamble, no code fence around it; keep `[[wikilinks]]`, `- [ ]` tasks, callouts and code blocks intact; English. Then the instruction, then the note between clear delimiters.
  - `extractNoteBody(output: string): string` — trims; removes ONE outer fence (```` ``` ````, ```` ```markdown ````, ```` ```md ````) when it wraps the whole output; throws `EmptyResultError` when the result is empty/whitespace.
- Instructions: Rewrite = clearer and shorter, same meaning; Check = fix grammar, spelling and unclear sentences only, keep structure; Summarize = add `## Summary` (3–6 bullets) at the top, keep the rest unchanged; Action items = add `## Action items` as `- [ ]` tasks at the top from the note, keep the rest; Make it a how-to = restructure into a step-by-step guide with a short intro and numbered steps, keep commands in code blocks.

- [ ] **Step 1:** Failing tests: every quick action label/id; prompt contains instruction, title, body, and the "ONLY the complete new note body" rule; `extractNoteBody` strips ```` ```markdown\n# A\n``` ```` → `# A`, keeps an inner code block, keeps a fence that does not wrap everything, throws on `"  \n"`.
- [ ] **Step 2:** `pnpm vitest run src/claude` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: ask claude prompt helpers`.

### Task 4: Replace the editor body as one undoable change

**Files:**
- Modify: `src/editor/mountNoteEditor.ts`, `src/editor/Editor.tsx`
- Test: `src/editor/replaceBody.test.ts`

**Interfaces:**
- Consumes: existing `NoteEditor`, `NoteSession` (Milestone 1).
- Produces:
  - `NoteEditor.replaceBody(markdown: string): void` — replaces the whole document in one transaction (one ⌘Z step), then syncs to the session immediately (no 200 ms wait), so `session.body === markdown` (as the editor serializes it) and the session autosaves with the original frontmatter.
  - `Editor` prop `onEditorReady?: (api: { replaceBody(md: string): void; currentBody(): string } | null) => void`.

- [ ] **Step 1:** Failing tests with a real Crepe editor and a fake `NoteIO`: replace → session dirty, written file keeps original frontmatter bytes, body round-trips; ⌘Z (undo command) restores the old document in one step; replaceBody while session state is `conflict` throws and changes nothing; wikilinks in the new body stay unescaped.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (parse with the same pipeline; `tr.replaceWith(0, doc.content.size, …)`). **Step 4:** PASS. **Step 5:** Commit `feat: editor replaceBody`.

### Task 5: Ask Claude panel

**Files:**
- Create: `src/claude/ClaudePanel.tsx`, `src/claude/lineDiff.ts`, tests `src/claude/ClaudePanel.test.tsx`, `src/claude/lineDiff.test.ts`
- Modify: `src/layout/MainWindow.tsx`, `src/palette/CommandPalette.tsx` usage (actions only), `src/styles/app.css`

**Interfaces:**
- Consumes: Task 2 `askClaude`/`ClaudeError`, Task 3 helpers, Task 4 editor api, Task 1 `saveSnapshot`, session `state`/`body`/`path`.
- Produces: `lineDiff(before: string, after: string): { kind: "same" | "add" | "del"; text: string }[]` (jsdiff `diffLines`, exact pin); `<ClaudePanel note={…} editor={…} onClose />`.
- Behaviour:
  - Panel on the right of the editor; opens with `⌘J` and palette action "Ask Claude"; `Esc` closes when idle.
  - Text input (placeholder `Ask Claude to change this note…`) + the 5 quick buttons. Enter or a button starts a request; shows streaming progress text and a "Cancel" button.
  - Result shows the diff (added lines green, removed red, unchanged collapsed to 2 lines of context) with "Accept", "Reject", "Ask again".
  - Accept: if `editor.currentBody()` differs from the body sent → show `The note changed while Claude worked. Ask again.` and keep the note. If session state is not `ready` → Accept disabled. Else `saveSnapshot(path, fullFileContent, "Before Ask Claude: <label or first 40 chars of instruction>")`, then `editor.replaceBody(result)`. If the snapshot fails, do not apply; show the error.
  - Errors map to messages: missing → `Claude Code is not installed. Install it and log in, then try again.`; login → `Claude Code is not logged in. Run "claude" in a terminal and log in.`; timeout → `Claude took longer than 2 minutes. Try a shorter request.`; failed → the first line of the error. Cancelled → back to idle, no message.
  - Closing the panel or switching notes cancels a running request.

- [ ] **Step 1:** Failing tests (mock `askClaude`, `saveSnapshot`, fake editor api): progress text shows; Accept applies via `replaceBody` after `saveSnapshot` (call order asserted); Reject leaves the note; stale body blocks Accept with the exact message; Accept disabled in `conflict`/`loading`; each error kind shows its exact message; Cancel calls cancel and returns to idle; switching note cancels; empty result shows `Claude returned an empty note. Nothing was changed.`; `lineDiff` basic add/del/same.
- [ ] **Step 2:** FAIL. **Step 3:** Implement + styles via tokens. **Step 4:** PASS, `pnpm build` OK. **Step 5:** Commit `feat: ask claude panel`.

### Task 6: History panel

**Files:**
- Create: `src/history/HistoryPanel.tsx`, `src/history/HistoryPanel.test.tsx`
- Modify: `src/layout/MainWindow.tsx`, `src/styles/app.css`

**Interfaces:**
- Consumes: Task 1 wrappers, Task 4 editor api, Task 5 `lineDiff`, `splitFrontmatter`.
- Behaviour: palette action "Show note history" and `⌘⇧H` open the panel in the same right-side slot as Ask Claude (one panel at a time). List: newest first, relative time + reason. Selecting an entry shows its diff against the current body. "Restore this version": disabled unless session `ready`; takes a snapshot of the current file (`reason: "Before restore"`), then `editor.replaceBody(snapshotBody)` (frontmatter of the snapshot is not applied; the body is). Empty state: `No history yet. Tack saves a version before Claude changes a note or you restore one.`

- [ ] **Step 1:** Failing tests: list order and empty-state text; restore calls `saveSnapshot` then `replaceBody` with the snapshot body (frontmatter stripped); restore disabled in `conflict`; a failed snapshot blocks restore and shows the error.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat: note history panel`.

### Task 7: Screenshots and README

**Files:**
- Modify: `demo/` mocks, `scripts/screenshots.mjs`, `README.md`

- [ ] **Step 1:** Extend the demo IPC mocks with `ask_claude` (emits 2 progress events, returns a fixed rewritten body), `history_*` (3 entries), `cancel_claude`.
- [ ] **Step 2:** Add scenes `ask-claude.png` (diff view with Accept/Reject) and `history.png` (list + diff); run `pnpm screenshots`; look at both images.
- [ ] **Step 3:** README: add both images to Features with one line each, and a "Claude" note: needs Claude Code installed and logged in; nothing is sent until you press a button.
- [ ] **Step 4:** `pnpm test`, `pnpm build` PASS. **Step 5:** Commit `docs: screenshots for ask claude and history`.
