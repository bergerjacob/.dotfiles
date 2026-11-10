# Pi reliability setup

The managed files are linked on desktop profiles and copied on `minimal-dev`.
Credentials, installed packages, sessions and runtime state stay machine-local.
After changes, run `/reload` (restart Pi for package/config changes). No installed
package files are patched.

## Daily use

- `/mode` selects the primary and tier models. Last-used mode is local state;
  the clean-install default is OpenAI Codex rather than the previously depleted
  Z.ai account. `/mode openrouter` selects DeepSeek V4.1 Flash on OpenRouter.
- Workflow launch objects are routed at runtime, including computed agents,
  helpers, aliases and spreads. Explicit child or top-level models win. Disabled
  agents are labelled non-executable in discovery and rejected on launch; unknown
  project agents keep their own configuration.
- `runs.all` rejects when **every** child failed, preventing misleading successful
  workflows and dependent work. Mixed results still need `result.ok` checks.
  An intentional all-failure recovery can explicitly catch the rejection.
- Default provider retry backoff is now 2/4/8 seconds rather than roughly ten
  minutes. Permanent-balance errors still need an upstream classifier fix.
- Subagent defaults live in `agent/extensions/subagent/config.json`: a one-hour
  default leaf deadline, quieter attention notices, session-scoped artifacts,
  schedules outside repositories. Async composites still need explicit deadlines.
- `/pi-health` reports local model/context, recent compaction outcomes, configured
  sandbox state and clipboard environment. It makes no model/network calls.
- Pi and standalone Neovim repair a missing/stale Wayland display when exactly one
  current-user socket is available. Existing X11/runtime variables are preserved;
  already-running shells/applications are not retroactively modified.

## Processes and browser QA

The local tmux tool owns only panes tagged with Pi's pane ID, in Pi's own window.
Workers tile on the right. Unrelated/legacy panes are never adopted, resized or
killed: move or close them yourself if they block new workers. Never create other
sessions/windows to bypass a capacity error.

Commands run exactly as supplied in non-interactive **bash**, including heredocs
and multiline code; interactive zsh aliases/startup files are not loaded. Exited
processes remain readable with their exit code/signal and are automatically
replaced by the next `run` with that name. Replacing a running process still
requires `restart:true`. Stop finished panes after collecting results.

Desktop setup links `bin/dotfiles-browser` into `~/.local/bin`. Before linking,
invoke `~/.dotfiles/bin/dotfiles-browser` directly:

```sh
dotfiles-browser qa-unique open about:blank
dotfiles-browser qa-unique snapshot -i
dotfiles-browser qa-unique close
```

Each named session uses a private 0700 socket directory under `/tmp`, without
changing `XDG_RUNTIME_DIR`. Calls have a 30-second deadline and 3-second kill
grace (`DOTFILES_BROWSER_TIMEOUT_SECONDS=1..300`). The wrapper refuses global
session cleanup and personal-profile attachment. It does not install a browser,
change network policy, or guarantee that a daemon stopped after a CLI timeout.
For screenshots, `screenshot <path> --full` and `screenshot <selector> <path>`
normalize flags and explicit paths for agent-browser 0.27 and fail if the requested
file was not created/updated; stale output is not treated as success.
Close only the owned session in the same execution environment. Short private
runtime directories can remain after close; never delete live socket storage.
See the `browser-qa` skill for hydration, React input, screenshots and networking.

The sandbox remains **enabled**. Host PID/localhost isolation and read-only
runtime mounts are security boundaries, not evidence that a host server died.
Host tmux execution is outside that sandbox and must be authorized for the task.
Do not remove active dotfile mask mounts; use explicit Git paths rather than
blanket staging if the sandbox exposes device nodes in a worktree.

## Sandboxed networking

