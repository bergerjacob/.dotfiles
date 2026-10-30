---
name: browser-qa
description: Reliable isolated browser QA with agent-browser or Playwright. Use for screenshots, UI interactions, hydration problems, local dev-server checks and browser runtime/network failures.
---

# Browser QA

## Execution boundary first

- Check `/sandbox` and distinguish the tool sandbox from the host desktop. Empty `ps`/listeners or refused localhost inside the sandbox do **not** prove a host server is dead. Never remove a lock/cache or start a second Next/Turbopack server on that evidence.
- Keep the server and every browser command in the same execution environment. Host tmux commands cross the tool sandbox boundary: use them only when authorized for that task, not to evade denied-domain or filesystem policy. Do not disable the sandbox, TLS validation, Chrome security or network allowlists to make a test pass.
- Use the existing server's advertised origin (`localhost` versus `127.0.0.1` can matter). Do not clear proxy variables indiscriminately: authenticated proxies may be required. Report DNS, CONNECT, TLS, HTTP and hydration failures separately.

## Owned, bounded browser session

Desktop setups install `dotfiles-browser`. From a source checkout before linking, use `~/.dotfiles/bin/dotfiles-browser`. On a headless minimal-dev setup, the browser CLI and wrapper are not installed automatically.

Choose one unique session name (letters/digits/_/-, at most 40 characters), e.g. `qa-<short-task-id>`:

```sh
dotfiles-browser qa-task open about:blank
dotfiles-browser qa-task open http://localhost:3000
dotfiles-browser qa-task snapshot -i
# ...interaction checks...
dotfiles-browser qa-task close
```

The wrapper supplies a private writable socket directory via `AGENT_BROWSER_SOCKET_DIR`, preserves `XDG_RUNTIME_DIR` and required proxy transport, and bounds each call to 30 seconds (override `DOTFILES_BROWSER_TIMEOUT_SECONDS`, at most 300). A timeout means the CLI timed out, **not** proof that the daemon or Chrome stopped. Close only the owned session in the original environment; if that hangs, report the owned session/runtime path and stop escalating. Never use `close --all`, broad `pkill -f`, or a personal browser profile. Do not delete live socket directories.

If sandbox calls repeatedly destroy or cannot see the daemon, do not relaunch it in a loop. Use one authorized persistent runner. If agent-browser remains broken, use the project's existing Playwright installation and its matching cached browser; do not download/upgrade browsers or quietly choose a different revision without checking compatibility.

## Interaction and evidence

- Snapshot first; scope controls to a visible container. Desktop/mobile duplicate controls can make exact text matching select a hidden element.
- If `fill` changes DOM value without updating React state, click then use keyboard typing. Verify a state change, not just input.value.
- Prefer `dotfiles-browser <session> screenshot <path> --full`. The wrapper moves flags first, canonicalizes explicit output paths, and checks that the requested file was actually created/updated (not an old screenshot). It also supports `screenshot <selector> <path>`. Raw agent-browser 0.27 can silently ignore relative/trailing-flag paths; never assume its success status means the requested file exists.
- For dead-looking pages, inspect console errors, failed chunk requests and hydration before diagnosing application handlers. Compare the same failing URL from the same environment with bounded curl; redact cookies, auth/proxy headers and HARs.
- Recording contexts can fail independently of normal navigation. Report recording failure separately and retain screenshots rather than calling it an app defect.
- A vision-capable primary reads screenshots directly. Delegate only when the primary cannot see images and an enabled image-capable agent is actually available.
- Close the owned browser session and stop owned temporary servers/panes when done. Preserve unrelated sessions and existing servers.
