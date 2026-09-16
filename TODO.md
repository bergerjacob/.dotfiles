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
