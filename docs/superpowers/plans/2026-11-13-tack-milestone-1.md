# Tack Milestone 1 (Daily Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fast macOS notes app that Ahmed can use every day: iCloud Markdown vault, Notion-style editor, global quick-capture hotkey, fuzzy search, Harper grammar, pin on top.

**Architecture:** Tauri v2 app. Rust owns the file system (vault read/write, file watcher, settings, global shortcut, windows). A React + TypeScript UI owns editing (Milkdown), search (in-memory MiniSearch index rebuilt from the files) and grammar (harper.js in a Web Worker). Markdown files in the vault are the only source of truth.

**Tech Stack:** Tauri 2, Rust (stable), React 19, TypeScript (strict), Vite, Vitest + jsdom, Milkdown 7 (`@milkdown/crepe`), MiniSearch, `yaml`, `harper.js`; Rust crates `notify`, `trash`, `serde`, `tempfile` (dev), `tauri-plugin-global-shortcut`.

**Spec:** `docs/superpowers/specs/2026-11-13-tack-design.md` (read sections 4, 5, 8.1–8.3, 8.7, 8.9 before any task).

## Global Constraints

- macOS on Apple Silicon only. No Windows/Linux code paths.
- Free only: no paid services, no API keys.
- English only for UI and grammar.
- Markdown files are the source of truth. Any index or cache can be rebuilt from them. No note content in any app database.
- A file opened and closed without edits stays byte-identical. Edited files may be normalized but never lose content. Unsupported syntax (tables, `![[embeds]]`, footnotes, `%%comments%%`, HTML, math) is kept and still editable as text.
- Obsidian compatibility: YAML frontmatter, `[[wikilinks]]`, `> [!note]` callouts, `- [ ]` tasks must keep working in Obsidian iOS after Tack saves.
- Vault root default: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Tack/`.
- Vault folders: `Inbox/`, `Meetings/`, `People/`, `Projects/`, `Knowledge/`, `Weekly/`, plus `CLAUDE.md` at the root.
- Frontmatter keys: `type` (`meeting | note | person | project | knowledge | weekly`), `created` (`YYYY-MM-DDTHH:mm`), `tags`, `people`, `project`.
- Quick capture: default hotkey `Alt+Space` (shown as `⌥Space`), configurable; panel accepts typing within about 200 ms of the hotkey; `Esc` saves to `Inbox/` and closes.
- Command palette / search: `⌘K` and `⌘P`.
- Harper grammar on by default, can be turned off.
- Code style: no comments unless a non-obvious "why". Pin exact dependency versions in the lockfiles.
- Nothing outside the vault is written into iCloud (settings, caches, logs live in the Tauri app data dir).

## Review Focus

1. **iCloud placeholder (not downloaded) note is opened** → Tack downloads it and shows the real text; it never autosaves an empty document over it. Test in Task 2 and Task 4.
2. **Obsidian iOS changes the open note while Tack has unsaved edits** → Tack asks "Keep mine / Use theirs"; it never silently overwrites either side. Test in Task 5.
3. **Quick-capture text with `/`, `:`, emoji, or two captures in the same minute** → safe, unique file names, no lost capture. Test in Task 2 and Task 8.
4. **Quick capture closed with empty or whitespace-only text** → no file is created. Test in Task 8.
5. **Vault with 2,000 notes** → search answers in under 50 ms after the index is built. Test in Task 6.

---

## File Structure

```
src-tauri/
  tauri.conf.json          windows "main" and "capture", bundle signing identity
  src/lib.rs               app builder, command registration, plugin setup
  src/vault.rs             path resolution, init, list/read/write/create/rename/move/trash
  src/names.rs             safe + unique file names
  src/icloud.rs            placeholder detection and download
  src/settings.rs          Settings load/save (app data dir)
  src/watcher.rs           notify watcher -> "vault-changed" event
  src/capture.rs           global shortcut + capture window show/hide
  templates/CLAUDE.md      vault rules file copied on init
