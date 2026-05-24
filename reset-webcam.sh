#!/bin/bash
# Reset Fullhan webcam without physically unplugging
# Usage: ./reset-webcam.sh

DEVICE="/sys/bus/usb/devices/9-1.4"

if [ ! -d "$DEVICE" ]; then
    echo "Camera not found at expected path. Searching..."
    DEVICE=$(grep -rl "1d6c" /sys/bus/usb/devices/*/idVendor 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
    if [ -z "$DEVICE" ]; then
        echo "ERROR: Could not find Fullhan webcam in sysfs"
        exit 1
    fi
fi

echo "Found camera at: $DEVICE"
echo "Resetting USB device..."

echo 0 > "$DEVICE/authorized"
sleep 1
echo 1 > "$DEVICE/authorized"

echo "Done. Camera should reappear in /dev/video* in a few seconds."
echo "Check with: v4l2-ctl --list-devices"
