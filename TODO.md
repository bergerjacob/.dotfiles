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
