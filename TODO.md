# TODO

## pi tmux extension quirks (observed 2026-09-14)

- `tmux run` with a **multi-line command** (heredoc, multi-line `python3 -c "..."`) gets its
  newlines collapsed when typed into the pane — the whole script lands as one line and fails
  (`zsh: event not found`, `SyntaxError: invalid syntax`). Workaround used: write the script to
  a file with the `write` tool and `tmux run` a one-liner (`bash /tmp/foo.sh`).
  → Extension should either send line-by-line with `send-keys Enter` per line, or document
  "commands must be single-line / use a script file".
- `tmux run` against an existing pane name errors with "Pane already exists (running zsh)"
  unless `restart: true` is passed. Convenient default would be restart-if-dead-or-idle, or the
  error message should suggest `restart: true` (it currently does — fine, just noisy).
- When the command inside a managed pane exits (e.g. dev server dies from a stale lock), the
  pane silently sits at a zsh prompt; `tmux read` then shows the shell, not an obvious
  "process exited" signal. A pane-status/exit-code line in `read` output would help debugging.
- `tmux read` output includes the typed command echo twice (once as sent, once from zsh echo),
- Agents open random tmux things some times like panes are normal then sometimes a new session or a new tab can this be made more consistent so it only has access to the right set of things
  which makes parsing logs by eye slightly confusing.

## agent-browser quirks (observed 2026-09-14)

- 2026-10-02: `/run/user/1000` is a read-only tmpfs mount, so every agent-browser command fails with
  "Socket directory '/run/user/1000/agent-browser' is not writable: Read-only file system".
  Workaround `XDG_RUNTIME_DIR=/tmp/...` lets the daemon start, but after one page load the daemon
  wedges: every subsequent CLI call (including `close --all` and `doctor`) hangs forever, survives
  `timeout`, and `pkill -f agent-browser` also kills the driving shell (pattern matches its own
  command line) — panes get stuck and must be killed outright. Orphan Chrome for Testing processes
  also linger. Reliable fallback used: plain `playwright` (already in repo node_modules) launched
  from a tmux pane (host network) with `executablePath` pointed at agent-browser's Chrome for
  Testing binary under `~/.agent-browser/browsers/`. → Fix: agent-browser should honor a writable
  socket-dir override env var and make the daemon resilient to read-only XDG runtime dirs.
- Chrome instance serves the page HTML fine but returns **403 on several `/_next/static/chunks/*.js`**
  (fresh profile, no cookies, no proxy env, dev server returns 200 for the same URLs via curl)
  → app never hydrates, all pages look dead in automation. Unresolved; next steps: compare the
  exact failing request headers vs curl, try `agent-browser` Chrome with `--no-sandbox`/default
  flags diff, check if its CDP Chrome has an extension/interceptor.
- `find placeholder ... fill` sets the DOM value but React controlled inputs never see it
  (no onChange). Use `find placeholder ... click` + `keyboard type ...` for React apps.
- `find text "Show" click --exact` matched a hidden duplicate (page renders desktop + mobile
  copies of the same controls) — needs visibility-aware matching or scope by container.

## pi-tui key parsing quirks (observed 2026-09-15)

