# Dotfiles Agent Guide

This repository manages two Debian-based Sway systems:

- `laptop`: AMD ThinkPad using native Wayland applications and a scaled internal display.
- `pc`: NVIDIA desktop using Sway with intentional XWayland compatibility for selected applications.

Keep the repository predictable. Prefer explicit profiles, ordinary files, and small includes over hostname detection, generated configuration, or condition-heavy scripts.

## Repository Layout

Shared configuration stays at the repository root or in an application directory:

- `sway/`: shared Sway behavior and helper scripts.
- `chrome/`: shared desktop entries that call the selected machine's `dotfiles-chrome` wrapper.
- `nvim/`, `opencode/`, `waybar/`, and similar directories: shared application configuration.
- `packages`: packages required on both machines.
- `services`: system services required on both machines.

Machine-specific configuration belongs below `laptop/` or `pc/`:

- `<profile>/config/` mirrors `~/.config/`.
- `<profile>/bin/` mirrors `~/.local/bin/`.
- `<profile>/system/` mirrors `/` and is installed as root-owned files.
- `<profile>/packages` lists profile-only Debian packages.
- `<profile>/services` lists system services to enable with `systemctl enable --now`.
- `<profile>/restart-services` lists services that must restart after system files are deployed.
- `<profile>/user-services` lists user services to enable with `systemctl --user enable --now`.
- `<profile>/root-setup` lists executable profile-relative hooks that run through `sudo` after the system tree is installed.

See `DEVICE_PROFILES.md` for the user-facing overview.

## Shared Versus Profile-Specific Files

Keep a file shared when both machines can use the same behavior without hardware checks. Split only the values or rules that differ materially.

Good profile-specific examples:

- Output names, resolutions, scaling, and input hardware.
- NVIDIA environment variables and `sway --unsupported-gpu`.
- XWayland-only window classes and instances.
- AMD versus NVIDIA Chrome launch flags.
- Laptop key remapping and desktop webcam system configuration.

Do not add hostname checks, GPU detection, or `if laptop ... else pc ...` branches to application configuration. Two small explicit variants are preferable when a native include or wrapper is not convenient.

## Setup And Symlinks

Always select a profile explicitly:

```bash
./setup.sh laptop
./setup.sh pc
```

For link-only updates or inspection:

```bash
./setup.sh laptop --link-only
./setup-symlinks.sh pc --dry-run
```

`setup.sh` installs only missing packages, deploys shared and profile system trees, runs declared hooks, enables services, installs the pinned font, and then calls `setup-symlinks.sh`.

`setup-symlinks.sh` must remain idempotent. It should:

- Replace stale links from the other profile.
- Remove dangling links into old repository paths.
- Move regular files aside with a numbered `.pre-dotfiles` suffix rather than deleting them.
- Link profile `config/` and `bin/` trees generically so new files do not require linker changes.
- Keep the explicit shared-link list easy to audit.

Do not make links into `pc/system/` or `laptop/system/`. Those files must be copied to `/` with root ownership by `setup.sh`.

## Sway Configuration

`sway/config` is shared. It loads two selected profile files:

1. `~/.config/sway/machine.conf` near the beginning for variables, outputs, inputs, commands, and profile-only bindings.
2. `~/.config/sway/machine-rules.conf` near the end for late application and compatibility rules.

Shared Sway code must use variables such as `$primary_output`, `$secondary_output`, and the profile command variables. Do not hardcode `DP-1`, `HDMI-A-1`, or `eDP-1` in shared workspace assignments.

Native Wayland `app_id` rules belong in `sway/config`. XWayland `class`, `instance`, `window_role`, and `window_type` fallbacks belong in the PC machine rules unless both profiles genuinely need them.

Workspace names include icon glyphs. Entries in `sway/reset-workspace.sh` must exactly match the corresponding workspace string in `sway/config`, including the number, colon, and glyph. Add both native and XWayland identities when an application can use either backend.

