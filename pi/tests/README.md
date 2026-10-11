# Neovim prompt regression checks

```sh
node --test pi/tests/nvim-prompt*.test.ts
```

Requires Node 24 and a globally installed Pi. Integration checks additionally
require `@bizmyth/pi-neovim-editor` in Pi's user npm packages and Neovim 0.10+;
they skip if the package is absent. Override its location with
`PI_NVIM_EDITOR_DIR=/path/to/pi-neovim-editor`.

Tests exercise the installed editor through the companion factory, with clean
embedded Neovim children that are disposed after each test. They cover slash
commands, clipboard key routing/insertion, bracketed paste, fragmented terminal
input, wrapping with gutters/indentation, Unicode, tabs, resizing and the height
cap. Clipboard unit tests check binary preservation, text fallback and errors.
The normal integration suite simulates the Pi clipboard callback. To test the
actual current image clipboard through the companion in insert and normal mode:

```sh
PI_TEST_LIVE_CLIPBOARD=1 node --test pi/tests/nvim-prompt*.test.ts
```

Copy an image first. This reads the clipboard without changing it and removes
only the screenshot files it creates. Linux image paste prefers a current-user
Wayland socket even if tmux/SSH lost `WAYLAND_DISPLAY`, falling back to X11 when
no Wayland session exists. Paste errors are displayed rather than swallowed.
The embedded Neovim child also discovers its Wayland display before loading
its config, so native registers select `wl-copy` rather than stale SSH `xclip`.
This does not change the parent environment or ordinary standalone Neovim.
Ctrl+Shift+V is accepted if the terminal forwards it; Ctrl+V is recommended
because terminals commonly consume Ctrl+Shift+V themselves.

The companion currently adapts private routing/RPC surfaces of editor 0.1.0.
The height shim recognizes only its prompt-state Lua; unrelated RPCs are left
alone. Re-run these checks after package updates. No installed package files are
modified by the companion or these tests.
