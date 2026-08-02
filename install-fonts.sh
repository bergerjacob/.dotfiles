#!/usr/bin/env bash
set -euo pipefail

NERD_FONTS_VERSION="3.4.0"
FONT_FAMILY="Hack Nerd Font Mono"
FONT_DIR="$HOME/.local/share/fonts/HackNerdFont"
ARCHIVE_URL="https://github.com/ryanoasis/nerd-fonts/releases/download/v${NERD_FONTS_VERSION}/Hack.tar.xz"

if [ "$(fc-match -f '%{family}' "$FONT_FAMILY")" = "$FONT_FAMILY" ]; then
  printf '[fonts] %s is already installed\n' "$FONT_FAMILY"
  exit 0
fi

archive="$(mktemp --suffix=.tar.xz)"
trap 'rm -f "$archive"' EXIT

printf '[fonts] downloading Hack Nerd Font %s\n' "$NERD_FONTS_VERSION"
curl --fail --location --retry 3 --output "$archive" "$ARCHIVE_URL"

mkdir -p "$FONT_DIR"
tar -xJf "$archive" -C "$FONT_DIR" --wildcards '*.ttf'
fc-cache -f "$FONT_DIR"

fc-match "$FONT_FAMILY"