The old i3 window manager, X startup files, and Xresources are intentionally removed. Do not restore them. `i3status` is retained only as Sway's status command and is not an i3 session dependency.

## PC Compatibility Contract

The PC profile must preserve the NVIDIA/XWayland behavior unless a change is explicitly requested and tested on that machine:

- `pc/bin/start-sway` exports the NVIDIA, DRM, cursor, explicit-sync, VRR, and desktop environment values and launches `sway --unsupported-gpu`.
- `pc/config/dotfiles/shell-profile.sh` preserves the NVIDIA environment in interactive shells.
- `pc/bin/dotfiles-chrome` intentionally uses `--ozone-platform=x11` with NVIDIA VA-API flags.
- PC Chrome, PWA, Discord, Zoom, Cursor, and OpenCode XWayland identities stay in `pc/config/sway/machine-rules.conf`.
- The desktop output modes, Rofi monitor selection, and existing `~/Scripts` commands stay in `pc/config/sway/machine.conf`.
- OpenRGB, webcam, v4l2loopback, udev, and NVIDIA system files remain PC-only.

Do not turn these into shared defaults. A laptop improvement must not alter PC launch flags, outputs, window matching, or NVIDIA packages.

The camera USB helper is installed root-owned at `/usr/local/libexec/dotfiles-camera-usb-helper`. The sudoers rule must allow only that installed helper. Never point a passwordless sudo rule at a user-writable symlink or repository script.

## Laptop Compatibility Contract

The laptop uses native Wayland defaults:

- `laptop/bin/start-sway` launches ordinary Sway without NVIDIA flags.
- `laptop/bin/dotfiles-chrome` uses Wayland and the Radeon VA-API driver.
- Display scaling, touchpad behavior, and launcher binding stay in `laptop/config/sway/machine.conf`.
- The Copilot key remap stays in `laptop/system/etc/keyd/default.conf`; do not reintroduce XKB startup scripts.
- NVIDIA variables, packages, and XWayland Chrome flags must not leak into `laptop/` or shared shell configuration.

## Package And Service Changes

Add packages to the narrowest applicable manifest. Do not place NVIDIA, firmware, camera, or laptop-hardware packages in the shared `packages` file.

System files are source-controlled with their intended installed paths below `system/`. Preserve executable modes because `setup.sh` copies the source mode. Use a root hook only when copying files and reloading services is insufficient.

Avoid unconditional upgrades during setup. Package installation should continue to query installed packages and invoke APT only for missing entries, especially on the NVIDIA PC.

## Required Validation

At minimum, run these checks after relevant changes:

```bash
bash -n setup.sh setup-symlinks.sh install-fonts.sh laptop/bin/* pc/bin/* sway/*.sh
zsh -n zshrc
jq empty opencode/oh-my-opencode-slim.json opencode/opencode.json
git diff --check
```

Validate desktop entries when they change:

```bash
for file in chrome/*.desktop; do desktop-file-validate "$file"; done
```

Validate both Sway profiles. The currently linked profile can be checked directly with `sway --validate`. For the other profile, compose a temporary config by replacing both machine include paths with that profile's repository files, then run the same validator with a headless wlroots backend.

After linker changes, test both profiles with `--dry-run` and simulate stale links when migration behavior is involved. Before finishing, verify that the worktree is clean, no conflict markers remain, and the active machine still links to the intended profile.

## Change Discipline

- Preserve unrelated user changes and incoming remote commits.
- During conflicts, inspect both parents and carry forward behavioral changes instead of selecting an entire side blindly.
- Keep intentional deletions of i3/X11 files; port relevant new behavior into Sway.
- Avoid destructive Git commands and do not force-push unless the user explicitly requests it.
- Keep changes on `main` unless temporary isolation is genuinely needed, and leave the repository with no unresolved merge, stash, or untracked recovery files.
- Update this guide and `DEVICE_PROFILES.md` when the architecture or setup contract changes.
