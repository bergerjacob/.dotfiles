# Rolling DCP fork

Pinned source: **@davecodes/pi-dcp 0.2.0**, npm distribution installed under
Pi's agent npm root; https://github.com/Davidcreador/pi-dcp (author: davecodes).
Upstream is a port of opencode-dynamic-context-pruning. License:
AGPL-3.0-or-later; complete license in `LICENSE`. This directory is the
corresponding local source, not an installed-node_modules patch.

Only needed upstream modules are vendored under `vendor/lib`: config, message
helpers, state types/factory, deduplication and purge-errors. The upstream npm
package remains pinned, but its extension and skill resources are DISABLED
(`extensions: []`, `skills: []`). Pi discovers only this directory's `index.ts`
and the fork-matching managed `../../skills/pi-dcp/SKILL.md`.
Do not add an additional settings extension path or enable the npm entry.
Desktop's existing extensions link and minimal-dev's recursive copy carry the
entire directory, including license; no external source symlinks are required.

## Local change ledger (2026-10-30)

- New `index.ts` / `core.ts` replace upstream orchestration, tools, commands,
  pipeline, nudges and external-JSON persistence. Active branch entries and full
  tool-result details are authoritative; no future-branch cache hydration.
- Upstream config adds rollingProtection defaults. Legacy turnProtection is
  retained only for old config compatibility; **not consulted**, nor unioned
  with token recency. Prompt overrides/notification settings from upstream are
  compatibility fields, not supported UI surfaces of this smaller fork.
- Token helper replaces Anthropic-only dependency with UTF-8 bytes/3 estimate.
  This removes all non-host runtime imports (typebox is supplied by Pi).
  Message helper image savings estimates increase from 256 to 4096 tokens.
- Purge-errors always reapplies mutations; ID sets suppress statistics only.
  Error ages are reconstructed from assistant-message positions every request.
- Context handler calculates one shared policy from originals before pruning;
  tool preflight and sweep use Pi's active compaction/context-edit projection.
- Crossing messages, entire parallel batches, call/result IDs and pending batches
  are protected. Original user/system instructions are never removed. Mutation,
  skill and compression tools remain pinned (including namespaced mutations,
  apply_patch and reads of SKILL.md). Ranges skip ineligible calls; explicit
  ID lists with any ineligible target are refused atomically.
  Already-compressed targets are excluded from actionable endpoint/savings
  suggestions and new tool/sweep requests, preventing futile repeated nudges.
- Every request reevaluates nudges with an uncapped request counter, eligible
  endpoints and savings; no before_agent_start-only reminders, synthetic
  persisted user boundaries, continuation queues or native compaction.
- No actionable savings means no autonomous nudge, including above the soft
  ceiling and in manual/denied mode. Removed the soft-ceiling handoff instruction:
  eligibility and approximate token pressure do not establish exhaustion.
  Tool/refusal guidance and the managed skill say to continue bounded work;
  SKILL.md reads stay pinned. Raw byte/signature estimates no longer masquerade
  as footer context usage: stock provider-backed accounting is retained, with
  a branch-replayed pending-response status after rewrites. Invalid/zero prompt
  usage does not clear pending state. Opt-in trace includes raw/projected
  estimates and provider context separately.
- A real SDK fixture drives tools, outgoing transformation, session persistence
  and the stock footer with a scripted in-process provider. It checks shrinkage,
  summary visibility, canonical originals, decompress/recompress and error/zero
  usage, without credentials or network calls.
- Summaries appear once per applicable active record, in place on its first
  compressed result. Stored compress arguments are projected to a marker so
  they don't duplicate summaries.
  Suspensions/recompressions/manual state use append-only branch custom entries.
- Success result details contain the complete record. A branch custom entry is
  appended synchronously inside execute, before agent_end. Legacy successful
  calls are migrated from matching arguments and details when recoverable;
  external cache-only summaries lacking branch evidence are intentionally ignored.

## Budget / limitations

`recentTokens: 100000` is a target, NOT a total-context cap. The suffix budget is
min(target, maxWindowFraction * usableInput), with fraction clamped to 0.4.
Usable input subtracts the current system prompt estimate and the larger of
`reserveTokens: 16384` and the active model's maximum output allowance. The fixed
reserve also provides tool-schema/safety headroom; the remaining 60% accommodates
older pinned instructions, prose, arguments and summaries. Unknown windows use
200k conservatively. Configuration values must be finite/nonnegative or defaults
are used; a crossing message or batch may exceed the target substantially.

Text/arguments/thinking/signatures use UTF-8 bytes/3, messages have 16 tokens of
overhead, images default to 4096 each (base64 is not counted as text). This is
model-neutral and conservative for typical code/prose, **not a tokenizer or a
mathematical upper bound**, especially for images, unusual encodings or provider
reasoning. It is not calibrated against stale previous-response usage.

Only tool outputs and old errored non-pinned arguments are pruned. Successful
arguments, prose, original instructions, mutation/skill results and summaries
can grow without bound in a 12-hour single request. Native compaction stays OFF.
Only an actual context-limit failure or verified insufficient headroom for the
next bounded step after useful pruning warrants a fresh-session handoff; a soft
threshold, compression count or lack of eligible results alone does not. Continue
bounded work otherwise. A new user turn alone does not reset the rolling budget.
Summary correctness still requires model judgment. No claim of unlimited operation or lossless summaries.

Commands: `/dcp context` (also default/help), `/dcp stats`, `/dcp manual on|off`,
`/dcp sweep [positive count]` (eligible results only, deliberately lossy),
`/dcp decompress ID`, `/dcp recompress ID`. Sweep never bypasses protection or
permission deny. Permission ask requires a UI confirmation for autonomous tools;
an explicit user sweep is already user authorization.
