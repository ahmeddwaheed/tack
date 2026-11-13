# Tack — design

Date: 2026-11-13
Status: draft, waiting for approval

"Tack" is a working name. It can change.

## 1. Intent and why

Ahmed wants to start a note-taking habit. He does not have one today. He tried
Obsidian, but its cloud sync needs a subscription. He wants an app that is fast,
simple and pleasant enough that he opens it every day, and powerful enough to
keep real work knowledge.

Two moments matter most:

- **Meetings.** He takes notes while he is on a call. He wants a recording and a
  transcript next to his notes.
- **Quick thoughts.** An idea, a command, a step of an internal process. He must
  capture it in seconds, without leaving the app he is in.

He is a backend engineer (TypeScript). The notes must work well for him first,
and also for agents (Claude Code) that read, check, rewrite and organize them.

## 2. Goals

1. Floating window that can stay on top of other apps.
2. (Removed: hidden from screen share is not needed.)
3. Notion-style editor: `/` commands, headings, checklists, code blocks with a
   copy button, callouts, links between notes. Saves plain Markdown.
4. Global hotkey opens a small quick-capture panel from any app. New text goes
   to the Inbox.
5. Meeting mode: one button records microphone and call audio. A live
   transcript appears next to the notes. Transcription is local (whisper.cpp).
6. "Ask Claude" button: he types an instruction ("rewrite", "check this",
   "make action items", free text). Claude works on the current note. The
   result shows as a diff. He accepts or rejects it.
7. After a meeting: one click makes a summary and action items from notes and
   transcript.
8. Weekly agent: sorts the Inbox, adds tags and links, writes a weekly summary
   note. He reviews what it changed.
9. Fuzzy search over all notes (title and body). Typos still find results.
   Opens with one shortcut.
10. Instant grammar and spelling underline while he types (Harper, local).
    On by default, can be turned off.
11. Phone access: notes live in iCloud Drive. On iPhone he uses the free
    Obsidian app on the same folder.
12. Very good UI/UX. Fast. Inspiration: Notion (editor), Raycast (speed,
    command palette), Granola (meeting notes beside transcript), Bear (calm
    look).

## 3. Non-goals

- No own server, no own database in the cloud.
- No own iPhone app. Obsidian mobile covers the phone.
- No real-time collaboration or sharing.
- No Notion databases, kanban boards or tables-as-database.
- No grammar correction through Claude. Grammar is Harper only.
- No Windows or Linux build.
- No speaker identification beyond "Me" vs "Them".
- No hiding from screen share.
- English only. No other language support in transcription, grammar or UI.

## 4. Anti-goals (failure even if it works)

- Any paid subscription or paid API is needed to use it.
- It feels slow: the quick-capture panel takes more than about 200 ms to accept
  typing after the hotkey.
- Notes end up in a format Obsidian cannot read, or the editor changes his
  Markdown when it saves (lost syntax, reformatted lists, removed frontmatter).
- An agent changes or deletes notes and he cannot undo it.
- He has to organize folders by hand to keep it tidy.
- Audio of meetings leaves his Mac.

## 5. Constraints

- macOS on Apple Silicon only.
- Free: open-source parts only, plus his existing Claude Code login.
- Local-first. The Markdown files are the source of truth. Any index or cache
  can be rebuilt from them.
- Must stay readable and editable by Obsidian (iOS and macOS), including when
  Obsidian edits a file while Tack is open.
- Recording other people needs their consent (Germany). The app shows a short
  reminder when recording starts. It does not enforce anything.

## 6. Approaches considered

| Approach | Trade-off |
|---|---|
| **Tauri (Rust shell + React/TypeScript UI)** — chosen | Small (~10 MB), fast start, low memory. Rust can call whisper.cpp (whisper-rs) and Harper (harper-core) directly. UI in TypeScript, which he knows. Some Rust needed for native parts. |
| Electron (all TypeScript) | Biggest ecosystem, all one language. ~150 MB, more memory, slower start. Works against "fast". |
| Native Swift / SwiftUI | Best Mac feel and audio APIs. A Notion-style Markdown editor in SwiftUI is very hard; much slower to build. |

