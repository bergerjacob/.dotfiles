# Device Profiles

The repository has one shared configuration and two explicit machine profiles:

```
.
├── laptop/
│   ├── bin/       # AMD Sway launcher and Chrome wrapper
│   ├── config/    # laptop Sway and battery status configuration
│   └── system/    # ThinkPad keyd mapping
├── pc/
│   ├── bin/       # NVIDIA launchers and desktop camera tools
│   ├── config/    # desktop Sway, status, and OpenRGB configuration
│   └── system/    # NVIDIA and webcam system configuration
├── sway/          # behavior shared by both Sway sessions
└── ...            # shared shell, terminal, editor, and application config
```

There is no hostname detection and no runtime profile logic. Select exactly one
profile when setting up a machine:

```bash
./setup.sh laptop
./setup.sh pc
```

`setup.sh` installs the package manifests, copies the shared and selected
profile's `system/` trees into `/`, enables their service manifests, and then
runs the linker. It also installs the pinned Hack Nerd Font into the user's
local font directory when needed. To update links without packages, downloads,
or privileged changes:

```bash
./setup.sh laptop --link-only
# or inspect first
./setup-symlinks.sh laptop --dry-run
```

Profile `config/` and `bin/` directories mirror `~/.config` and `~/.local/bin`.
Files placed there are linked automatically. Shared files use the explicit list
in `setup-symlinks.sh`, which keeps their public locations easy to audit.

Sway loads the shared `sway/config` and includes the selected profile as
`~/.config/sway/machine.conf`. The profile include defines output names, modes,
scaling, hardware input settings, and hardware-only bindings. `i3status` is a
full per-profile file because the laptop needs wireless and battery modules.
Shells similarly source the selected `~/.config/dotfiles/shell-profile.sh`, so
the PC retains its NVIDIA environment without exposing it to the AMD laptop.

The ThinkPad Copilot-key workaround is maintained at
`laptop/system/etc/keyd/default.conf`. It remaps the hardware chord below Sway,
so it works natively on Wayland and does not need an XKB startup script.

## Adding Another Machine

1. Add a sibling of `laptop/` and `pc/` with any needed `config/`, `bin/`, and
   `system/` files.
2. Add its name to the accepted profile case in `setup.sh` and
   `setup-symlinks.sh`.
3. Add optional `packages`, `services`, `restart-services`, `root-setup`, and
   `user-services` manifests.

Keep files shared unless the hardware or desired behavior actually differs.
