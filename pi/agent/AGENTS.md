# Global Context

<!-- This file is loaded for all projects. Add global instructions, conventions, and preferences here. -->

The parent agent is the default executor. Delegate only when a child can independently discover, research, review, or execute substantial work.

Do not delegate after already working out the exact edits or solution. If explaining the task would be comparable to completing it directly, complete it directly.

Choose the lowest suitable subagent tier:

- `fast`: well-bounded exploration, research, mechanical edits, repetitive implementation, and validation.
- `standard`: substantial analysis, design or visual judgment, coherent multi-file work, and moderately ambiguous tasks.
- `oracle`: narrow independent second opinions on consequential, high-risk, or genuinely difficult decisions. Prefer concise questions and do not use it for routine work.
- `vision`: image and screenshot inspection through a vision-capable model; exists only when the active mode configures one.

Images are read with `read`, which attaches the image to your context when your model accepts images — inspect those yourself. Only when your model cannot see images (the mode note says so) hand exact image paths plus a specific question to `vision` — single images, or batches with per-image and comparison instructions — instead of reading them yourself.

Avoid parallel writers to the same files. Use subagents to isolate useful work and context, not merely to add another layer of prompting.

## Context management

Use Pi-DCP as the default context-management mechanism, without waiting for the user to request pruning or run a slash command. Proactively compress closed, eligible older work-streams with factual summaries, especially at phase boundaries and on context-budget nudges. Native automatic full-session compaction is disabled by user preference; do not invoke `/compact`, programmatic native compaction, or re-enable that fallback unless the user explicitly changes this policy.

The repo-owned rolling DCP fork protects roughly the latest 100k estimated tokens, scaled down to at most 40% of usable small-model input, plus complete crossing/parallel/pending batches and pinned mutation/skill/compress tools. It does not protect an entire user turn: older phases of one long request can become eligible. Use eligible endpoint IDs and savings in request-local reminders or `/dcp context`; never retry `protected_window_overlap` until eligibility changes, and never disable protection to bypass it. Original instructions remain intact. Summaries and decompression state follow the active branch. DCP thresholds are nudges, not a hard context cap: original instructions, assistant prose, successful arguments, pinned outputs and summaries can still grow without bound. If eligible compression cannot provide room, stop and request a fresh-session handoff, not native compaction or another user boundary as a supposed fix. Generated summaries are not guaranteed lossless.

## Long-running work

For experiments or commands expected to run longer than a few minutes:

- Use one named tmux pane for the real long-running process only when live terminal output is useful. Do not create tmux panes merely to poll, babysit, or duplicate monitoring.
- When completion matters, use one cheap async watcher that performs short polling calls (at most 30 seconds each), then register a nonblocking wait subscription so completion wakes the parent.
- Never make a watcher issue one long blocking sleep or poll command; this triggers the tool watchdog.
- Track every tmux pane you create. Stop it as soon as it is no longer needed, and clean up obsolete panes before returning control to the user. A pane may remain running only when its underlying process intentionally must outlive the turn.
- Worker panes belong only in Pi's own window, tiled to its right. Never create detached sessions/windows to bypass capacity limits or resize/kill unrelated panes. Multiline `tmux run` commands execute as non-interactive bash scripts; read/list expose the real exit status.
- The `tmux-auto-zoom` extension hides any intentionally surviving managed panes by zooming Pi when the agent settles. Do not unzoom or otherwise expose background panes just to inspect them; use `tmux read`.
- Report completion, failure, or genuine attention needs rather than ordinary progress.

## Reliable tool and subagent execution

- Treat sandbox and host execution as different environments. Sandbox `ps`, listeners, localhost failures and GPU process lists cannot prove host liveness. Never remove a dev lock/cache or start a competing server on that evidence. Use existing IPC or an explicitly authorized host check; do not cross into tmux just to evade a denied operation.
- For browser QA, load the `browser-qa` skill and use `dotfiles-browser` with one unique owned session. Keep all commands in the same environment; close only your session. Never use `close --all`, broad `pkill -f`, personal profiles, or disable browser security. If matching processes is unavoidable, anchor the pattern so it cannot match the command's own shell.
- Check every workflow child's `ok` before consuming its output or starting dependent work. Mode-routed `runs.all` throws when all children fail; mixed batches still require explicit checks. Preserve useful prose before acceptance-report fences; rejected/missing evidence is not a success.
- Give substantial implementation/verification workflows explicit task-appropriate deadlines, and separate phases when useful. Do not blindly re-arm a wait subscription after an unchanged attention wake; inspect once and rely on completion delivery. For cancellation, use the exact live workflow ID; if recovery cannot control it, inspect child IDs rather than killing arbitrary processes.
- For research fetch failures, retry readable/raw content or an accessible HTML source and explicitly mark unread material. Do not infer a clean dependency audit or verified paper from an unavailable download. Do not silently switch answer providers or enable hosted/paid fallbacks.
- `/pi-health` shows local model/context, compaction outcomes and clipboard diagnostics without network/model calls. Native print mode now returns nonzero on provider errors; use JSON mode when validating event details.

## Git discipline

- Never push to GitHub or any other remote unless explicitly told to; pushing is always a separate, explicit instruction. Create local commits only when explicitly asked or when moving on to sufficiently different work — not after every task or edit; commit far less often than feels natural.
- Before committing in an unfamiliar repository, check `git log` and match the naming pattern of recent commits in that repo.
- Keep commit titles short: a few lowercase words forming a short sentence describing the change, as concise as possible. No conventional-commit prefixes such as `feat:`, `fix:`, or similar tags.

## Harness setup issues

Unless the user explicitly requests harness/dotfiles maintenance, do not fix incidental quirks in the local harness or machine setup (pi extensions, tmux behavior, agent-browser, dotfiles tooling, broken environment wiring). Record them in `~/.dotfiles/TODO.md` instead:

- **Non-blocking issues**: append a dated bullet under a `## <topic> quirks (observed YYYY-MM-DD)` section (create it if missing) describing the symptom, any workaround used, and a suggested fix. Mention it to the user exactly once per issue — a single short note in your reply, never again in later turns.
- **Blocking issues**: if the problem prevents you from completing the task, stop and bring it to the user's attention immediately. Once resolved (or when told to work around it), record it in `~/.dotfiles/TODO.md` the same way.
- Only append to `TODO.md`; never "fix" entries, restructure the file, or change unrelated setup files while logging an issue.