Phone sync options considered: iCloud folder + free Obsidian (chosen, €0, no
extra build); own server + web app (1–2 weeks more, data on a server); private
GitHub repo (free, but iPhone needs a paid git app).

Transcription options considered: whisper.cpp local (chosen, free, private,
good quality); Apple speech recognition (free, weaker on long meetings); Notion
AI Meeting Notes (company account owns the data, transcript not in local notes).

## 7. Decisions made with Ahmed

- Platform: Tauri.
- Sync: iCloud Drive + Obsidian on iPhone.
- Transcription: whisper.cpp on the Mac.
- Claude connection: his Claude Code login through the `claude` CLI
  (`claude -p ...`), not a paid API key.
- Grammar: Harper, local and instant. Not Claude.
- Organization: he does not file notes by hand. He writes to the Inbox; the
  agent sorts.
- Use cases: meetings, quick thoughts, internal process notes and commands.
- Hidden from screen share: not needed.
- Language: English only.
- First version: quick capture, editor, search, iCloud vault. Meetings later
  (see 8.9).
- Weekly agent: applies changes itself, with a full backup first and one-click
  undo (no approval step).
- Personal build for his Mac only, not distributed.

Decided by Claude after the builder check (he can override):

- Markdown fidelity: a file opened and closed without edits stays
  byte-identical. When he edits a file, the editor may normalize formatting
  (for example list markers) but never loses content. Syntax the editor does not
  support (tables, `![[embeds]]`, footnotes, `%%comments%%`, HTML, math) is kept
  as raw text blocks that he can still edit as text.
- Signing: a stable self-signed certificate, so macOS keeps microphone and audio
  permissions across rebuilds. No Apple Developer Program, no notarization, no
  auto-updater.

## 8. Design

### 8.1 Vault and structure

The vault is a folder in Obsidian's iCloud container, so Obsidian iOS sees it:

`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Tack/`

(This folder appears after Obsidian is installed and an iCloud vault named
"Tack" is created on the iPhone or Mac. Setup must guide him through this.)

```
Tack/
  Inbox/                 quick captures, unsorted
  Meetings/2026/         2026-11-13 Acme sync.md
  People/                one note per person, links to meetings
  Projects/              one note per project
  Knowledge/             processes, commands, how-tos
  Weekly/                2026-W46.md (agent summary)
  CLAUDE.md              rules for agents working in this vault
```

Every note has YAML frontmatter:

```yaml
---
type: meeting | note | person | project | knowledge | weekly
created: 2026-11-13T14:05
tags: [acme, auth]
people: ["[[Sam]]"]
project: "[[Acme]]"
---
```

Links use Obsidian `[[wikilinks]]`.

### 8.2 Windows

- **Quick capture panel.** Small, floating, always on top. Opens with a global
  hotkey (default `⌥Space`, configurable). Enter a title-less thought, press
  `Esc` to save and close. Saves to `Inbox/`. The window stays loaded and hidden
  between uses so it opens instantly.
- **Main window.** Sidebar (Inbox, Meetings, People, Projects, Knowledge,
  Weekly, Recent, Pinned), editor in the middle, Claude panel on the right
  (opens on demand). Can be pinned on top and resized to a narrow side strip.
- **Command palette** (`⌘K`): search notes, run actions (new meeting, ask
  Claude, toggle on-top).

### 8.3 Editor

- Rich Markdown editor based on ProseMirror (TipTap or Milkdown, chosen in a
  spike).
- Hard rule: open → save without edits must give byte-identical files for
  normal Obsidian Markdown (frontmatter, wikilinks, tasks, code fences,
  callouts). Edited files may be normalized but never lose content.
  Unsupported syntax is kept as raw text blocks. A round-trip test suite
  proves this.
