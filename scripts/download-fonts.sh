#!/usr/bin/env bash
# One-time: downloads the 5 latin woff2 font files used by app/layout.tsx into app/fonts, then commit them.
# Source: Fontsource (open-source fonts, SIL OFL) via jsDelivr. Run from the project root: bash scripts/download-fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p app/fonts
BASE="https://cdn.jsdelivr.net/fontsource/fonts"
get() { # <package> <weight>
  local out="app/fonts/$1-latin-$2-normal.woff2"
  curl -fsSL "$BASE/$1@latest/latin-$2-normal.woff2" -o "$out"
  [ -s "$out" ] || { echo "FAILED: $out" >&2; exit 1; }
  echo "ok  $out"
}
get space-grotesk 600
get inter 400
get inter 500
get jetbrains-mono 400
get jetbrains-mono 500
echo "Done. Now: git add app/fonts && git commit"