src/
  main.tsx, App.tsx        main window shell
  capture/CaptureApp.tsx   quick-capture window UI
  capture/captureNote.ts   capture text -> title + note content
  lib/vault.ts             typed wrappers for Rust commands + events
  lib/settings.ts          typed settings wrappers
  markdown/frontmatter.ts  split/join/parse frontmatter
  markdown/plugins/        wikilink, callout, raw-block Milkdown/remark plugins
  markdown/pipeline.ts     shared Milkdown config used by editor and tests
  markdown/fixtures/*.md   round-trip fixtures
  editor/Editor.tsx        Milkdown Crepe editor
  editor/noteSession.ts    load / dirty / autosave / conflict state machine
  search/query.ts          parse "#tag @person in:folder text"
  search/index.ts          MiniSearch index + hit line extraction
  palette/CommandPalette.tsx
  layout/Sidebar.tsx, layout/NoteList.tsx, layout/TitleField.tsx
  grammar/harper.ts        worker linter wrapper
  grammar/grammarPlugin.ts ProseMirror decorations + fix popover
  styles/tokens.css        design tokens (light + dark)
scripts/install.sh         build, sign, copy to /Applications
```

---

### Task 1: Project scaffold

**Files:**
- Create: whole Tauri v2 + React + TS project in `~/Tools/tack` (keep existing `docs/`)
- Create: `src/smoke.test.ts`, `src-tauri/src/lib.rs` test module

**Interfaces:**
- Produces: `pnpm test` (Vitest, jsdom), `pnpm tauri dev`, `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 1:** Install Rust if missing: `curl https://sh.rustup.rs -sSf | sh -s -- -y`, then `rustc --version` prints a stable version.
- [ ] **Step 2:** Scaffold with `pnpm create tauri-app` (React, TypeScript, pnpm) into the repo root without deleting `docs/`. App identifier `dev.ahmed.tack`, product name `Tack`.
- [ ] **Step 3:** Add Vitest with `environment: "jsdom"` and a script `"test": "vitest run"`. Add `tsconfig` strict mode.
- [ ] **Step 4:** Write `src/smoke.test.ts` asserting `1 + 1 === 2` and a Rust `#[test] fn smoke()`; run `pnpm test` and `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: both PASS.
- [ ] **Step 5:** Run `pnpm tauri dev`. Expected: a window titled "Tack" opens.
- [ ] **Step 6:** Commit `chore: scaffold Tauri app`.

### Task 2: Vault core (Rust)

**Files:**
- Create: `src-tauri/src/vault.rs`, `src-tauri/src/names.rs`, `src-tauri/src/icloud.rs`, `src-tauri/src/settings.rs`, `src-tauri/templates/CLAUDE.md`
- Create: `src/lib/vault.ts`, `src/lib/settings.ts`
- Modify: `src-tauri/src/lib.rs` (register commands)

**Interfaces:**
- Produces (Tauri commands; all `path` values are relative to the vault root with `/` separators; errors are `String`):
  - `vault_status() -> VaultStatus { root: String, exists: bool }`
  - `vault_init() -> ()` creates missing folders and `CLAUDE.md`; never overwrites existing files
  - `list_notes() -> Vec<NoteMeta>`; `NoteMeta { path: String, title: String, folder: String, modified_ms: u64, placeholder: bool }`
  - `read_note(path: String) -> String`
  - `write_note(path: String, content: String) -> NoteMeta`
  - `create_note(folder: String, title: String, content: String) -> NoteMeta`
  - `rename_note(path: String, new_title: String) -> NoteMeta`
  - `move_note(path: String, folder: String) -> NoteMeta`
  - `trash_note(path: String) -> ()` (macOS Trash via `trash` crate)
  - `get_settings() -> Settings`, `set_settings(settings: Settings) -> ()`; `Settings { vault_root: Option<String>, capture_hotkey: String, grammar_enabled: bool, always_on_top: bool, pinned: Vec<String> }`, defaults `None, "Alt+Space", true, false, []`, stored as JSON in the app data dir
  - `names::safe_title(input: &str) -> String`, `names::unique_path(dir: &Path, title: &str) -> PathBuf`
  - `icloud::placeholder_target(file_name: &str) -> Option<String>` (`.Foo.md.icloud` → `Foo.md`), `icloud::ensure_downloaded(path: &Path, timeout: Duration) -> Result<(), String>` (runs `brctl download <path>` and polls until the real file exists)
  - TS: `src/lib/vault.ts` exports the same functions in camelCase (`vaultStatus`, `vaultInit`, `listNotes`, `readNote`, `writeNote`, `createNote`, `renameNote`, `moveNote`, `trashNote`) and the `NoteMeta` type with camelCase fields; `src/lib/settings.ts` exports `getSettings`, `setSettings`, `Settings`.

Rules: `title` is the file name without `.md`. Only `*.md` files and placeholders of `*.md` are listed; hidden folders (`.obsidian`, `.trash`) are skipped. `write_note` writes to a temp file in the same folder then renames (atomic). Every path argument is rejected if it escapes the vault root (`..`, absolute).

- [ ] **Step 1:** Write failing tests in `vault.rs`/`names.rs`/`icloud.rs` (use `tempfile::TempDir` as vault root):
  - `init_creates_folders_and_claude_md` → all six folders + `CLAUDE.md` exist; second call leaves an edited `CLAUDE.md` unchanged.
  - `list_skips_hidden_and_non_md` → `.obsidian/x.md` and `a.txt` not listed; `Inbox/a.md` listed with `title == "a"`, `folder == "Inbox"`.
  - `list_marks_placeholder` → `Inbox/.Idea.md.icloud` listed as `path == "Inbox/Idea.md"`, `placeholder == true`.
  - `write_then_read_is_byte_identical` with content containing `\r\n`, emoji and a trailing newline.
  - `safe_title_replaces_unsafe_chars` → `safe_title("a/b:c?*\"<>|  d ")` == `"a-b-c d"`; `safe_title("")` == `"Untitled"`; emoji kept.
  - `unique_path_appends_counter` → existing `x.md` gives `x 2.md`, then `x 3.md`.
  - `rejects_path_escape` → `read_note("../secret.md")` is `Err`.
  - `rename_keeps_content_and_folder`, `move_keeps_title`.
  - `settings_defaults_and_roundtrip`.
- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: new tests FAIL (not defined).
- [ ] **Step 3:** Implement the functions above. `CLAUDE.md` template: describe folders, frontmatter keys and "never delete notes; move instead".
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Add the TS wrappers and run `pnpm tsc --noEmit`. Expected: no errors.
- [ ] **Step 6:** Commit `feat: vault core commands`.

### Task 3: Markdown pipeline and round-trip gate

**Files:**
- Create: `src/markdown/frontmatter.ts`, `src/markdown/pipeline.ts`, `src/markdown/plugins/wikilink.ts`, `src/markdown/plugins/callout.ts`, `src/markdown/plugins/rawBlock.ts`
- Create: `src/markdown/fixtures/*.md`, `src/markdown/roundtrip.test.ts`, `src/markdown/frontmatter.test.ts`

**Interfaces:**
- Produces:
  - `splitFrontmatter(src: string): { frontmatter: string; body: string }` — `frontmatter` is the exact original bytes including both `---` lines and the newline after them, or `""`
  - `joinFrontmatter(frontmatter: string, body: string): string` — `joinFrontmatter(...splitFrontmatter(x))` equals `x` for every input
  - `parseFrontmatter(frontmatter: string): NoteFields` with `NoteFields { type?: string; tags: string[]; people: string[]; project?: string }` (invalid YAML → empty fields, never throws)
  - `tackEditorPlugins` — the Milkdown plugin list used by both the editor and the tests
  - `roundTripBody(body: string): Promise<string>` — parse with the real Milkdown pipeline and serialize back (test helper in `pipeline.ts`)

The editor only ever sees `body`. Frontmatter bytes are reattached unchanged.

- [ ] **Step 1:** Write fixtures, one per file: `headings-lists.md`, `tasks.md` (`- [ ]`, `- [x]`, nested), `code-fences.md` (with language tags and backticks inside), `wikilinks.md` (`[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `![[image.png]]`), `callouts.md` (`> [!note] Title`, `> [!warning]-` folded), `tables.md`, `math.md` (`$x$`, `$$` block), `footnotes.md`, `comments-html.md` (`%%hidden%%`, `<details>`), `frontmatter.md`.
- [ ] **Step 2:** Write `roundtrip.test.ts`: for each fixture `f`, `normalize(await roundTripBody(body(f)))` equals `normalize(body(f))`, where `normalize` is remark-parse + remark-gfm + remark-math + remark-frontmatter + remark-stringify with the same options as the pipeline. Add explicit assertions: output contains `[[Note|alias]]`, `![[image.png]]`, `> [!note] Title`, `%%hidden%%`, `$$` unescaped (no `\[`, `\!`, `\%`).
- [ ] **Step 3:** Write `frontmatter.test.ts`: split/join identity on all fixtures plus `"---\nfoo: [\n---\nbody"` (invalid YAML) and `"no frontmatter"`; `parseFrontmatter` of `tags: [a, b]\npeople: ["[[Sam]]"]` gives `tags == ["a","b"]`, `people == ["Sam"]` (brackets stripped).
- [ ] **Step 4:** Run `pnpm test src/markdown`. Expected: FAIL.
- [ ] **Step 5:** Implement. Wikilink and embed as an inline atom node that serializes to its original text. Callout marker and any syntax listed under "unsupported" in Global Constraints must serialize without escaping; use a raw-block node for blocks Milkdown cannot model (HTML, footnote definitions, `%%` blocks).
- [ ] **Step 6:** Run the tests. Expected: PASS. If a fixture cannot pass with Milkdown after a real attempt, stop and report to Ahmed before switching editor.
- [ ] **Step 7:** Commit `feat: markdown pipeline with round-trip tests`.

### Task 4: Editor and note session

**Files:**
- Create: `src/editor/Editor.tsx`, `src/editor/noteSession.ts`, `src/editor/noteSession.test.ts`, `src/layout/TitleField.tsx`

**Interfaces:**
- Consumes: Task 2 `readNote`, `writeNote`, `renameNote`; Task 3 `splitFrontmatter`, `joinFrontmatter`, `tackEditorPlugins`
- Produces:
  - `createNoteSession(path: string, io: NoteIO): NoteSession`; `NoteIO { read(path): Promise<string>; write(path, content): Promise<void> }`
  - `NoteSession { state: "loading" | "ready" | "conflict"; body: string; dirty: boolean; edit(body: string): void; flush(): Promise<void>; onDiskChange(content: string): void; resolve(choice: "mine" | "theirs"): Promise<void>; close(): Promise<void> }`
  - `<Editor path={string} />` React component

Rules: autosave 600 ms after the last edit, only when `dirty`. No write is ever issued while `state !== "ready"`. `close()` flushes. The session remembers the last content it wrote, so its own writes are not treated as disk changes.

- [ ] **Step 1:** Write failing tests in `noteSession.test.ts` with a fake `NoteIO` and fake timers:
  - `opening_and_closing_without_edits_never_writes`
  - `edit_saves_after_600ms_with_original_frontmatter`
  - `two_edits_within_600ms_write_once`
  - `no_write_while_loading` (read promise pending, `edit` + advance 1 s → zero writes)
  - `own_write_echo_is_ignored` (`onDiskChange(lastWritten)` keeps `state == "ready"`)
  - `failed_read_never_writes` (read rejects, e.g. placeholder download timeout → `edit` + advance 1 s → zero writes, error shown)
- [ ] **Step 2:** Run `pnpm test src/editor`. Expected: FAIL.
- [ ] **Step 3:** Implement `noteSession.ts`, then `Editor.tsx` with Milkdown Crepe (slash menu, block handle, code blocks with copy button, task lists) using `tackEditorPlugins`. `TitleField` above the editor renames the file on blur or Enter via `renameNote`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Manual check in `pnpm tauri dev`: open a fixture note from the vault, close it, `shasum` before and after is identical; type `/` and insert a checklist; the file on disk updates within 1 s.
- [ ] **Step 6:** Commit `feat: editor with autosave`.

### Task 5: File watcher and conflicts

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs`, `src/lib/vault.ts`, `src/editor/noteSession.ts`, `src/editor/Editor.tsx`
- Test: `src/editor/noteSession.test.ts`, `watcher.rs` tests

**Interfaces:**
- Produces: Rust emits event `vault-changed` with payload `{ paths: string[] }` (relative paths, debounced 300 ms). TS: `onVaultChanged(cb: (paths: string[]) => void): Promise<() => void>` in `vault.ts`.

- [ ] **Step 1:** Write failing tests:
  - Rust `watcher_reports_relative_paths` (write a file in a temp vault, receive `Inbox/a.md` within 2 s).
  - TS `disk_change_when_clean_reloads_body`.
  - TS `disk_change_when_dirty_enters_conflict_and_does_not_write`.
  - TS `resolve_mine_writes_local_body`, `resolve_theirs_replaces_body_without_write`.
- [ ] **Step 2:** Run both test suites. Expected: FAIL.
- [ ] **Step 3:** Implement the watcher (ignore hidden folders and `.icloud` placeholders) and wire `Editor` to call `readNote` + `session.onDiskChange` for the open path. In conflict state, show a banner: "This note changed on another device." with buttons "Keep mine" and "Use theirs".
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: reload and conflict handling for external edits`.

### Task 6: Fuzzy search and command palette

**Files:**
- Create: `src/search/query.ts`, `src/search/index.ts`, `src/search/*.test.ts`, `src/palette/CommandPalette.tsx`

**Interfaces:**
- Consumes: Task 2 `listNotes`, `readNote`; Task 3 `splitFrontmatter`, `parseFrontmatter`
- Produces:
  - `parseQuery(q: string): ParsedQuery { text: string; tags: string[]; people: string[]; folder?: string }` — `#tag`, `@person`, `in:meetings` (case-insensitive folder match)
  - `IndexedNote { path: string; title: string; folder: string; body: string; tags: string[]; people: string[]; modifiedMs: number }`
  - `createSearchIndex(notes: IndexedNote[]): SearchIndex` with `search(q: string, limit = 20): SearchHit[]`, `upsert(note: IndexedNote): void`, `remove(path: string): void`
  - `SearchHit { path: string; title: string; folder: string; line: string; score: number }` — `line` is the first body line that matches, trimmed to 120 chars, or `""` for title-only matches
  - `<CommandPalette />` opened with `⌘K` / `⌘P`: empty query shows recent notes; actions listed below results: "New note", "Toggle pin on top", "Toggle grammar"; Enter opens; `⌘Enter` on no match creates a note in `Inbox/` with the query as title.

MiniSearch fields: title (boost 3), tags (boost 2), people (boost 2), body. Options: `fuzzy: 0.2`, `prefix: true`.

- [ ] **Step 1:** Write failing tests:
  - `parseQuery("deploy #infra @Sam in:knowledge")` → `{ text: "deploy", tags: ["infra"], people: ["Sam"], folder: "Knowledge" }`.
  - typo match: note with body `kubectl rollout restart` is found by `"kubctl rolout"`, and `line` contains `kubectl rollout restart`.
  - prefix match: `"work"` finds title `Workshop sync`.
  - title outranks body match.
  - filters: `#infra` excludes notes without the tag.
  - `upsert` then `search` finds new text; `remove` drops it.
  - performance: 2,000 generated notes of ~300 words; `search("deplyment")` takes < 50 ms (measure with `performance.now()`, median of 5 runs).
- [ ] **Step 2:** Run `pnpm test src/search`. Expected: FAIL.
- [ ] **Step 3:** Implement. Index is built at startup from `listNotes` + `readNote` (skip placeholders, add them by title only) and updated on `vault-changed`.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Add the `[[` link picker in the editor using the same index (title search, insert `[[Title]]`). Manual check in the app.
- [ ] **Step 6:** Commit `feat: fuzzy search and command palette`.

### Task 7: Main window layout and pin on top

**Files:**
- Create: `src/layout/Sidebar.tsx`, `src/layout/NoteList.tsx`, `src/layout/sidebarModel.ts`, `src/layout/sidebarModel.test.ts`, `src/styles/tokens.css`
- Modify: `src/App.tsx`, `src-tauri/src/lib.rs` (command `set_always_on_top(on: bool)`)

**Interfaces:**
- Consumes: Tasks 2, 4, 6
- Produces: `sidebarSections(notes: NoteMeta[], pinned: string[]): SidebarSection[]` with `SidebarSection { id: "inbox" | "meetings" | "people" | "projects" | "knowledge" | "weekly" | "recent" | "pinned"; label: string; notes: NoteMeta[] }`. Recent = 10 newest by `modifiedMs`. Folder sections sorted newest first. Pinned keeps the order in `settings.pinned`.

- [ ] **Step 1:** Write failing tests for `sidebarSections` (counts per folder, recent ordering and limit 10, pinned order, missing pinned path ignored).
- [ ] **Step 2:** Run `pnpm test src/layout`. Expected: FAIL.
- [ ] **Step 3:** Implement the model and UI: sidebar | note list | editor. Shortcuts: `⌘N` new note in `Inbox/`, `⌘⇧P` pin/unpin current note, `⌘⇧T` toggle always-on-top (persisted in settings, restored at start), `⌘⌫` move note to Trash with confirm. First run: if `vaultStatus().exists` is false, show a setup screen that explains how to create the "Tack" iCloud vault in Obsidian, with a "Use this folder" button and a "Choose another folder" picker; then `vaultInit`. Colors and spacing come only from `tokens.css` (light and dark via `prefers-color-scheme`).
- [ ] **Step 4:** Run tests. Expected: PASS. Manual check: window can be narrow (320 px) and the sidebar collapses.
- [ ] **Step 5:** Commit `feat: main window layout and pin on top`.

### Task 8: Quick capture

**Files:**
- Create: `src-tauri/src/capture.rs`, `src/capture/CaptureApp.tsx`, `src/capture/captureNote.ts`, `src/capture/captureNote.test.ts`
- Modify: `src-tauri/tauri.conf.json` (window `capture`: 560×220, `visible: false`, `alwaysOnTop: true`, `decorations: false`, `center: true`, `skipTaskbar: true`), `src-tauri/src/lib.rs`, `src/main.tsx` (route by window label)

**Interfaces:**
- Consumes: Task 2 `createNote`, `getSettings`
- Produces:
  - `captureNote(text: string, now: Date): { title: string; content: string } | null` — `null` when `text.trim()` is empty; `title` = `YYYY-MM-DD HHmm ` + first 6 words of the first line (max 60 chars); `content` = frontmatter `type: note` + `created: YYYY-MM-DDTHH:mm` + blank line + text with a trailing newline
  - Rust: registers `settings.capture_hotkey` at start; command `set_capture_hotkey(accel: String) -> Result<(), String>` re-registers and saves; command `hide_capture()`

- [ ] **Step 1:** Write failing tests for `captureNote`: empty and `"  \n "` → `null`; `"Ask Sam about SSO / SCIM: tomorrow 🙂\nmore"` at 2026-11-13 14:05 → title `"2026-11-13 1405 Ask Sam about SSO / SCIM:"` (unsafe chars are cleaned later by Rust `safe_title`), content starts with `---\ntype: note\ncreated: 2026-11-13T14:05\n---\n\n`.
- [ ] **Step 2:** Run `pnpm test src/capture`. Expected: FAIL.
- [ ] **Step 3:** Implement. The capture window is created hidden at app start and only shown/hidden, never re-created. Hotkey shows it, focuses the text area, and clears old text. `Esc` or `⌘Enter`: call `captureNote`; if not `null`, `createNote("Inbox", title, content)`; then `hide_capture`. Show a small "Saved to Inbox" flash in the main window if it is visible. Two captures in the same minute produce `… 2.md` through Task 2 `unique_path`.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Manual check: from another app, press `⌥Space`, type immediately, press `Esc`; the note exists in `Inbox/`; first typed character is not lost. Empty `Esc` creates no file.
- [ ] **Step 6:** Commit `feat: quick capture hotkey`.

### Task 9: Harper grammar

**Files:**
- Create: `src/grammar/harper.ts`, `src/grammar/grammarPlugin.ts`, `src/grammar/grammarPlugin.test.ts`
- Modify: `src/editor/Editor.tsx`, `src/palette/CommandPalette.tsx` ("Toggle grammar" wired to settings)

**Interfaces:**
- Consumes: Task 2 `getSettings`/`setSettings`, Task 4 editor
- Produces:
  - `lintText(text: string): Promise<GrammarIssue[]>`; `GrammarIssue { start: number; end: number; message: string; suggestions: string[] }` (harper.js `WorkerLinter`, American English)
  - `grammarPlugin(lint: (text: string) => Promise<GrammarIssue[]>)`: ProseMirror plugin that lints each changed text block 300 ms after typing stops and draws wavy underlines; click shows message + suggestions; choosing one replaces the range.

Skip: code blocks, inline code, wikilinks, URLs, frontmatter.

- [ ] **Step 1:** Write failing tests with a fake `lint`: underline decoration covers the right range in a paragraph; no decoration inside a code block or a wikilink; applying a suggestion replaces exactly the range; disabled plugin produces no decorations.
- [ ] **Step 2:** Run `pnpm test src/grammar`. Expected: FAIL.
- [ ] **Step 3:** Implement. Load the Harper binary lazily so it does not slow app start.
- [ ] **Step 4:** Run tests. Expected: PASS. Manual check: typing `This are a test` shows an underline within 1 s.
- [ ] **Step 5:** Commit `feat: harper grammar check`.

### Task 10: Signed build and install

**Files:**
- Create: `scripts/install.sh`, `README.md`
- Modify: `src-tauri/tauri.conf.json` (`bundle.macOS.signingIdentity: "Tack Local Signing"`)

- [ ] **Step 1:** In `README.md`, document the one-time step: Keychain Access → Certificate Assistant → Create a Certificate, name `Tack Local Signing`, type "Code Signing", in the login keychain.
- [ ] **Step 2:** `scripts/install.sh`: fail with a clear message if `security find-identity -p codesigning` does not list `Tack Local Signing`; run `pnpm tauri build`; quit a running Tack; copy `Tack.app` to `/Applications`; open it.
- [ ] **Step 3:** Run the full suite: `pnpm test && cargo test --manifest-path src-tauri/Cargo.toml && pnpm tsc --noEmit`. Expected: all PASS.
- [ ] **Step 4:** Run `scripts/install.sh` twice. Expected: `codesign -dv /Applications/Tack.app` shows the same identity both times; the global hotkey still works after the second install.
- [ ] **Step 5:** Commit `chore: signed local build`.

### Task 11: Visual design pass

**Files:**
- Modify: `src/styles/tokens.css`, layout and palette components

- [ ] **Step 1:** Show Ahmed 2–3 mockups of the main window, the quick-capture panel and the palette (inspiration from the spec: Notion editor, Raycast speed, Bear calm look). Get his pick.
- [ ] **Step 2:** Apply the picked design through tokens and components only. No logic changes.
- [ ] **Step 3:** Run the full suite from Task 10 Step 3. Expected: PASS.
- [ ] **Step 4:** Commit `style: apply approved visual design`.

---

## Out of scope for Milestone 1

Ask Claude panel, history snapshots, meetings, weekly agent (Milestones 2–4). Updating `[[links]]` in other notes when a note is renamed.