- `/` menu, Markdown shortcuts (`#`, `-`, `[]`, ``` ``` ```), `[[` link picker
  with fuzzy search, code blocks with syntax colors and a copy button.
- Autosave on every pause. No save button.
- Harper underlines grammar and spelling as he types; click to apply a fix.
- File watcher: if Obsidian or iCloud changes the open file, the editor reloads
  it. If he also has unsaved edits, show both versions and let him pick.

### 8.4 Meeting mode

- "New meeting" creates `Meetings/YYYY/YYYY-MM-DD <title>.md` and opens it in a
  split view: his notes on the left, live transcript on the right.
- Record two sources separately: microphone ("Me") and system/call audio
  ("Them"), so the transcript can label who spoke without diarization.
- whisper.cpp transcribes in short chunks (a few seconds) for a live feel. The
  final transcript is appended to the note under `## Transcript` when the
  meeting ends.
- Audio files are kept outside the vault (not synced to iCloud) and deleted
  after 7 days by default.
- English only: use an English-only Whisper model (`*.en`), which is faster and
  more accurate for English. Model size is a setting; default chosen for speed
  on his Mac.
- "Summarize" button after the meeting: Claude adds `## Summary` and
  `## Action items` (as checkboxes) at the top of the note.

### 8.5 Claude

- Uses the `claude` CLI already logged in on his Mac. Tack runs it as a child
  process, sends the note and his instruction, and streams the answer.
- Ask Claude panel: a text input plus quick buttons (Rewrite, Check, Summarize,
  Action items, Make it a how-to). Result shows as a diff over the note. Accept,
  reject, or ask again.
- Before any agent change is written, Tack saves a snapshot of the old file in
  a local history folder (outside iCloud). Every note has "History" to restore
  a version.
- If the CLI is missing or not logged in, Claude features show a clear message.
  The rest of the app works without Claude.

### 8.6 Weekly agent

- Runs once a week (default Friday 16:00) through a macOS `launchd` job, so it
  runs even when Tack is closed. Can also run from the palette.
- A small headless helper (part of the Tack build, runnable without the UI)
  does the run:
  1. Copies the whole vault to a backup folder outside iCloud.
  2. Runs `claude -p` inside the vault with `CLAUDE.md` as its rules and a fixed
     list of allowed tools (read, write, move files in the vault only; no shell,
     no network tools beyond Claude itself).
  3. Compares the vault with the backup and writes a change manifest.
- The agent's job: move Inbox notes to the right folder, add frontmatter
  tags/people/project, add links, create missing People/Project notes, write
  `Weekly/YYYY-Www.md` with highlights, open action items and decisions.
- The agent applies changes directly (no approval step). The weekly note lists
  every change from the manifest. Tack offers one-click "undo all" (restore from
  the backup) and undo per file. Keep the last 4 backups.

### 8.7 Search

- `⌘K` / `⌘P`: fuzzy search over titles, body text, tags and people.
- Typos and partial words match. Results show the matching line.
- Filters by typing: `#tag`, `@person`, `in:meetings`.
- Index lives locally outside iCloud and rebuilds from the files.

### 8.8 Agent friendliness

- Plain Markdown + frontmatter + wikilinks only. No hidden app database that
  holds note content.
- `CLAUDE.md` at the vault root explains structure and rules, so Claude Code
  sessions in other projects can read or add notes safely.

### 8.9 Build order

1. **Milestone 1 — daily core:** vault setup in iCloud, main window, editor
   with round-trip tests, quick-capture hotkey, fuzzy search, Harper, pin on
   top. Goal: he can use it every day after this milestone.
2. **Milestone 2 — Claude:** Ask Claude panel with diff, snapshots and history.
3. **Milestone 3 — meetings:** two-source recording, live transcript, summary
   and action items.
4. **Milestone 4 — weekly agent:** headless helper, launchd job, manifest and
   undo.

## 9. Left to the builder

- TipTap vs Milkdown (decide with the round-trip spike).
- Search engine (for example tantivy in Rust, or an in-memory JS index) as long
  as it meets the fuzzy and speed goals.
- How to capture system audio (Core Audio process taps or ScreenCaptureKit) and
  which permission prompts that needs.
- Whisper model default, chunk size, and how live text is corrected when the
  final pass differs.
- Visual design details, after mockups are approved by Ahmed.
- Handling of iCloud placeholder files (not yet downloaded) and sync conflicts.

## 10. Known risks

- Markdown round-trip fidelity of rich editors. Mitigated by the hard rule and
  test suite in 8.3.
- iCloud sync delays and conflicts when Obsidian iOS edits the same file.
- Running `claude -p` from a GUI app or launchd: login and PATH must be found
  correctly.
- System audio capture needs a macOS permission prompt; it must survive
  rebuilds (see signing decision).
