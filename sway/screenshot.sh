#!/usr/bin/env bash
set -euo pipefail

geometry="$(slurp)" || exit 0
directory="${XDG_PICTURES_DIR:-$HOME/Pictures}"
path="$directory/screenshot-$(date +%Y%m%d-%H%M%S).png"
mkdir -p "$directory"
grim -g "$geometry" - | tee "$path" | wl-copy --type image/png
notify-send "Screenshot saved" "$path"
