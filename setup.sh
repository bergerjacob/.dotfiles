#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE=""
LINK_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./setup.sh <laptop|pc> [--link-only]

Installs Debian packages, deploys shared and profile system files, enables
declared services, and links the selected dotfiles. Use --link-only to skip
all privileged package and system configuration.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    laptop|pc)
      [ -z "$PROFILE" ] || { printf 'Only one profile may be selected.\n' >&2; exit 2; }
      PROFILE="$1"
      ;;
    --link-only) LINK_ONLY=true ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$PROFILE" ] || { usage >&2; exit 2; }
[ -d "$DOTFILES_DIR/$PROFILE" ] || { printf 'Missing profile: %s\n' "$PROFILE" >&2; exit 1; }

read_manifest() {
  local manifest="$1"
  [ -f "$manifest" ] || return 0
  sed -E 's/[[:space:]]*#.*$//; /^[[:space:]]*$/d' "$manifest"
}

sync_system_tree() {
  local source_root="$1"
  local source relative mode

  [ -d "$source_root" ] || return 0
  while IFS= read -r -d '' source; do
    relative="${source#"$source_root"/}"
    mode="$(stat -c '%a' "$source")"
    printf '[setup] /%s <- %s\n' "$relative" "$source"
    sudo install -D -m "$mode" -o root -g root "$source" "/$relative"
  done < <(find "$source_root" -type f -print0 | sort -z)
}

if [ "$LINK_ONLY" = false ]; then
  mapfile -t packages < <(
    read_manifest "$DOTFILES_DIR/packages"
    read_manifest "$DOTFILES_DIR/$PROFILE/packages"
  )

  if [ "${#packages[@]}" -gt 0 ]; then
    missing_packages=()
    for package in "${packages[@]}"; do
      if ! dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null | grep -q '^ii '; then
        missing_packages+=("$package")
      fi
    done

    if [ "${#missing_packages[@]}" -gt 0 ]; then
      printf '[setup] installing missing packages: %s\n' "${missing_packages[*]}"
      sudo apt-get update
      sudo apt-get install -y "${missing_packages[@]}"
    else
      printf '[setup] all declared packages are already installed\n'
    fi
  fi

  sync_system_tree "$DOTFILES_DIR/system"
  sync_system_tree "$DOTFILES_DIR/$PROFILE/system"

  while IFS= read -r hook; do
    printf '[setup] running root setup hook %s\n' "$hook"
    sudo "$DOTFILES_DIR/$PROFILE/$hook"
  done < <(read_manifest "$DOTFILES_DIR/$PROFILE/root-setup")

  sudo systemctl daemon-reload
  sudo udevadm control --reload-rules

  while IFS= read -r service; do
    printf '[setup] enabling %s\n' "$service"
    sudo systemctl enable --now "$service"
  done < <(
    read_manifest "$DOTFILES_DIR/services"
    read_manifest "$DOTFILES_DIR/$PROFILE/services"
  )

  while IFS= read -r service; do
    printf '[setup] restarting %s to load deployed configuration\n' "$service"
    sudo systemctl restart "$service"
  done < <(read_manifest "$DOTFILES_DIR/$PROFILE/restart-services")

  if [ ! -d "$HOME/.tmux/plugins/tpm/.git" ]; then
    mkdir -p "$HOME/.tmux/plugins"
    git clone https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
  fi

  "$DOTFILES_DIR/install-fonts.sh"
fi

"$DOTFILES_DIR/setup-symlinks.sh" "$PROFILE"

if systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  while IFS= read -r service; do
    printf '[setup] enabling user service %s\n' "$service"
    systemctl --user enable --now "$service"
  done < <(read_manifest "$DOTFILES_DIR/$PROFILE/user-services")
fi

printf '[setup] complete; launch the session with start-sway\n'
