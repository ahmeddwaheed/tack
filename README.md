# Tack

A small macOS app for Markdown notes. Tack edits the notes of an Obsidian vault named "Tack" in iCloud, so the same notes are on the iPhone through Obsidian.

## Features

![Main window](docs/screenshots/main-light.png)
Folders on the left, notes in the middle, the editor on the right.

![Main window in dark mode](docs/screenshots/main-dark.png)
Tack follows the macOS dark mode.

![Search](docs/screenshots/search.png)
Press `⌘K` to search all notes. Typos are fine, and you see the line that matched.

![Link picker](docs/screenshots/link-picker.png)
Type `[[` to link to another note.

![Grammar check](docs/screenshots/grammar.png)
Grammar mistakes get a wavy line. Click one to see a fix.

![Quick capture](docs/screenshots/quick-capture.png)
Press `⌥Space` in any app to write a quick note. `Esc` saves it to the Inbox.

![Conflict](docs/screenshots/conflict.png)
If a note changed on another device while you typed, you choose which version to keep.

Screenshots are generated with `pnpm screenshots`.

## Development

```sh
pnpm install
pnpm tauri dev
```

Tests: `pnpm test` and `cargo test --manifest-path src-tauri/Cargo.toml`.

## One-time setup: signing certificate

A stable certificate keeps the macOS microphone and hotkey permissions after every rebuild. Create it once:

1. Open Keychain Access.
2. Menu: Keychain Access > Certificate Assistant > Create a Certificate.
3. Name: `Tack Local Signing`. Identity Type: "Self Signed Root". Certificate Type: "Code Signing".
4. Create it in the login keychain.

Check that it exists:

```sh
security find-identity -p codesigning | grep "Tack Local Signing"
```

## Install

```sh
scripts/install.sh
```

The script builds a signed app, quits a running Tack, copies it to `/Applications/Tack.app` and opens it. It stops early with a message if the certificate is missing.

## First run

1. Open Tack. It asks for the vault folder.
2. Pick the iCloud folder `Tack` (the default is `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Tack/`).
3. Tack creates the missing folders and `CLAUDE.md`. Then press `⌥Space` to capture a note.