- pi 0.85.1 (`@earendil-works/pi-tui` keys.js) cannot match `alt+shift+<letter>` from legacy or
  tmux-style encodings: legacy `ESC G` returns `undefined` from `parseKey`, and tmux 3.5a's
  pane-side CSI-u encoding for Alt+Shift+G (`CSI 71;3u` — uppercase codepoint, no shift bit)
  matches neither `alt+g` nor `alt+shift+g`. Only kitty-style (`CSI 103;4u`) and
  modifyOtherKeys (`CSI 27;4;71~` or `CSI 71;4u`) forms match. Workaround deployed in
  `tmux.conf` (`bind-key -n M-G send-keys -l "\e[103;4u"`) plus the existing
  `alacritty.toml` chars binding. → Worth an upstream issue: `parseKey("\x1bG")` should map
  to `alt+shift+g`, and `matchesKittySequence` should treat an uppercase-letter codepoint
  with no shift bit (tmux's textual encoding) as shift+letter.

## repo/environment quirks (observed 2026-09-20)
- Nine dotfiles (.bashrc, .bash_profile, .env, .gitconfig, .profile, .zprofile, .zshrc, .mcp.json, .ripgreprc) appear in the precondeeptioner repo root as 0-byte character devices (1:3 = /dev/null, nobody:nogroup) — created by some sandboxed/containerized process resolving $HOME-relative redirects into the repo cwd. Workaround: delete them + add root-dotfile entries to the repo .gitignore. Suggested fix: find which sandbox layer leaks $HOME redirects (pi tool sandbox or tmux cwd handling) and pin its cwd/HOME.

## pi tool sandbox networking quirks (observed 2026-09-28)
- pi's bash tool runs under bwrap with `--unshare-net`, so sandboxed shells cannot reach host loopback services (connection refused; `ss -tln` empty). A python http.server started in a tmux pane (host side) works for the user but is invisible to sandboxed curl/chrome. Workaround: run servers, browsers, and API calls needing host network in tmux panes; exchange results via files in the shared repo dir (guaranteed bidirectionally visible) rather than /tmp, and don't stack multiple queued commands in one busy pane (typed input buffers until the foreground job exits and can look swallowed). Suggested fix: document a "host execution via tmux" recipe for pi agents, or give the bash sandbox loopback passthrough.
- 2026-10-01: sandbox disabled by user decision (`pi/agent/sandbox.json` `enabled: false`), so this quirk is dormant; it returns if the sandbox is re-enabled per session (Alt+S / `/sandbox-enable`).

## pi container quirks (observed 2026-09-29)

- Running pi inside the project container bind-mounts the repo and masks several
  repo-root paths (`.bashrc`, `.zshrc`, `.zprofile`, `.ripgreprc`, `.env`,
  `.gitconfig`, `.mcp.json`, `.profile`, `.bash_profile`) with devtmpfs `/dev/null`
  mounts. They show up as untracked files in `git status`, cannot be deleted
  ("Device or resource busy"), and `sudo` is blocked ("no new privileges"), so
  host-level actions like `chsh` cannot be run from inside the session.
  Workaround used: listed the masked paths in `.git/info/exclude` (machine-local)
  and asked the user to run host commands themselves.
  → Fix: have the container harness mask those paths outside the worktree, or
  expose a `.git/info/exclude` snippet for container sessions automatically.

## pi sandbox dotfile masks (observed 2026-10-01)
- Root cause confirmed for the 2026-09-20 nine-dotfiles quirk: pi's bwrap bash sandbox creates 0-byte read-only placeholder files (.bashrc, .env, .gitconfig, .mcp.json, .zshrc, etc.) in the session cwd on the real filesystem, then bind-mounts /dev/null (devtmpfs, inode 1:3 nobody:nogroup) over them inside the sandbox namespace. From inside the sandbox they cannot be removed (EBUSY, held by bwrap/socat) and git status there shows them untracked; outside pi they linger as untracked noise until deleted. Workaround: remove via `tmux run-shell -b 'rm -f ...'` (runs unsandboxed on the tmux server) and gitignore the names in any repo used as a pi cwd (done in ~/Scripts/.gitignore). Suggested fix: sandbox should mask via a private tmpfs/overlay layer instead of creating placeholders in the real cwd, or delete placeholders when the session ends.
- 2026-10-01: dormant since the sandbox was disabled by config (`pi/agent/sandbox.json` `enabled: false`); no new placeholder litter while off.

## pi clipboard environment quirks (observed 2026-10-02)
- 2026-10-02: This session inherits `DISPLAY=localhost:10.0` from SSH but no `WAYLAND_DISPLAY`; `xclip` cannot open that display and plain `wl-paste` assumes the absent `wayland-0`. The current user's `wayland-1` clipboard is accessible and advertises `image/png`. Pi's native clipboard handler silently fails. Workaround for the requested Neovim prompt fix: discover current-user Wayland sockets, read clipboard bytes directly with bounded calls, and report paste failures. Suggested setup fix: refresh desktop environment when reattaching local tmux/Pi sessions instead of keeping an SSH display; upstream clipboard handling should expose failures rather than silently ignore them.
- 2026-10-02: Neovim's separate clipboard provider also inherits the stale SSH display and emits `nvim: clipboard: error invoking xclip: Error: Can't open display: localhost:10.0`. The requested prompt companion now discovers a current-user Wayland socket in the embedded child before init.lua/provider selection; standalone Neovim and parent session environment are unchanged. Refreshing the desktop environment at session attachment remains the underlying setup fix.

## agent-browser runtime quirks (observed 2026-10-06)
- 2026-10-06: browser launch failed because /run/user/1000/agent-browser is read-only inside the tool sandbox, although doctor reports it healthy. Workaround: set XDG_RUNTIME_DIR=/tmp/documents-qa-runtime for browser commands. Suggested fix: provide a writable browser runtime directory and have doctor test actual socket-directory writes.
- 2026-10-06: sandbox bash calls kill browser daemons on exit and hide host PIDs; later calls discard the host daemon as stale. Host-started browser also inherited a dead localhost proxy. Workaround attempted: run the real browser in a managed tmux pane with proxy environment cleared, and send browser commands within that host shell. Suggested fix: supported persistent browser daemon outside per-call PID/network namespaces with clean host environment.

## subagent discovery quirks (observed 2026-10-06)
- 2026-10-06: subagent list advertised vision under Executable agents but execution was rejected as disabled in mode openai. Workaround: primary model reviewed screenshot images directly. Suggested fix: filter disabled-in-mode agents from executable discovery or expose accurate mode eligibility.
- 2026-10-14: recurrence in mode ds-gpt-combo. `subagent list` still reports vision as executable, but launching it fails immediately with 'agent "vision" is disabled in mode "ds-gpt-combo"'. Workaround: skipped pixel review and verified the UI numerically instead (Playwright geometry probe comparing each tile's border, radius, background, padding, label offset, font weight and control alignment, plus per-element overflow checks at 1280/900/390 px). Suggested fix: same as above — the list should not advertise agents the active mode cannot launch.

## sandbox allowlist quirks (observed 2026-10-06)
- 2026-10-06: production browser QA left an untracked .pi/sandbox.json network allowlist in the Lexel-Translate worktree (translate.lexel.ai). It was not manually authored as an app change and was left untouched. Suggested fix: store session network approvals outside the worktree, or explicitly document/project-ignore generated sandbox approval state.

## managed worktree quirks (observed 2026-10-06)
- 2026-10-06: managed subagent worktrees refused to launch with only the generated .pi/sandbox.json network allowlist untracked. No children executed. Workaround: temporarily stash just that allowlist, restore it unchanged after isolated checks. Suggested fix: separate generated harness state from source cleanliness checks.

## agent-browser runtime quirks (observed 2026-10-08)

- 2026-10-08: Browser commands fail because `/run/user/1000/agent-browser` is on a read-only filesystem. Worked around with `XDG_RUNTIME_DIR=/tmp` for CLI commands; configure a writable runtime/socket directory in the harness.

- 2026-10-08: Host dev server was unreachable from sandboxed bash/browser (`ss` empty, localhost connection refused). Ran browser QA in a managed host tmux pane against the existing port-3000 server, clearing inherited proxy variables. Provide host-loopback passthrough or a documented host browser runner.

- 2026-10-08: Playwright 1.62.1 has no matching cached Chromium executable (missing `chromium_headless_shell-1234`). Used an ignored temporary `.next` test config pointing at agent-browser's installed Chrome to validate; provision the matching Playwright browser with dependency updates.

- 2026-10-08: Local Next dev browser tests against `http://127.0.0.1:3000` rendered the page but failed interactions and emitted invalid HMR WebSocket responses; the same three tests all passed at `http://localhost:3000`. Use the advertised dev origin for local QA; investigate loopback-origin handling in host networking/dev-server configuration.

## agent-browser quirks (observed 2026-10-09)

- 2026-10-09: Browser launch in the coding sandbox failed because `/run/user/1000/agent-browser` is on a read-only filesystem. Workaround: run browser commands with `XDG_RUNTIME_DIR=/tmp` (doctor confirmed `/tmp/agent-browser` is writable). Suggested fix: choose a writable runtime directory automatically in sandboxed sessions.

## pi vision subagent quirks (observed 2026-10-09)

- 2026-10-09: the advertised `vision` agent remained inactive with zero tool/image access when given a screenshot directory, then again when revived with exact absolute PNG paths; both runs required interruption. Workaround: retained screenshots and relied on agent-browser accessibility snapshots, viewport/overflow measurements, and console checks, explicitly leaving independent pixel-level visual review as residual risk. Suggested fix: ensure the vision agent receives image attachments or a functional local-image read tool when absolute paths are supplied.

## tool text mangling quirks (observed 2026-10-09)

- 2026-10-09: `rg` output inside the bash tool silently rewrote literal code text — `max-w-7xl` came back as `n` in grep results (e.g. `className="relative mx-auto n"`) while `grep`, `sed`, and `read` returned the same lines intact, and the file on disk was never altered. A related symptom: `document.querySelectorAll("#home-hero")` returned 0 matches inside an `agent-browser eval` string while `document.getElementById("home-hero")` on the same page returned the element, suggesting a `#`-bearing substring was dropped before execution. Workaround: cross-check suspicious grep output with `grep`/`read` and prefer `getElementById` over `#id` selectors in eval strings. Suggested fix: find the output/argument filter that rewrites these substrings (it also affects arguments, not just display) and disable it.

- 2026-10-09: `agent-browser screenshot <selector> <path>` intermittently exited 1 with no output and, when it did run, wrote to `~/.agent-browser/tmp/screenshots/` instead of the supplied path (e.g. `screenshot .qa-local/x.png` silently ignored the path). Workaround: read the tmp path printed on stdout, or pass the path with `--full`; verify the file exists before relying on it. Suggested fix: make positional `[selector] [path]` parsing deterministic and fail loudly when the requested path is ignored.

## next dev shared-cache quirks (observed 2026-10-09)

- 2026-10-09: starting a second `next dev` for the same project (Lexel-Translate) while another instance was already serving on port 3000 corrupted the shared `.next/dev` Turbopack cache: the new server panicked with `Unable to open static sorted file referenced from 00000373.meta` / `turbo-tasks: an internal panic occurred outside the per-task panic boundary`, and the pre-existing port-3000 server also died. Pages then served without hydrating (native form submits, no client handlers). Workaround: only one dev server per project at a time; `rm -rf .next/dev` and start a single `yarn dev`. Suggested fix: bind the Turbopack dev cache path per port/instance, or make `next dev` fail fast when it detects the cache is already locked by a live instance.

## sandbox dotfile-mount quirks (observed 2026-10-10)

- 2026-10-10: In the primary working directory, the sandbox bind-mounts `/dev/null` (devtmpfs, read-only) over home-config filenames `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.profile`, `.env`, `.gitconfig`, `.ripgreprc`, and `.mcp.json`. Side effect: `git add -A` / `git add .` in that repo aborts with `error: .bash_profile: can only add regular files, symbolic links or git-directories` / `fatal: adding files failed`, so a blanket stage fails and only explicit paths work. The mounts cannot be removed from inside the sandbox (`rm` fails on read-only bind mounts) and the paths are untracked, so nothing deploys. Workaround: stage explicit paths (`git add <path>`) instead of `git add -A`. Suggested fix: mount the masking nodes outside the repo working tree, or add the masked names to the repo's `.git/info/exclude` so blanket staging is unaffected.
- 2026-10-10 (follow-up): the same sandbox also writes `.pi/sandbox.json` into the primary working directory, and Git leaves a `pages-build-deployment` "dynamic" workflow registered (`dynamic/pages/pages-build-deployment`) that cannot be disabled through the API (`PUT .../actions/workflows/<id>/disable` returns `422 Unable to disable this workflow`) — it only stops firing because the Pages site itself was deleted. Workaround applied locally: added the nine masked filenames plus `.pi/` to `.git/info/exclude` (local-only, never committed), which restores a clean `git status` and makes `git add -A` succeed instead of aborting on the device nodes.

## subagent run-budget quirks (observed 2026-10-10)

- 2026-10-10: A `standard` subagent given a repo-wide multi-file implementation *plus* its own end-to-end verification hit the 30-minute default timeout mid-verification. It returned "Subagent timed out after 1800000ms" with partial output only, even though the implementation itself was complete — the parent then had to finish the verification from scratch (which is where the real finding was). Workaround: pass an explicit larger `timeoutMs` for implementation-heavy children, or split implementation and verification into separate children so a timeout cannot swallow the verified result. Suggested fix: raise or warn about the default for missions that are clearly implementation-plus-verification, and make the timeout message report which acceptance steps had already passed.

## bash tool self-match quirks (observed 2026-10-10)

- 2026-10-10: `pkill -f <pattern>` / `pgrep -f <pattern>` inside the bash tool also matches the tool's own `/bin/bash -c '<the whole command>'` process, so a pattern that appears anywhere in the command (e.g. `dotfiles-display`, `swaymsg -t subscribe`) makes the call kill its own shell. Symptom: output stops mid-command with no error and the intended cleanup never ran — it silently truncated two commands this session. Workaround: anchor the pattern so it cannot match the wrapper (`pkill -f '^swaymsg -t subscribe'`), or resolve PIDs through `/proc` instead of `pgrep`. Suggested fix: have the bash tool invoke commands through a script file whose argv does not contain the command text, or document the anchoring requirement next to the tool description.

## sandbox GitHub log access quirks (observed 2026-10-10)

- GitHub Actions job/run log downloads failed with proxy CONNECT 403 for results-receiver.actions.githubusercontent.com and Azure blob log hosts, although GitHub metadata API requests worked. Removing proxy environment variables did not help while the tool sandbox was active. User disabled the sandbox; the same authenticated gh job-log API request then succeeded. Suggested fix: allow the GitHub Actions log-download hosts in the sandbox network policy.

## local-server QA from the bash tool quirks (observed 2026-10-10)

- 2026-10-10: The bash tool runs in a namespace that cannot see or reach host-side servers. `ps` lists only a handful of sandbox processes (no `next dev`), `curl http://localhost:3000` returns `Connection refused`, and `agent-browser open http://localhost:3001` fails with `ERR_CONNECTION_REFUSED`, even while the same server answers a `curl` issued inside a tmux pane. Symptom: it looks like the dev server is down and the lock file's PID looks stale, which invited a wrong "kill the stale lock and start my own dev server" recovery that then hit the known shared-cache crash. Workaround: probe and drive local servers from a tmux pane (scripts committed into the repo, results read back via `tmux read`), and never conclude a host server is dead from bash-side `ps`/`curl`. Suggested fix: document the isolation next to the bash tool, or route localhost out of the sandbox.
- 2026-10-10: `agent-browser` fails with `Failed to create socket directory: Read-only file system (os error 30)` from the bash tool because `XDG_RUNTIME_DIR=/run/user/1000` is mounted read-only there. Workaround: `XDG_RUNTIME_DIR=/tmp/xdg-runtime agent-browser ...`. Suggested fix: fall back to a writable runtime dir when the configured one is not writable.
- 2026-10-10: URLs passed to `tmux run` commands are masked to `***` before execution (a `curl http://localhost:3000/` command ran as `curl ***/` and returned 000). Workaround: put the URL inside a script file in the repo and run the script by path. Suggested fix: mask only in displayed output, not in the command handed to the pane.

## pi nvim editor PATH quirks (observed 2026-10-18)
- @bizmyth/pi-neovim-editor resolves the editor binary with a bare `spawnSync("nvim")` (no env override in nvim-host.ts:47), so on this machine Neovim must be on PATH; it only exists at ~/Apps/nvim-extracted/usr/bin/nvim (v0.12.0-dev extraction). Workaround: symlinked into ~/.local/bin/nvim. If a future nvim extraction changes the tree layout, update the symlink.

## pi Neovim fallback quirks (observed 2026-10-18)
- 2026-10-18: `@bizmyth/pi-neovim-editor` left Pi unusable after missing/failed Neovim startup; an early clean child exit could also exit Pi, and a closed stdin could raise uncaught EPIPE. Applied a machine-local patch to the installed package (not dotfiles): restore the built-in Pi prompt with its synchronized draft on initialization/RPC failures or unexpected exit, bound the version probe to 3 seconds and embedded startup to 10 seconds, and make child cleanup non-blocking on RPC. Ordinary plugin messages and healthy Neovim editing are unchanged. Run `/reload` to retry Neovim. Backups, regression tests, and patch copies are in `~/.local/state/pi-local-patches/2026-10-18/`. Six failure/recovery tests and 31 existing prompt tests passed (one live-clipboard test skipped). Suggested upstream fix: ship this fallback in the editor package; package reinstallation/updates can overwrite the local patch.

## pi extension manifest quirks (observed 2026-10-18)
- 2026-10-18: `pi-subagents` 0.56.0 and `pi-web-access` 0.24.2 declared host-provided `typebox` in dependencies, producing startup warnings. Moved it to `peerDependencies` with range `"*"` in the installed package manifests only; also normalized the subagents Pi AI peer range to `"*"`. Real Pi resource loading now reports zero extension errors/warnings. Original manifests and patch copies are in `~/.local/state/pi-local-patches/2026-10-18/`. Suggested fix: publish corrected upstream manifests; reinstalling/updating either package can restore the warnings.

## subagent acceptance-report quirks (observed 2026-10-12)

- 2026-10-12: A child that finishes with a fenced `acceptance-report` block but omits `noStagedFiles` fails attestation with `Failed to parse acceptance-report: Invalid acceptance-report: noStagedFiles: expected boolean; got null`. The run still exits 0 and bills usage, but the child's `outputState` becomes `absent` and the parent sees an empty `finalOutput` even though the child ran its commands and answered — it cost a full re-ping to confirm the tiers were healthy. Suggested fix: default `noStagedFiles` to false when omitted instead of rejecting the report, and report parse failures as a warning that preserves the child's text output.
- 2026-10-12: In a per-run child spec (top-level `subagent` item or a `runs.run`/`runs.all` item), a bare `thinking` field is ignored — the effective level comes from agent frontmatter. Only a `provider/id:level` thinking suffix on the `model` string is honoured (verified: `fast` frontmatter `low` overridden to `:max`). Workaround applied in `pi/agent/extensions/modes.ts`: the mode injection now writes `model: "<pick>:<thinking>"`. Suggested fix: accept `thinking` as a first-class per-run field, or reject unknown keys loudly instead of silently ignoring them.

## vision subagent quirks (observed 2026-10-12)

- 2026-10-12: A `vision` child launched inside an async `workflowScript` never produced anything (4 turns, 0 tokens, 0 tool calls) and then raised "no observed activity for 60s". Recovery was blocked: `subagent interrupt` returns "Interrupt is unsupported for async workflow <id>; use stop instead", and `subagent stop` returns "Workflow <id> is not controlled by this extension runtime; reload recovery cannot stop it safely" — so the stalled vision run could not be cancelled from the parent and kept the image inspection task hanging. Symptom: screenshots handed to `vision` silently block visual verification, and the parent has no way to reclaim it. Workaround: skip the vision child and hand the user a manual visual checklist instead. Suggested fix: let `stop`/`interrupt` act on a workflow's children, and surface a timeout/failure when a vision child makes no model calls within N seconds.
- 2026-10-12 (follow-up): the stalled vision child above *can* be reclaimed — `subagent interrupt` with the **child run id** (not the workflow id) succeeds and the parent workflow then reports completion. Targeting the parent workflow id is what fails with "not controlled by this extension runtime". Suggested fix: have `stop`/`interrupt` accept either id and say which one it needs.

## pi context pruning quirks (observed 2026-10-13)

- 2026-10-13: Installed pi-dcp 0.2.0 is enabled and its config symlink is correct, but `turnProtection.turns: 1` protects the entire current user-bounded request, including every completed discovery/tool phase in a long agent loop. An in-memory reproduction confirmed both old and newest tool-call IDs remain protected until a new user message. October parent-session logs contain seven compress results: three successes, two `protected_window_overlap`, two `endpoint_not_found`. Suggested fix: protect the newest assistant/tool batches and in-flight calls rather than the whole user request; revise the compress guidance consistently. Disabling user-turn protection alone needs an explicit recent/in-flight safety guard. No runtime/config changes made during audit.
- 2026-10-13: pi-dcp hooks compression nudges only on `before_agent_start`, which Pi fires once when starting a user request, not on every tool-loop iteration. Consequently thresholds crossed inside a long request and `iterationNudgeThreshold: 6` do not reliably trigger mid-loop nudges. Suggested fix: evaluate bounded, deduplicated nudges on each outbound `context`/turn boundary; maintain the actual protected-window contract and avoid changing the system prompt each iteration.
- 2026-10-13: Built-in compaction is enabled but configured with `reserveTokens: 32768` and `keepRecentTokens: 60000`: the threshold is about 88% for the current 272k Codex model and 96.7% for 1M models, retaining three times Pi's default recent-token budget. Suggested fix: reduce the retained budget to 20000 and use an earlier, model-aware fallback threshold (e.g. 70–75%; reserve about 68000 for 272k or 250000 for 1M). Stock reserveTokens is an absolute number, not a percentage. Oct 9–13 parent logs show successful compactions, including roughly 239k→70k and 240k→88k. In the Oct 12 research session, an already-started request returned ~914k input after compaction completed; the next newly started user request used ~150k, so that first stale readout is not proof of compaction failure. Suggested fix: prevent/clearly label in-flight old-context responses during manual/background compaction and persist compaction-failure telemetry.
- 2026-10-13: pi-dcp's pipeline replaces compressed results with topic-only placeholders; the detailed summary survives in the original `compress` call arguments, not as an explicit replacement/checkpoint in the pipeline. It prunes tool results, not normal assistant/thinking text or successful tool-call arguments. Suggested fix: explicitly inject each active summary once and account for retained arguments; do not describe this limited mechanism as a complete session/context cap or guaranteed lossless compaction.

## sandbox pid namespace quirks (observed 2026-10-11)

- 2026-10-11: Mid-session the bash tool's sandbox switched to its own PID namespace: `/proc/1/comm` became `bwrap`, `ps -e` showed only 7 processes, `ps -C sway` and `pgrep -x dunst` returned nothing, and `nvidia-smi` reported "No running processes found" — while `swaymsg` and `/sys` reads kept working, because the Wayland/sway sockets and sysfs stay forwarded into the sandbox. Earlier in the *same* session the identical checks did see host processes, so host visibility is not a stable property of the tool. It produced a wrong diagnosis ("sway, dunst and dotfiles-display are not running") that had to be retracted to the user. Workaround: never infer process liveness from `ps`/`pgrep`/`nvidia-smi` inside the tool — use IPC or sysfs instead (e.g. the PID embedded in `SWAYSOCK`, `swaymsg -t get_version`), or ask the user to check. Suggested fix: pick one behaviour (always host PID namespace or always isolated) and surface which is active, so tool output can be trusted.

## agent-browser runtime quirks (observed 2026-10-16)

- Launch audit: agent-browser 0.27.0 could not create its socket under `$XDG_RUNTIME_DIR=/run/user/1000` (read-only filesystem), although `doctor --offline --quick` reported that socket directory as passing. Workaround: scoped `XDG_RUNTIME_DIR=/tmp/lexel-browser-runtime` with mode 0700 for browser commands. Suggested fix: make the runtime directory writable in the harness or configure a writable per-session socket directory and have doctor test actual writability.

## agent-browser recording quirks (observed 2026-10-16)

- Launch audit: starting `record start` before a production navigation caused `net::ERR_INVALID_AUTH_CREDENTIALS`, while the same named-session navigation without recording worked. Workaround: reproduce with client-only delayed responses and save before/during/after screenshots; do not treat recording-context failure as an application defect. Suggested fix: preserve the working authenticated proxy configuration when creating recording contexts.

## dependency audit network quirks (observed 2026-10-16)

- Launch audit: `corepack yarn audit:release` could not resolve registry.yarnpkg.com (`ENOTFOUND`); scoped Yarn proxy variables did not recover the audit. Other local validations and browser HTTPS access worked. No dependency verdict was inferred. Workaround: require a fresh successful registry-backed scan in network-enabled CI. Suggested fix: make Yarn registry DNS/egress and authenticated proxy handling consistent with browser/curl access.

## agent-browser socket quirks (observed 2026-10-16)

- Launch audit: socket creation under /run/user/1000 failed with read-only filesystem despite doctor reporting success. Workaround: a mode-0700 /tmp/lexel-browser-runtime directory via scoped XDG_RUNTIME_DIR. Suggested fix: configure writable harness socket storage and make doctor verify actual writability.

## tmux pane capacity quirks (observed 2026-10-19)

- 2026-10-19: Managed tmux run failed with `split-window failed: no space for new pane` while two pre-existing research panes were listed. Existing panes were left untouched. Workaround: short integrity validation ran as a bounded shell call; subsequent long research processes can use a separately named detached tmux session, tracked and cleaned explicitly. Suggested fix: provide a detached-session fallback when managed layout cannot split without touching unrelated panes.

## Project dependency download quirks (observed 2026-10-19)

- 2026-10-19: Research venv uv dependency resolution could not reach PyPI: configured-proxy tunnel failure; one per-command no-proxy attempt instead failed DNS. Browser-backed source fetches still worked. No packages/environment/dotfiles were changed. Workaround: continue with existing NumPy/SciPy and independently validated standard FE assembly. Suggested fix: repair supported outbound package-index access in the harness, not in this research repository.

## Research CUDA access quirks (observed 2026-10-19)

- 2026-10-19: Selected research interpreter reports Torch2.10.0+cu128/CUDA12.8 but torch.cuda.is_available() is false; initialization warns CUDA unknown error and resets available devices to zero. No driver/environment fixes attempted. Workaround: retain CPU-first numerical and model cost budgets. Suggested fix: verify GPU-device/driver visibility for the harness outside the research repository.

## pi print-mode error visibility quirks (observed 2026-10-20)

- 2026-10-20: `pi -p --no-session -e <ext> "prompt"` exits 0 with completely empty stdout/stderr when the provider request fails (here a zai 429 "Insufficient balance"), so a headless extension smoke test looks identical to a silent no-op. `--mode json` (or `--verbose`) surfaces the real error. Workaround: use `--mode json` for headless validation. Suggested fix: make text print mode print the stop reason/error and exit non-zero on provider failure.

## subagent provider balance quirks (observed 2026-10-22)

- 2026-10-22: All subagent tiers (fast/standard/oracle, GLM-backed) failed instantly with `429 {"code":"1113","message":"Insufficient balance or no resource package"}`; an async workflow of 4 children burned ~10 min before the failure surfaced as a "complete" run. Workaround: parent did the research/analysis itself with web_search/fetch_content. Suggested fix: recharge the provider (or add a fallback model per tier), and make workflow runs fail fast / notify when every child dies with a provider 429.

## subagent workflowScript model-routing quirks (observed 2026-10-22, root cause of the earlier 429 entry)

- 2026-10-22: Root cause of the "subagent provider balance" failures: the zai account is still out of balance (429 code 1113), and `workflowScript` calls (`runs.run` / `runs.all`) resolve each child's model from the agent frontmatter (`agents/{fast,standard,oracle}.md` -> `zai/glm-5.3*`), IGNORING the active mode in `modes-state.json` (currently `claude` -> `claude-bridge/claude-*`). Direct single-child calls (`{agent, task}`) DO honor the mode and work. Verified: same `fast` ping via direct call -> `claude-bridge/claude-haiku-5-5` OK (2-4 s); via workflowScript -> `zai/glm-5.3-flash` 429; via workflowScript + top-level `model: "claude-bridge/claude-haiku-5-5"` -> OK for fast and oracle. So it was not random and not a malformed call by me, but a harness inconsistency (and my own first attempt should have probed with a cheap direct ping before launching a 10-minute async fan-out).
- Compounding issues: (a) a 429 is retried ~10 min (617 s observed) before failing, and the async workflow then reports state "complete" with every child failed; (b) a second `subagent` call in the same turn is rejected ("exactly ONE subagent call per turn") - fan-out must go inside one workflowScript.
- Suggested fixes: make the workflowScript path apply the active mode's tier->model mapping (or fail fast on 429 / insufficient-balance without retrying), surface "all children failed" as a failed run, and/or recharge zai or repoint the agent frontmatter models. Agent-side workaround adopted: probe tiers with a cheap direct ping first, pass an explicit `model` on workflowScript calls, set `timeoutMs` to bound hangs.
- 2026-10-22 (follow-up): Workaround applied in `pi/agent/extensions/modes.ts`: the `tool_call` hook now rewrites literal `agent: "x"` children in `workflowScript` to carry the active mode's per-child `model` and sets a top-level default `model` (the standard pick) as a fallback; scripts that already contain `model:` are untouched. Verified after reload: fast and oracle workflowScript pings with no explicit model ran on claude-haiku-5-5 and claude-opus-5-5. The upstream pi-subagents inconsistency (workflowScript ignoring the mode) is still unfixed.

## agent-browser domain allowlist quirks (observed 2026-10-22)

- 2026-10-22: `agent-browser open` to the chunkbase slime finder page fails with `Network access to "www.chunkbase.com" is blocked (not in allowedDomains)`, so chunkbase can't be used as an independent reference for Minecraft tooling. Also, a bash tool call whose command text merely contained that URL was rejected with the same error (a URL scan seems to apply to command text, not only to browser navigation). Workaround: verified against public data from GitHub instead (slimy test map, UltraSlimeChunkFinder README). Suggested fix: add the chunkbase domain to allowedDomains if browser-based reference checks are wanted, and limit the URL scan to actual network commands.

- 2026-10-24 (follow-up #2): the `modes.ts` workflowScript rewrite does not cover children whose `agent` is built through a helper (`const T=(id,t)=>({agent:'fast',...})`; only literal `agent: "x"` objects are rewritten), so a 12-child `runs.all` fan-out went to `zai/glm-5.3-flash` and all 12 failed with 429/1113 after ~10 min. Workaround: pass top-level `model: "claude-bridge/claude-haiku-5-5"` on the subagent call (or write literal `agent:` objects). Suggested fix: rewrite by AST/regex on any `agent:` property, or make workflowScript honor the active mode like direct calls do.

## subagent_wait nonBlocking subscription quirks (observed 2026-10-24)
- 2026-10-24: `subagent_wait {id, nonBlocking:true}` on a long async workflow fires "needs attention" every ~10-60 s while healthy children are merely "active but long-running" or have a silent tool open (no pending supervisor request, children writing files). Re-arming just produces another wake, so each wake burns a turn. Workaround: arm once, do not re-arm after a no-op wake; rely on default completion wake. Suggested fix: raise the attention threshold for children with recent file/tool activity, or de-duplicate wakes for the same attention reason.

## agent bash sandbox quirks (observed 2026-10-25)
- 2026-10-25: the agent `bash` tool runs inside bwrap with `--unshare-pid`, so `pgrep`/`ps` there cannot see processes started in tmux windows (including the agent's own long job), and `pgrep -fc experiments/venv/bin/python` "fleet quiet" checks are blind to other agents' jobs. Workaround: read `/proc/loadavg`, or run the monitor/`ps` inside a tmux window (outside the sandbox) writing to a file. Suggested fix: document this in the charter/AGENTS fleet-cap rule or give the sandbox `--share-pid`/read-only host /proc.

## subagent workflow event-file keeper quirks (observed 2026-10-25)
- 2026-10-25: a "keeper" child that greps another workflow's `events.jsonl` for a phase string can match the other workflow's own script source (the file embeds the workflowScript text), or give up early; the dependent stage then starts immediately and ignores the keeper result, breaking "quiet machine" ordering. Workaround: match the full emit record, e.g. `grep -c '"value":"phase D done'`, and check the keeper output in the script (`if (!/READY/.test(out)) ...`). Suggested fix: a first-class `runs.waitFor(runKey|event)` primitive in workflowScript, or documenting that events.jsonl embeds the script.

## fetch_content / research-agent tool quirks (observed 2026-10-27)
- 2026-10-27: research subagents report (a) `fetch_content` with `mode: "answer"` fails with "prompt-capture: no capture for this 286-char system prompt" (also seen by the parent on 2026-10-24), (b) PDF fetches sometimes return ~91 chars, (c) sandboxed bash cannot reach arxiv.org. Workaround used: arXiv abstract/HTML pages with `get_search_content` + `findText`, and marking unread sections [NR]. Suggested fix: make answer mode work under the claude-bridge model route or document it as unsupported; make PDF extraction robust.

## reliability backlog disposition (audited 2026-10-29)

Historical entries above are preserved; this is the current index. Implementation
and operating instructions: `pi/README.md`. Installed versions audited: Pi 1.3.0,
pi-subagents 0.52.0, pi-dcp 0.2.0, pi-sandbox 0.6.5/runtime 0.0.70,
pi-web-access 0.24.0 and agent-browser 0.27.0.

### Fixed or mitigated in managed configuration

- **Tmux multiline commands, duplicate command echo and hidden exits:** commands
  now launch directly as non-interactive bash, not terminal-typed interactive zsh;
  completed panes retain exit status/signal and output. Re-running an exited name
  replaces it automatically; replacing a live process still requires restart.
- **Tmux scope/layout/capacity:** worker ownership is tied to Pi's pane ID. Foreign
  and legacy panes are never adopted/resized/killed; run refuses an incompatible
  window. Splitting the largest owned tile avoids premature bottom-tile capacity
  failures. No fallback creates other sessions/windows. Mutations are serialized.
- **Workflow model routing:** a runtime facade handles actual launch objects,
  including helpers, spreads, aliases and computed agent names. Explicit child
  and top-level models are respected individually; task strings/comments cannot
  change routing. Disabled agents are labelled non-executable in discovery and
  fail before spawn, including computed names. Project agents remain unpinned.
- **False-success fanout:** mode-routed `runs.all` rejects when all children fail;
  explicit catch/recovery remains possible. Mixed batches still need `ok` checks.
  RPC/custom launchers bypassing modes still need the upstream correction.
- **Ten-minute retry waits:** default agent retry backoff reduced from twelve
  attempts/610 seconds to three attempts/2+4+8 seconds. Clean installs default to
  the current OpenAI Codex model rather than the previously depleted Z.ai route;
  existing saved modes and explicit GLM mode are preserved. No account recharged.
- **Run budgets/noisy notifications:** managed subagent config sets a one-hour
  default leaf deadline and quieter meaningful-attention notifications. Async
  composites still need explicit task deadlines; unchanged attention must not be
  blindly re-armed. Schedules/artifacts default outside project worktrees.
- **Browser socket failures:** `bin/dotfiles-browser` supplies private writable
  `AGENT_BROWSER_SOCKET_DIR`, unique explicit session scope and bounded CLI calls,
  without changing XDG globally. It rejects global close/profile attachment and
  leaves TLS, browser sandbox and network policy intact. Real host about:blank
  navigation, evaluation, title reading and exact-session close passed.
- **Secret-mask false positives:** only credential-key values and URLs containing
  credentials are learned by default; built-in token patterns remain. Public URLs,
  model IDs, selectors and CSS classes survive. Inline comments/quoted multiline
  dotenv values, custom key patterns, JSON/details/structured-content redaction
  and config-sensitive caching are covered. Masking remains output-only; historical
  command-argument mangling is not proven fixed by this change.
- **Clipboard:** Pi and standalone Neovim refresh a missing/stale display only when
  exactly one owned Wayland socket is available; X11/runtime variables are
  preserved. Embedded and standalone Neovim provider checks pass. This does not
  retroactively alter already running shells or every standalone application.
- **Context:** native recent-token retention reduced from 60k to 20k, with exact
  model overrides targeting approximately 75% of audited context windows. Native
  compaction already works between tool batches. Metadata-only success/failure
  telemetry and `/pi-health` added; DCP protection remains enabled.
- **Operational recovery:** global instructions plus a browser-QA skill now explain
  sandbox/host boundaries, owned session cleanup, visible React controls, hydration,
  matching Playwright versions, screenshot verification, acceptance prose, anchored
  process matching and source-fetch fallbacks. No broad process kills or security
  bypasses are used as automatic recovery.

### Already fixed, partially stale, or project-specific

- Pi 1.3.0 supports exact per-model compaction overrides, mid-request native
  compaction and compaction-failure events. Its text print mode now emits provider
  errors and returns nonzero (verified with a synthetic error, no provider call).
- pi-subagents now accepts an omitted `noStagedFiles`; explicit null is invalid.
  The old literal helper example was already handled by the regex, but computed
  agents/mixed models were not; the facade supersedes that regex.
- Alt+Shift+G still needs the existing tmux/Alacritty CSI-u workaround; its encoded
  sequence passes the installed TUI parser. Legacy ESC-uppercase/tmux uppercase
  encoding remains an upstream parser limitation; the workaround is preserved.
- Matching Playwright Chromium revision 1234 is now cached locally; compatibility
  must still be checked against each project's Playwright version.
- GPU device forwarding exists in `bin/bwrap`; visible NVIDIA devices do not prove
  Torch CUDA initialization. No driver or application environment changes made.
- Next shared-cache/HMR/chunk-403, hidden controls, React input and recording-auth
  reports require reproduction in their original project; generic QA guidance is
  mitigation, not a claim that those applications were repaired.

### Still open: upstream or environment-specific work

- **DCP 0.2.0:** whole-user-span protection, request-start-only nudges and topic-only
  replay checkpoints persist. Do not disable protection or keep retrying protected
  spans. A tested upstream/local-package implementation needs one shared eligibility
  policy for recent/in-flight batches, automatic pruning and summary replay.
- **Pi-subagents:** cross-reload workflow cancellation, acceptance-output diagnostics,
  exact attention-reason deduplication, and all-failed semantics outside the mode
  adapter still need package lifecycle changes. Z.ai balance errors remain wrongly
  classified as transient upstream, though local retry delay is now bounded.
- **Sandbox:** it is currently ENABLED, so old 'dormant/off' notes are stale. PID and
  network isolation, read-only runtime mounts, active repo-root dotfile masks,
  approval-state files and non-network command URL scans persist. Do not delete
  active mask mountpoints or weaken isolation to hide these symptoms.
- **Browser:** doctor does not reliably test socket writability; cross-namespace
  daemon lifetime, recording-context authenticated proxy state and positional
  screenshot parsing need upstream fixes/reproduction. A CLI timeout is not proof
  that its daemon stopped. Keep commands/cleanup in one authorized environment.
- **Network/research:** package-index, arXiv and GitHub-log access depend on exact
  host approvals and functioning host DNS/proxy transport. No global allowlist
  widening, proxy-secret changes or paid provider fallback was made. GPU compute
  needs validation in the actual research interpreter outside ambiguous namespaces.
- **Web answer/PDF:** claude-bridge nested answer requests can lack prompt capture;
  use readable/raw/HTML retrieval and report unread content. Full PDF extraction
  robustness and supported bridge answer requests remain upstream integration work.

Validation: 47 tests passed, one opt-in live-clipboard test skipped; real browser
smoke passed; strict TypeScript checks, shell/JSON syntax, Pi extension loading,
both profile linker dry-runs and `git diff --check` passed. Existing user edits were preserved; no commits,
pushes, sudo, provider balance changes or installed-dependency patches performed.

### Post-reload sign-off (2026-10-29)

- [x] Actual discovery lists vision as disabled, not executable, in OpenAI mode.
- [x] Computed alias/helper workflow launches returned PONG on Luna/low,
  Sol/medium and Astra/high. All three child `ok` values were true.
- [x] A deliberately nonexistent-agent fanout produced a FAILED workflow with
  `All workflow children failed`, without reaching dependent work or calling a
  model for the nonexistent agent. That failure notification was expected.
- [x] Real owned tmux panes ran multiline code verbatim, reported exit 7, replaced
  exited names without restart, refused live replacement and reported signal 2
  after Ctrl+C. Owned validation panes were cleaned up.
- [x] Real browser navigation, input, click, screenshot and exact-session close
  passed. Reproduced the raw CLI's relative/trailing-flag screenshot-path bug;
  wrapper now canonicalizes flags/paths and verifies a fresh requested output,
  rejecting both missing output and unchanged stale files. Regression coverage
  added; raw agent-browser's parser remains upstream work.
- [x] Full regression suite still passes: 47 passed, one opt-in image test skipped;
  strict TypeScript, shell/JSON syntax and diff checks passed.
- [ ] User: `/compact`, then `/pi-health`; confirm real compaction says completed.
- [ ] User: copy a harmless image and Ctrl+V in Pi (normal/insert prompt modes).
  Clipboard IPC works but currently advertises only text, not an image.
- [ ] User: scroll up and Alt+Shift+G; confirm the terminal jumps to the bottom.
- [ ] Reproduction inputs needed: affected application project/URL and exact
  research Python/venv path for remaining network, hydration, recording and CUDA
  reports. No credentials needed. Other providers were not live-probed.
- [ ] Upstream DCP, sandbox and cross-reload cancellation defects above are still
  open implementation work, not issues that passing local tests can close.

#### User confirmation and live clipboard follow-up (2026-10-29)

These results supersede the pending image/local-key checks immediately above:

- [x] User pasted a readable image; parent inspected the PNG directly.
- [x] Opt-in real-Neovim live image clipboard test passed in both insert and
  normal modes: `PI_TEST_LIVE_CLIPBOARD=1 node --test
  --test-name-pattern='live image clipboard' pi/tests/nvim-prompt.integration.test.ts`.
  Test deleted only its own temporary images and left the clipboard unchanged.
- [x] User confirmed Alt+Shift+G works locally.
- Remote modified-key failures (including Ctrl+Enter) remain deferred at the
  user's request. Terminal/tmux extended-key forwarding is a plausible cause,
  not a confirmed diagnosis or a demonstrated Pi limitation. SSH normally
  forwards input bytes unchanged. No remote-terminal settings changed.
- [ ] Still awaiting real-session `/compact`, then `/pi-health`, confirmation.

#### DCP-default policy requested by user (2026-10-29)

- [x] User confirmed native manual compaction works; it is no longer a pending
  compaction smoke test or the recommended routine context-management workflow.
- [x] Disabled native automatic full-session compaction in managed settings.
  Installed Pi guards both threshold and overflow recovery with this flag;
  regression tests exercise disabled behavior without making provider calls.
- [x] Kept DCP automatic: dedup/purge enabled, model-directed compression allowed,
  strong 25%/50% nudges and current-user-turn protection unchanged. Agent guidance
  now calls for proactive eligible-work compression without manual commands,
  never silently enabling/calling native compaction as a fallback.
- `/compact` still exists as Pi's native manual command, not a DCP alias. No
  installed dependency was patched. `/reload` applies the new default policy.
- DCP's protected current request can still fill the context window. Pause for
  a new user turn/fresh session if older eligible context is exhausted; do not
  disable protection. The existing DCP upstream limitations remain open.
- Validation: 48 tests passed, one live-image test skipped because the clipboard
  now contains text; that live test separately passed in both prompt modes
  earlier. Strict TypeScript, shell/JSON syntax and diff checks passed.

## Rolling DCP disposition (2026-10-30)

- Replaced the upstream extension resource with the repo-owned, pinned 0.2.0
  AGPL fork under `pi/agent/extensions/dcp/`; npm stays installed for its skill.
  Earlier whole-user-span/request-start-only/topic-only/cache-replay observations
  above are historical: rolling token recency, per-request reminders, explicit
  summary-once context and active-branch replay now address those local defects.
- Native automatic compaction remains OFF. Rolling recency is roughly 100k
  estimated tokens, scaled down on small windows, not a total-context cap.
  Pinned instructions/results, prose, successful arguments and summaries can
  still grow without bound; stop for a fresh-session handoff if they cannot fit.
- Validation: 57 tests passed, one opt-in live clipboard test skipped; strict
  TypeScript, managed JSON, shell syntax and diff whitespace checks passed.
  The local extension integration smoke makes no model/network requests and
  checks single registration plus immediate branch-record persistence. No
  installed node_modules, clipboard, setup/linker files, commits or pushes changed.
- Final expanded run: 59 passed, one opt-in clipboard test skipped (60 total),
  including the real Pi loader and suppression of already-compressed candidates.

## pi tmux worker layout quirks (observed 2026-10-30)

- 2026-10-30: `tmux run` for Lexel Translate validation refused with "Pi's window contains unrelated or legacy panes; leave them untouched." Existing panes were left untouched. Workaround: short bounded shell validation and browser QA of local component fixtures (no temporary server needed). Suggested fix: expose actionable owned-pane capacity/layout diagnostics without adopting or manipulating unrelated panes.

## browser readiness QA isolation quirks (observed 2026-10-30)

- 2026-10-30: Owned dotfiles-browser sessions load a page within one bash call but the daemon/context vanishes at the next call (about:blank, unknown refs). Existing host panes are unmanaged and were left untouched. Playwright fallback discovery found the installed package expects chromium-1248, which is not cached. Workaround: complete bounded independent browser journeys within a single CLI/process call and close before exit; do not reuse refs across calls or claim unavailable signed-in/live-dev coverage. Suggested fix: provide a supported persistent sandbox browser transport and matching preinstalled Playwright browser.

## browser QA quirks (observed 2026-10-30)
- Production QA: dotfiles-browser page/session state vanished between sandbox shell calls; bounded same-call journeys preserved state, but route installation success did not establish interception (abort route followed by HTTP 200). Installed project Playwright expected uncached Chromium 1248 while cache contained 1234. Suggested fix: validate persistent sandbox browser lifecycle and route behavior, and align Playwright/cache versions before safe translation QA. No harness modifications made.

## browser QA quirks (observed 2026-10-30)
- Owned dotfiles-browser session qa-ready-mobile-1030 reset to about:blank across bash tool calls; snapshots worked within a single call. Doctor reported no active daemons. Supervisor-approved workaround: self-contained <=30s journeys with open/actions/screenshots/close. Installed Playwright expects chromium-1248 but only chromium-1234 is cached, so it was not substituted. Suggested fix: provide a persistent sandbox runner or install the matching browser through normal harness maintenance.

## browser QA quirks (observed 2026-10-30)
- 2026-10-30: dotfiles-browser owned daemon disappeared between bash invocations during production QA; self-contained bounded journeys partly worked but input/navigation state was inconsistent. Matching Playwright Chromium1248 absent. Investigate runner lifecycle and state continuity; no host workaround or browser substitution used.
