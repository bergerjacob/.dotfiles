# Camera Fix for Fullhan Webcam + OBS Virtual Camera on Sway/Wayland

## The Problem

Your Fullhan webcam (1d6c:0103) has flaky firmware that conflicts with the OBS Virtual Camera (v4l2loopback) when both are visible to Zoom. This causes:
- Camera not detected until unplug/replug
- OBS virtual camera interfering with the real webcam
- Zoom picking the wrong camera for "Second Camera" screen sharing

## The Solution

These scripts let you **toggle between modes**:
- **Webcam mode**: Fullhan visible, for normal video calls
- **Screenshare mode**: Fullhan hidden, only OBS Virtual Cam visible, for screen sharing

## Files Created

| File | Purpose |
|------|---------|
| `camera-mode` | Main script to toggle camera modes |
| `camera-usb-helper` | Low-level helper (run via sudo) |
| `zoom-screenshare` | Launch Zoom in screenshare mode |
| `zoom-webcam` | Launch Zoom in webcam mode |
| `reset-webcam.sh` | Software USB reset (no unplugging) |
| `setup-camera-sudo.sh` | One-time setup for passwordless camera toggling |

## One-Time Setup

### 1. Enable passwordless camera switching

```bash
sudo bash ~/.dotfiles/setup-camera-sudo.sh
```

This lets you run `camera-mode` without typing your password every time.

### 2. (Optional) Add to your PATH

Add to `~/.bashrc`:
```bash
export PATH="$HOME/.dotfiles:$PATH"
```

Or just use full paths like `~/.dotfiles/camera-mode`.

## Daily Usage

### For Normal Zoom Calls (Webcam)

```bash
camera-mode webcam
# Then open Zoom normally, or:
~/.dotfiles/zoom-webcam
```

### For Screen Sharing via OBS Virtual Camera

**Step 1**: Hide the Fullhan webcam
```bash
camera-mode screenshare
```

**Step 2**: Open OBS, start Virtual Camera

**Step 3**: Open Zoom
```bash
~/.dotfiles/zoom-screenshare
```

This wrapper will:
- Hide the Fullhan before launching Zoom
- Launch Zoom with proper Wayland environment
- **Automatically restore the webcam when Zoom closes**

### Check Current State

```bash
camera-mode status
```

### Quick Toggle

```bash
camera-mode toggle
```

## If Camera Still Acts Up

Software reset (no unplugging):
```bash
sudo ~/.dotfiles/reset-webcam.sh
```

Then run:
```bash
camera-mode webcam
```

## About xdg-desktop-portal Screen Sharing

You tried this and it didn't work. The logs show `xdg-desktop-portal-wlr` crashing with a PipeWire error. This is a known issue that can happen with:
- NVIDIA + wlroots compositors
- PipeWire version mismatches
- Missing DMA-BUF support

The camera-mode + OBS Virtual Camera approach is actually **more reliable** for your setup. If you want to debug portal screen sharing later, try:

```bash
# Check if portal-wlr is running
systemctl --user status xdg-desktop-portal-wlr

# If it crashed, check logs
journalctl --user -u xdg-desktop-portal-wlr -n 50

# A known workaround for some NVIDIA systems:
pipewire &
sleep 1
systemctl --user restart xdg-desktop-portal-wlr
```

But for now, the OBS Virtual Camera workflow with `camera-mode` is your best bet.

## Sway Keybinding (Optional)

Add to `~/.config/sway/config`:

```
# Toggle camera mode with Mod+Shift+C
bindsym $mod+Shift+c exec ~/.dotfiles/camera-mode toggle

# Launch Zoom for screenshare with Mod+Shift+Z
bindsym $mod+Shift+z exec ~/.dotfiles/zoom-screenshare
```

Then reload Sway: `$mod+Shift+c` (your normal reload key).

## How It Works

The Fullhan webcam exposes two video interfaces via the `uvcvideo` driver:
- `/dev/video0` - Main video stream
- `/dev/video1` - Metadata stream

When you run `camera-mode screenshare`, the script **unbinds these interfaces from the uvcvideo driver**. The USB device stays connected, but Linux no longer sees it as a camera. Zoom (and other apps) can only see the OBS Virtual Camera.

When you run `camera-mode webcam`, it **rebinds the interfaces**, making the camera visible again.

This is completely safe and reversible — much safer than unplugging, which can cause USB bus resets that affect other devices.

## Troubleshooting

**Q: `camera-mode` says "Failed to hide Fullhan webcam"**
A: Some other app might be using the camera. Close Zoom, Cheese, OBS, or any browser tabs using the camera, then try again.

**Q: Zoom still shows the Fullhan after `camera-mode screenshare`**
A: Zoom caches the camera list. Close and reopen Zoom after switching modes.

**Q: The virtual camera doesn't appear in Zoom**
A: Make sure OBS Virtual Camera is actually started in OBS. Check with `camera-mode status`.

**Q: I get a sudo password prompt**
A: Run the one-time setup: `sudo bash ~/.dotfiles/setup-camera-sudo.sh`