Linux `pi-sandbox` uses a network namespace and filtered HTTP/CONNECT proxy, not
unrestricted direct egress. Keep `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`
inherited; clearing them or switching to raw sockets cannot bypass this boundary.
`allowedDomains` is `["*"]`: pi-sandbox only prompts for a domain when it finds a
literal `http(s)://host` in the bash command text, so URLs inside scripts, browser
navigations, redirects and subagent children were never prompted and silently
failed with proxy `403` (seen with costcotravel.com). A per-host allowlist
therefore cannot be made reliable; filesystem policy and the network namespace
remain. Narrow it per project with `.pi/sandbox.json` only if you accept those
silent failures. Never use a host tmux pane solely to evade a denied request.

`runtime-health` enables `NODE_USE_ENV_PROXY=1` for future supported Node children
unless explicitly configured otherwise, including when sandboxing is enabled
later with a command/toggle. Full built-in HTTP/HTTPS/fetch support needs Node
22.21+ or 24.5+ (this machine uses 24.13). Custom HTTP agents can still opt out;
other clients must support the proxy themselves. TLS verification stays enabled.
When Pi itself inherits `SANDBOX_RUNTIME=1`, automatic **Codex** transport uses
SSE: native Node WebSocket did not traverse the authenticated proxy in the local
fixture. Host transport defaults, explicit transport choices, native auth and the
model catalog are unchanged. Isolated nested Pi trials that disable managed
extensions should pass `--transport sse` explicitly. Nested sandbox/proxy layers
were tested through the existing sandbox; no namespace escape is needed.

`/pi-health` reports proxy presence and child transport without printing proxy
URLs/credentials. Auth storage remains write-protected: an unexpired credential
can be read, but OAuth refresh cannot persist a replacement to protected
`~/.pi/agent/auth.json`. Do not copy rotating refresh tokens into trial projects or
silently relax that policy. A trusted parent can refresh its own credentials;
unattended child refresh needs a separately approved write exception or broker.
Reload Pi after configuration/source updates. The existing sandbox keeps its
old allowlist until reloaded; a local fixture pass is not proof of new live-domain
access or an authenticated provider trial.

