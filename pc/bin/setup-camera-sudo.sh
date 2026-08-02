#!/bin/bash
# setup-camera-sudo: install the profile's narrowly scoped camera sudo rule.

set -euo pipefail

USER_NAME="${SUDO_USER:-$USER}"
HELPER_PATH="/usr/local/libexec/dotfiles-camera-usb-helper"

if [ "$EUID" -ne 0 ]; then
    echo "This script must be run with sudo"
    exit 1
fi

RULE_PATH="/etc/sudoers.d/99-camera-mode"
TEMP_RULE="$(mktemp)"
trap 'rm -f "$TEMP_RULE"' EXIT

cat > "$TEMP_RULE" <<EOF
# Allow passwordless camera mode switching for $USER_NAME
$USER_NAME ALL=(root) NOPASSWD: $HELPER_PATH
EOF

chmod 440 "$TEMP_RULE"
visudo -cf "$TEMP_RULE"
install -o root -g root -m 0440 "$TEMP_RULE" "$RULE_PATH"

echo "Sudoers rule installed successfully."
echo "You can now run 'camera-mode' without typing your password."
