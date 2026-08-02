#!/usr/bin/env bash
set -euo pipefail

geometry="$(slurp)" || exit 0
image="$(mktemp --suffix=.png)"
trap 'rm -f "$image"' EXIT
grim -g "$geometry" "$image"
tesseract "$image" stdout 2>/dev/null | wl-copy
notify-send "Text copied from screenshot"
