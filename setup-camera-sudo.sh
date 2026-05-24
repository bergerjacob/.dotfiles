#!/bin/bash
# setup-camera-sudo: Add passwordless sudo for camera management
# Run this once with: sudo bash setup-camera-sudo.sh

USER_NAME="${SUDO_USER:-$USER}"
HELPER_PATH="/home/$USER_NAME/.dotfiles/camera-usb-helper"

if [ "$EUID" -ne 0 ]; then
    echo "This script must be run with sudo"
    exit 1
fi

cat > /etc/sudoers.d/99-camera-mode <<EOF
# Allow passwordless camera mode switching for $USER_NAME
$USER_NAME ALL=(root) NOPASSWD: $HELPER_PATH
EOF

chmod 440 /etc/sudoers.d/99-camera-mode
visudo -c

if [ $? -eq 0 ]; then
    echo "Sudoers rule installed successfully."
    echo "You can now run 'camera-mode' without typing your password."
else
    echo "ERROR: Sudoers file has syntax errors. Not installed."
    rm -f /etc/sudoers.d/99-camera-mode
    exit 1
fi
