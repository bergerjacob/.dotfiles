#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE=""
MINIMAL=false
LINK_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./setup.sh <laptop|pc> [--link-only]
       ./setup.sh minimal-dev

The laptop and pc modes install Debian packages, deploy system files, enable
services, and link the selected profile. Use --link-only to skip privileged
package and system configuration.

The minimal-dev mode is for a user-writable headless server. It installs no
packages, uses no sudo, and copies only the OpenCode and Pi configuration.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    laptop|pc)
      [ -z "$PROFILE" ] || { printf 'Only one profile may be selected.\n' >&2; exit 2; }
      PROFILE="$1"
      ;;
    minimal-dev)
      [ -z "$PROFILE" ] || { printf 'Only one profile may be selected.\n' >&2; exit 2; }
      PROFILE="$1"
      MINIMAL=true
      ;;
    --link-only) LINK_ONLY=true ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$PROFILE" ] || { usage >&2; exit 2; }

minimal_backup_path() {
  local path="$1"
  local backup="${path}.pre-dotfiles"
  local number=1

  while [ -e "$backup" ] || [ -L "$backup" ]; do
    backup="${path}.pre-dotfiles.${number}"
    number=$((number + 1))
  done

  printf '[setup-minimal-dev] moving existing %s to %s\n' "$path" "$backup"
  mv -- "$path" "$backup"
}

minimal_copy_file() {
  local source="$1"
  local destination="$2"
  local source_real destination_real

  if [ -L "$destination" ]; then
    source_real="$(readlink -f "$source")"
    destination_real="$(readlink -f "$destination" 2>/dev/null || true)"
    if [ "$source_real" = "$destination_real" ]; then
      printf '[setup-minimal-dev] already present %s\n' "$destination"
      return
    fi
    minimal_backup_path "$destination"
  elif [ -e "$destination" ]; then
    if cmp -s "$source" "$destination"; then
      printf '[setup-minimal-dev] already present %s\n' "$destination"
      return
    fi
    minimal_backup_path "$destination"
  fi

  install -D -m "$(stat -c '%a' "$source")" "$source" "$destination"
  printf '[setup-minimal-dev] %s <- %s\n' "$destination" "$source"
}

minimal_copy_tree() {
  local source_root="$1"
  local destination_root="$2"
  local source relative

  [ -d "$source_root" ] || return 0
  if [ -L "$destination_root" ] && [ "$(readlink -f "$destination_root" 2>/dev/null || true)" != "$(readlink -f "$source_root")" ]; then
    minimal_backup_path "$destination_root"
  elif [ -e "$destination_root" ] && [ ! -d "$destination_root" ]; then
    minimal_backup_path "$destination_root"
  fi
  mkdir -p "$destination_root"

  while IFS= read -r -d '' source; do
    relative="${source#"$source_root"/}"
    minimal_copy_file "$source" "$destination_root/$relative"
  done < <(find "$source_root" -type f -print0 | sort -z)
}

setup_minimal() {
  local pi_entry

  printf '[setup-minimal-dev] no packages, sudo, system files, services, fonts, or general symlinks\n'
  minimal_copy_tree "$DOTFILES_DIR/opencode" "$HOME/.config/opencode"

  for pi_entry in AGENTS.md agents extensions keybindings.json models.json prompts sandbox.json settings.json skills themes; do
    if [ -d "$DOTFILES_DIR/pi/agent/$pi_entry" ]; then
      minimal_copy_tree "$DOTFILES_DIR/pi/agent/$pi_entry" "$HOME/.pi/agent/$pi_entry"
    elif [ -f "$DOTFILES_DIR/pi/agent/$pi_entry" ]; then
      minimal_copy_file "$DOTFILES_DIR/pi/agent/$pi_entry" "$HOME/.pi/agent/$pi_entry"
    fi
  done
  minimal_copy_file "$DOTFILES_DIR/pi/agent/pi-dcp.json" "$HOME/.pi-dcp/config.json"

  printf '[setup-minimal-dev] complete\n'
}

if [ "$MINIMAL" = true ]; then
  [ "$LINK_ONLY" = false ] || { printf 'minimal-dev mode does not use --link-only\n' >&2; exit 2; }
  setup_minimal
  exit 0
fi

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
