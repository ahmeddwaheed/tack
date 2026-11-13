#!/usr/bin/env bash
set -euo pipefail

IDENTITY="Tack Local Signing"
APP_DEST="/Applications/Tack.app"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
fi

if ! security find-identity -p codesigning | grep -q "$IDENTITY"; then
  echo "Missing code signing certificate \"$IDENTITY\" in the keychain." >&2
  echo "Create it once: Keychain Access > Certificate Assistant > Create a Certificate." >&2
  echo "Name: $IDENTITY, Identity Type: Self Signed Root, Certificate Type: Code Signing." >&2
  echo "See README.md for details." >&2
  exit 1
fi

cd "$ROOT"
pnpm tauri build --bundles app

BUILT_APP="$ROOT/src-tauri/target/release/bundle/macos/Tack.app"
if [ ! -d "$BUILT_APP" ]; then
  echo "Build finished but $BUILT_APP was not found." >&2
  exit 1
fi

osascript -e 'quit app "Tack"' >/dev/null 2>&1 || true
for _ in $(seq 1 100); do
  pgrep -x tack >/dev/null 2>&1 || pgrep -xi Tack >/dev/null 2>&1 || break
  sleep 0.1
done
if pgrep -xi tack >/dev/null 2>&1; then
  echo "Tack is still running after 10 seconds. Quit it and run again." >&2
  exit 1
fi

rm -rf "$APP_DEST"
ditto "$BUILT_APP" "$APP_DEST"
open "$APP_DEST"

codesign -dv "$APP_DEST" 2>&1 | grep -E "^(Identifier|Authority|TeamIdentifier|Signature)" || true
