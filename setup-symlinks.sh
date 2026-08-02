#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE=""
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: ./setup-symlinks.sh <laptop|pc> [--dry-run]

Links shared dotfiles and overlays the selected machine profile. Existing
regular files are moved aside with a .pre-dotfiles suffix before linking.
EOF
}

log() {
  printf '[symlinks] %s\n' "$*"
}

run() {
  if [ "$DRY_RUN" = true ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    laptop|pc)
      [ -z "$PROFILE" ] || { printf 'Only one profile may be selected.\n' >&2; exit 2; }
      PROFILE="$1"
      ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$PROFILE" ] || { usage >&2; exit 2; }
[ -d "$DOTFILES_DIR/$PROFILE" ] || { printf 'Missing profile: %s\n' "$PROFILE" >&2; exit 1; }

backup_path() {
  local path="$1"
  local backup="${path}.pre-dotfiles"
  local number=1

  while [ -e "$backup" ] || [ -L "$backup" ]; do
    backup="${path}.pre-dotfiles.${number}"
    number=$((number + 1))
  done

  log "moving existing $path to $backup"
  run mv -- "$path" "$backup"
}

link_path() {
  local source="$1"
  local destination="$2"

  if [ -L "$destination" ] && [ "$(readlink -f "$destination" 2>/dev/null || true)" = "$(readlink -f "$source")" ]; then
    return
  fi

  run mkdir -p -- "$(dirname "$destination")"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    backup_path "$destination"
  fi
  run ln -s -- "$source" "$destination"
  log "$destination -> $source"
}

link_tree() {
  local source_root="$1"
  local destination_root="$2"
  local source relative

  [ -d "$source_root" ] || return 0
  while IFS= read -r -d '' source; do
    relative="${source#"$source_root"/}"
    link_path "$source" "$destination_root/$relative"
  done < <(find "$source_root" -type f -print0 | sort -z)
}

cleanup_stale_profile_links() {
  local link target
  local -a roots=("$HOME/.config" "$HOME/.local/bin")

  while IFS= read -r -d '' link; do
    target="$(readlink "$link")"
    case "$target" in
      "$DOTFILES_DIR/laptop/"*|"$DOTFILES_DIR/pc/"*)
        if [[ "$target" != "$DOTFILES_DIR/$PROFILE/"* ]]; then
          log "removing link from the other machine profile: $link"
          run rm -- "$link"
        fi
        ;;
      "$DOTFILES_DIR/"*)
        if [ ! -e "$link" ]; then
          log "removing stale dotfiles link: $link"
          run rm -- "$link"
        fi
        ;;
    esac
  done < <(find "${roots[@]}" -type l -print0 2>/dev/null)
}

log "installing shared configuration with the '$PROFILE' profile"

cleanup_stale_profile_links

link_path "$DOTFILES_DIR/zshrc" "$HOME/.zshrc"
link_path "$DOTFILES_DIR/bashrc" "$HOME/.bashrc"
link_path "$DOTFILES_DIR/tmux.conf" "$HOME/.tmux.conf"
link_path "$DOTFILES_DIR/inputrc" "$HOME/.inputrc"
link_path "$DOTFILES_DIR/alacritty.toml" "$HOME/.config/alacritty/alacritty.toml"
link_path "$DOTFILES_DIR/dunst/dunstrc" "$HOME/.config/dunst/dunstrc"
link_path "$DOTFILES_DIR/gammastep/config.ini" "$HOME/.config/gammastep/config.ini"
link_path "$DOTFILES_DIR/gtk-3.0/settings.ini" "$HOME/.config/gtk-3.0/settings.ini"
link_path "$DOTFILES_DIR/gtk-4.0/settings.ini" "$HOME/.config/gtk-4.0/settings.ini"
link_path "$DOTFILES_DIR/mimeapps.list" "$HOME/.config/mimeapps.list"
link_path "$DOTFILES_DIR/nvim" "$HOME/.config/nvim"
link_path "$DOTFILES_DIR/opencode" "$HOME/.config/opencode"
link_path "$DOTFILES_DIR/sway/config" "$HOME/.config/sway/config"
link_path "$DOTFILES_DIR/waybar/config" "$HOME/.config/waybar/config"
link_path "$DOTFILES_DIR/waybar/style.css" "$HOME/.config/waybar/style.css"

for desktop_file in "$DOTFILES_DIR"/chrome/*.desktop; do
  link_path "$desktop_file" "$HOME/.local/share/applications/$(basename "$desktop_file")"
done

# Profile trees mirror their destinations, so adding a future machine-specific
# config or executable does not require changing this script.
link_tree "$DOTFILES_DIR/$PROFILE/config" "$HOME/.config"
link_tree "$DOTFILES_DIR/$PROFILE/bin" "$HOME/.local/bin"

log "profile '$PROFILE' is linked"
