# Pi regression checks

Run all checks with Node 24 and the installed Pi/packages:

```sh
node --test pi/tests/*.test.ts
```

Reliability tests cover exact multiline tmux execution, exit codes, ownership,
layout, concurrent launches, runtime workflow model routing/disabled agents,
all-failed fanout, secret-redaction false positives, structured results, private
browser sockets/deadlines, Wayland environment repair and compaction telemetry.
Workflow tests use the installed pi-subagents 0.52.0 validator/VM with fake
launches: no model requests. Tmux tests use a disposable private server, clean it
up in finally, and never touch the user's real sessions. Browser wrapper tests
use a fake CLI, not personal profiles or a real daemon. An installed-Pi print-mode
regression uses a synthetic provider error and makes no network call.

With TypeScript (`tsc`) on PATH, also run `node pi/tests/typecheck.mjs` for a
strict check of the changed reliability extensions against installed Pi types.
It creates only a temporary config and never installs or patches dependencies.

See `../README.md` for operational defaults and unresolved upstream issues.

`dcp.test.ts` covers a huge single-user loop, small-model scaling, crossing
parallel/pending batches, huge results, image/thinking/argument accounting,
shared range/message/sweep/replay eligibility and atomic refusal, >64 request
nudges, repeat fresh-original purge with stable stats, frozen inputs/provider
pairing, in-place summary-once projection, range clipping over pinned calls,
no-eligibility/manual/denied silence above soft pressure thresholds, continue-work
reminder wording, pinned skill preservation and fork-skill discovery,
claude-bridge rebuild notification, branch/restart/fork/suspension replay and legacy
migration. Its integration smoke loads the local extension with Pi's jiti and
host typebox mapping, checks single registration, runs hooks/tool persistence and
commands without model/network calls. `dcp-live-e2e.sh` is separate and opt-in: a real Pi process with real model requests (see `../README.md`). Strict typecheck includes the entry/core
and their vendored imports. Normal tests do not touch the clipboard.

`dcp-sdk.test.ts` drives the real SDK/extension runner/tool scheduler with a
scripted in-process provider and isolated auth/settings. It checks actual outgoing
payload shrinkage, summary visibility, canonical original preservation and the
rendered stock footer's cache-aware percentage after compression, decompression
and recompression. Error/all-zero usage cannot clear the pending display.

`sandbox-network.test.ts` uses an authenticated local HTTP/CONNECT proxy, a
private trusted test CA and fake proxy-resolved hostnames. Ordinary curl, Node
HTTP/HTTPS/fetch/SSE and Python urllib must work; denied hosts must fail. It tests
startup/toggle Node inheritance, redacted health output, the actual registered
Codex adapter's offline option delegation and preserved native OAuth/catalog.
The real Codex SSE implementation also sends a synthetic authenticated request
through the fixture proxy and consumes a mocked completed-response event.
Native WebSocket proxy support is diagnostic, not required: sandbox automatic
Codex transport selects the tested SSE path. No public service, real credential
or model request is used. A proxy-off fake-host failure tests proxy DNS dependency,
not direct-IP egress denial or namespace enforcement. Needs `openssl`, `curl` and
`python3`; run the full suite on the supported Node version.

## Neovim prompt checks

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