References: [Node proxy configuration](https://nodejs.org/en/learn/http/enterprise-network-configuration),
[pi-sandbox](https://github.com/carderne/pi-sandbox).

## Context and secrets

**Pi-DCP is the default context-management mechanism.** Automatic deduplication
and errored-input purging remain enabled; the agent proactively compresses closed,
eligible older work-streams, without requiring manual commands. Nudges
start at 50% context (throttled to every 3rd request, plus a sparse safety-net reminder every 20 requests in long loops) and are flagged high-pressure at 75%; these are reminders, not caps.
Use `/dcp context` to inspect savings, not `/compact` to drive routine pruning.

Native automatic full-session compaction is **disabled** (`compaction.enabled:
false`), including its context-overflow compact-and-retry fallback. `/compact`
remains Pi's native manual summarizer, not a DCP alias; agents must not invoke it
or re-enable native fallback unless the user explicitly changes this policy.
The retained 20k recent-token and exact-model reserve settings are dormant budgets
for deliberate manual use/opt-in, not active automatic thresholds. Compaction
telemetry remains metadata-only, without provider error bodies or prompts.

The repo-owned **rolling DCP fork** lives entirely in `agent/extensions/dcp/`,
including pinned 0.2.0 source attribution and AGPL license. The npm package stays
installed, but `extensions: []` and `skills: []` disable its original resources;
only the local directory registers `compress` and `/dcp`. The managed
`agent/skills/pi-dcp/SKILL.md` describes the rolling fork rather than upstream's
incompatible turn-based policy. Existing desktop
links and minimal-dev's recursive copy deploy the fork without linker changes.
See [the local ledger](agent/extensions/dcp/UPSTREAM.md) for source and policy.

`agent/pi-dcp.json` targets the newest **100000 estimated raw tokens**, not the
whole user turn. It caps the target at **40% of usable input** after the current
system estimate and max(16384 safety/tool reserve, model maximum output). Crossing
messages, complete parallel batches, pending calls and paired results are kept
whole, so an enormous result can exceed the target. UTF-8 bytes/3, 16-token message
overhead and 4096-token image placeholders are conservative model-neutral
estimates, not exact tokenizer guarantees. Recent thinking and arguments count.
These estimates may count large opaque reasoning signatures very differently
from provider token accounting; they must not replace the main footer percentage.
The legacy turnProtection fields are disabled/ignored, never unioned into rolling
protection. Every model request reevaluates reminders with eligible endpoints
and estimated savings; denied/manual compression emits no autonomous reminders.

Compression records (full summary and resolved IDs) and suspension/recompression
state are append-only on the active branch, persisted immediately mid-run.
Reload/fork/tree replay ignores external cache-only future-branch records.
Successful legacy tool calls are recovered when arguments/details suffice.
Each active summary is rendered once, in place, inside the first compressed
result of its record (later results of that record only point to it), so it keeps
its chronological position, adds no extra cache break beyond the compression
itself, and never appears as a synthetic user message. `compress` ranges may span
pinned, protected or already-compressed calls: only eligible results inside are
compressed and the rest are reported as left intact; explicit ID lists stay
strictly atomic. No eligible output means no autonomous reminder, even above the
soft pressure ceiling; manual/denied/zero-savings compression is also silent.
A missing pruning opportunity is not evidence of context exhaustion. Reminders
explicitly say to continue the task after useful pruning, not stop or hand off.
Subagent children keep passive pruning and the tool but get no iteration-count nudges.
`/dcp sweep [n]` deliberately loses output facts, only touches eligible results,
and can be undone with `/dcp decompress ID`.

**claude-bridge:** pi-claude-bridge mirrors Pi's history into a Claude Code
session and re-syncs only when the message *count* changes, so in-place
compression never reached the model (verified: request size kept growing after
`compress`). DCP now calls the bridge's `Symbol.for("claude-bridge:markRebuildHooks")`
hooks after every compress/sweep/decompress/recompress, which rebuilds the mirror
from the projected history (one prompt-cache miss, then a smaller cached prefix).
No bridge loaded means a no-op. Automatic dedup/purge changes between rebuilds
still only reach claude-bridge models at the next rebuild.

The stock footer remains provider-backed: the last valid input/cache/output
usage plus estimates for trailing messages. A compression record is not itself a
new measurement. After a rewrite, `DCP N active; context % pending response`
marks this gap until a valid response reports the rewritten input size. Errors,
aborts and zero-usage replies do not clear it; branch/reload replay restores the
correct pending state. A small reduction can be genuine: summaries, recent work,
user instructions, successful arguments and pinned outputs still consume space.
The real SDK regression test verifies outgoing payloads and renders the actual
stock footer after compression, decompression and recompression, without any
network or credentials.

`PI_DCP_TRACE=/path/file.jsonl` appends one JSON line per context pass (raw/projected
message/token estimates, provider context usage, eligible results, active records, nudge decision) for live
diagnostics. `pi/tests/dcp-live-e2e.sh` is the opt-in real-Pi check (real model
requests; run it on the host, optionally `DCP_E2E_MODE=openai|claude-xl`): it
asserts the compression is stored, the next request is smaller, and the model sees
the in-place summary.

Do not turn off protection or repeatedly retry a protected span. Original user
instructions, assistant prose, successful arguments, pinned mutation/skill outputs
and older summaries still grow without bound. Request a fresh session only on an
actual context-limit failure or verified insufficient headroom for the next
bounded step after useful pruning, not solely a DCP estimate, soft threshold,
compression count or refusal. Otherwise continue in bounded steps with small
outputs; another user boundary and native compaction are not substitutes.
DCP does not promise unlimited 12-hour loops or lossless
model-generated summaries. No provider-network calls are used by its tests.

Secret masking now learns **credential-key** values and credential-bearing URLs,
not every `.env` value. Public model IDs, localhost URLs, selectors and CSS
classes remain usable. Built-in token patterns still apply to all result text.
JSON details and structured results are redacted too; commands/files are never
rewritten. `.env` examples:

```dotenv
API_KEY=masked-value
PASSWORD=masked-value
BASE_URL=http://localhost:3000
MODEL=public-model-id
```

For unusual credential names, add regexes under `sensitiveKeyPatterns` in a
project's `.pi/secret-mask.json`. Keys are normalized to lowercase snake_case.
`maskAllValues:true` restores blanket value masking when the configured files
really contain only secrets. This is accidental-output protection, not an
exfiltration sandbox; sensitive files still need filesystem policy.

## Remaining external issues

- Pi-subagents: workflow cancellation after reload, acceptance diagnostics and
  attention-transition deduplication need upstream lifecycle fixes. The local
  mode adapter mitigates false-success batches but does not change package state
  for RPC/custom launchers that bypass it.
- Pi-sandbox/runtime: active repo-root dotfile masks, generated approval files,
  URL scans of non-network command text, and host networking/PID visibility.
  Keep protections; use exact-host task approvals rather than global wildcards.
- Agent-browser: doctor/socket inconsistency, daemon lifetime across namespaces,
  recording proxy/auth contexts and application-specific chunk/hydration bugs.
  Basic about:blank navigation/evaluation/close works through the wrapper.
- Research/download/CUDA issues need checks in the actual project and approved
  environment. No provider balance recharge, package-index access, production UI,
  or Torch GPU initialization is claimed verified by this maintenance pass.
- `fetch_content` answer mode with claude-bridge can lack prompt capture. Prefer
  readable/raw retrieval and answer from that material; no silent paid fallback.

Historical observations remain in `../TODO.md`, with an appended current status.

## Validation

```sh
node --test pi/tests/*.test.ts
node pi/tests/typecheck.mjs  # requires tsc on PATH
bash -n setup.sh bin/* laptop/bin/* pc/bin/* sway/*.sh
zsh -n zshrc
jq empty pi/agent/{settings,keybindings,models,pi-dcp,sandbox,secret-mask}.json \
  pi/agent/extensions/subagent/config.json
git diff --check
```

## Human and project-specific sign-off

After `/reload`, the current OpenAI tiers, dynamic alias routing, expected
all-failed workflow rejection, tmux exit/signal handling and browser navigation,
clicks, screenshots and exact-session cleanup have also been live-checked.

User-interaction sign-off:

1. **Passed:** user confirmed native manual compaction works, but does not want it
   for routine context management. DCP is now the default and native automatic
   compaction is disabled. `/dcp context` is the routine pruning diagnostic;
   `/pi-health` can still show historical native-compaction telemetry.
2. **Passed:** user pasted a readable image. The opt-in live clipboard test also
   passed against real Neovim in both insert and normal modes, without changing
   the clipboard or retaining its temporary test images.
3. **Passed locally:** user confirmed Alt+Shift+G jumps to the bottom. Modified
   shortcuts, including Ctrl+Enter, still fail in SSH/remote-terminal paths;
   further investigation is deferred at the user's request. Extended-key
   forwarding somewhere in the terminal/tmux chain is plausible, not confirmed
   by a key-byte capture, and is not necessarily unfixable in configuration.

To reproduce old application/network/GPU reports, provide the affected project
and URL plus the exact Python/venv path for CUDA work (no credentials). Current
OpenAI live checks do not establish other providers' balance/authentication.
The rolling DCP fork addresses the previously observed upstream DCP defects;
sandbox/cross-reload cancellation issues still require upstream implementation.
Passing these checks does not establish unlimited-context operation.

The new tests use synthetic secrets, fake child launches and a private disposable
tmux server, never provider requests or personal browser sessions. The real
browser smoke test is separate and must close its exact owned session. Re-run
the tests before updating pinned pi-subagents 0.52.0 or pi-dcp 0.2.0.
