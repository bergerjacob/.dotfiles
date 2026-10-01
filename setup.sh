#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE=""
MINIMAL=false
LINK_ONLY=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: ./setup.sh <laptop|pc> [--link-only] [--dry-run]
       ./setup.sh minimal-dev

The laptop and pc modes install Debian packages, deploy system files, enable
services, install the pinned font, and link the selected profile. Use
--link-only to skip the privileged package and system configuration.
--dry-run implies --link-only and prints the link commands without running
them.

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
    --dry-run) DRY_RUN=true; LINK_ONLY=true ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$PROFILE" ] || { usage >&2; exit 2; }

# ─── Manifests and system files ───

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

# ─── Fonts ───

# Runs in a subshell so its EXIT trap cleans up the downloaded archive on any
# failure without interfering with the rest of setup.
install_fonts() (
  local version="3.4.0"
  local family="Hack Nerd Font Mono"
  local font_dir="$HOME/.local/share/fonts/HackNerdFont"
  local url="https://github.com/ryanoasis/nerd-fonts/releases/download/v${version}/Hack.tar.xz"
  local archive

  if [ "$(fc-match -f '%{family}' "$family")" = "$family" ]; then
    printf '[fonts] %s is already installed\n' "$family"
    exit 0
  fi

  archive="$(mktemp --suffix=.tar.xz)"
  trap 'rm -f "$archive"' EXIT

  printf '[fonts] downloading Hack Nerd Font %s\n' "$version"
  curl --fail --location --retry 3 --output "$archive" "$url"

  mkdir -p "$font_dir"
  tar -xJf "$archive" -C "$font_dir" --wildcards '*.ttf'
  fc-cache -f "$font_dir"

  fc-match "$family"
)

# ─── Symlink helpers ───

link_log() {
  printf '[symlinks] %s\n' "$*"
}

link_run() {
  if [ "$DRY_RUN" = true ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

backup_path() {
  local path="$1"
  local backup="${path}.pre-dotfiles"
  local number=1

  while [ -e "$backup" ] || [ -L "$backup" ]; do
    backup="${path}.pre-dotfiles.${number}"
    number=$((number + 1))
  done

  link_log "moving existing $path to $backup"
  link_run mv -- "$path" "$backup"
}

link_path() {
  local source="$1"
  local destination="$2"

  if [ -L "$destination" ] && [ "$(readlink -f "$destination" 2>/dev/null || true)" = "$(readlink -f "$source")" ]; then
    return
  fi

  link_run mkdir -p -- "$(dirname "$destination")"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    backup_path "$destination"
  fi
  link_run ln -s -- "$source" "$destination"
  link_log "$destination -> $source"
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
          link_log "removing link from the other machine profile: $link"
          link_run rm -- "$link"
        fi
        ;;
      "$DOTFILES_DIR/"*)
        if [ ! -e "$link" ]; then
          link_log "removing stale dotfiles link: $link"
          link_run rm -- "$link"
        fi
        ;;
    esac
  done < <(find "${roots[@]}" -type l -print0 2>/dev/null)
}

setup_links() {
  link_log "installing shared configuration with the '$PROFILE' profile"

  cleanup_stale_profile_links

  # Bash is retired as the interactive shell on every profile; drop the old
  # managed ~/.bashrc link if a previous setup left one behind.
  if [ -L "$HOME/.bashrc" ]; then
    case "$(readlink "$HOME/.bashrc")" in
      "$DOTFILES_DIR"/*)
        link_log "removing retired link: $HOME/.bashrc"
        link_run rm -- "$HOME/.bashrc"
        ;;
    esac
  fi

  link_path "$DOTFILES_DIR/zshrc" "$HOME/.zshrc"
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

  # Keep Pi credentials, sessions, and installed package data machine-local
  # while sharing only the declarative configuration and user-authored
  # resources.
  local pi_entry
  for pi_entry in AGENTS.md agents extensions keybindings.json models.json prompts sandbox.json settings.json skills themes; do
    link_path "$DOTFILES_DIR/pi/agent/$pi_entry" "$HOME/.pi/agent/$pi_entry"
  done
  # DCP runtime state and statistics remain machine-local.
  link_path "$DOTFILES_DIR/pi/agent/pi-dcp.json" "$HOME/.pi-dcp/config.json"

  link_path "$DOTFILES_DIR/sway/config" "$HOME/.config/sway/config"
  link_path "$DOTFILES_DIR/waybar/config" "$HOME/.config/waybar/config"
  link_path "$DOTFILES_DIR/waybar/style.css" "$HOME/.config/waybar/style.css"

  local desktop_file
  for desktop_file in "$DOTFILES_DIR"/chrome/*.desktop; do
    link_path "$desktop_file" "$HOME/.local/share/applications/$(basename "$desktop_file")"
  done

  # Shared executables land in ~/.local/bin for every machine profile.
  # (The shim files detect their own devices/capabilities, so one copy serves
  # laptop and PC.) A profile tree may still override a shared name — it is
  # linked afterwards and wins.
  link_tree "$DOTFILES_DIR/bin" "$HOME/.local/bin"

  # Profile trees mirror their destinations, so adding a future
  # machine-specific config or executable does not require changing this
  # script.
  link_tree "$DOTFILES_DIR/$PROFILE/config" "$HOME/.config"
  link_tree "$DOTFILES_DIR/$PROFILE/bin" "$HOME/.local/bin"

  link_log "profile '$PROFILE' is linked"
}

# ─── minimal-dev mode (copy, never link or sudo) ───

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

# ─── Main flow ───

if [ "$MINIMAL" = true ]; then
  [ "$LINK_ONLY" = false ] || { printf 'minimal-dev mode does not use --link-only or --dry-run\n' >&2; exit 2; }
  setup_minimal
  exit 0
fi

[ -d "$DOTFILES_DIR/$PROFILE" ] || { printf 'Missing profile: %s\n' "$PROFILE" >&2; exit 1; }

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

  # zsh is the interactive shell on every profile; make it the login shell
  # once the package is known to be installed.
  if [ "$(getent passwd "$(id -un)" | cut -d: -f7)" != "$(command -v zsh)" ]; then
    printf '[setup] setting login shell to zsh\n'
    sudo usermod -s "$(command -v zsh)" "$(id -un)"
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

  install_fonts
fi

setup_links

if systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  while IFS= read -r service; do
    printf '[setup] enabling user service %s\n' "$service"
    systemctl --user enable --now "$service"
  done < <(read_manifest "$DOTFILES_DIR/$PROFILE/user-services")
fi

printf '[setup] complete; launch the session with start-sway\n'
