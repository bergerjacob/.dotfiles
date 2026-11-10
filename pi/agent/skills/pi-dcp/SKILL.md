---
name: pi-dcp
description: Use the repo-owned rolling DCP fork to prune closed older tool outputs during long coding loops or context-pressure nudges. No eligible results does not mean context is full; continue the task after pruning.
---

# Rolling DCP

This is the repo-owned fork, not upstream pi-dcp's turn-based policy.

## Prune, then continue

- Compress closed older work-streams proactively when useful. Use eligible endpoint IDs and estimated savings from request-local reminders or `/dcp context`.
- In range mode, call `compress` with `startToolCallId`, `endToolCallId`, `topic`, and a factual `summary`. Preserve paths, findings, decisions, errors and unresolved work. Summaries are model-written, not guaranteed lossless.
- A range may cross pinned, protected or already-compressed calls; they are skipped. Explicit `toolCallIds` mode refuses any ineligible ID atomically. Do not retry refused IDs until eligibility changes or disable protection to bypass it.
- After pruning, resume the user's task. **No eligible results is not evidence of exhausted context.** Neither a soft pressure threshold (including 75%), a refusal, nor the number of compressions requires a handoff. Keep working in bounded steps with small tool outputs; don't respond to this skill or a reminder with only a fresh-session request.
- Request a fresh session only after an actual context-limit failure or verified insufficient headroom for the next bounded step after useful pruning. Cite that evidence, not a rough DCP estimate alone. Native compaction remains disabled: do not invoke `/compact` or enable fallback without explicit user approval.

## What survives

The latest rolling suffix targets 100k estimated tokens, capped at 40% of usable model input. Crossing messages, complete parallel/pending batches, mutations, compression calls and reads of `SKILL.md` remain protected. This does **not** protect an entire user turn: earlier closed phases of one long request can become eligible.

Original user/system instructions remain intact. Active summaries replace selected tool outputs in place; successful arguments, prose, pinned outputs and summaries still grow, so context is not unlimited. Deduplication and old errored-input purging run automatically outside protection. DCP's token estimates are approximate, not actual provider usage or a stop threshold.

## Commands and configuration

- `/dcp context` / `/dcp stats`: eligible endpoints, savings and active records.
- `/dcp decompress ID` / `/dcp recompress ID`: restore/reapply a record on the active branch.
- `/dcp manual on|off`: control autonomous compression reminders/tool use.
- `/dcp sweep [n]`: deliberately lossy manual removal of eligible results, not a default recovery action.

Managed defaults live in `pi/agent/pi-dcp.json`, deployed as `~/.pi-dcp/config.json`; project overrides use `.pi/dcp.json`. Reload/restart after configuration changes. Compression and suspension state follows the active session branch, not an external cache.
