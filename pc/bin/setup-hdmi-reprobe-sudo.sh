#!/bin/bash
# setup-hdmi-reprobe-sudo: install the profile's narrowly scoped HDMI reprobe
# sudo rule, so dotfiles-display can repair a stale TV mode list on its own.
#
# The rule allows exactly one root-owned helper and nothing else. It is never
# pointed at a repository file or a user-writable path — the helper is installed
# by setup.sh to /usr/local/libexec/ as root:root.

set -euo pipefail

USER_NAME="${SUDO_USER:-$USER}"
HELPER_PATH="/usr/local/libexec/dotfiles-hdmi-reprobe"

if [ "$EUID" -ne 0 ]; then
    echo "This script must be run with sudo"
    exit 1
fi

if [ ! -x "$HELPER_PATH" ]; then
    echo "$HELPER_PATH is missing; run setup.sh so the system tree is installed first" >&2
    exit 1
fi

RULE_PATH="/etc/sudoers.d/99-hdmi-reprobe"
TEMP_RULE="$(mktemp)"
trap 'rm -f "$TEMP_RULE"' EXIT

cat > "$TEMP_RULE" <<EOF
# Allow passwordless HDMI reprobe for $USER_NAME
$USER_NAME ALL=(root) NOPASSWD: $HELPER_PATH *
EOF

chmod 440 "$TEMP_RULE"
visudo -cf "$TEMP_RULE"
install -o root -g root -m 0440 "$TEMP_RULE" "$RULE_PATH"

echo "Sudoers rule installed successfully."
echo "dotfiles-display can now re-read the TV's EDID without a password prompt."
