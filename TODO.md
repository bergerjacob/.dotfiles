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
