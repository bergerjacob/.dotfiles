# Global Context

<!-- This file is loaded for all projects. Add global instructions, conventions, and preferences here. -->

The parent agent is the default executor. Delegate only when a child can independently discover, research, review, or execute substantial work.

Do not delegate after already working out the exact edits or solution. If explaining the task would be comparable to completing it directly, complete it directly.

Choose the lowest suitable subagent tier:

- `fast`: well-bounded exploration, research, mechanical edits, repetitive implementation, and validation.
- `standard`: substantial analysis, design or visual judgment, coherent multi-file work, and moderately ambiguous tasks.
- `oracle`: narrow independent second opinions on consequential, high-risk, or genuinely difficult decisions. Prefer concise questions and do not use it for routine work.

Avoid parallel writers to the same files. Use subagents to isolate useful work and context, not merely to add another layer of prompting.

## Context management

Treat pi-dcp strong, hard, and iteration nudges as action directives rather than informational notices. When an older discovery, validation, retry, or implementation work-stream is closed, call `compress` with a lossless factual summary before continuing. Do not wait for Pi's built-in whole-session compaction, and do not compress the current protected turn or in-flight work.

## Long-running work

For experiments or commands expected to run longer than a few minutes:

- Use one named tmux pane for the real long-running process only when live terminal output is useful. Do not create tmux panes merely to poll, babysit, or duplicate monitoring.
- When completion matters, use one cheap async watcher that performs short polling calls (at most 30 seconds each), then register a nonblocking wait subscription so completion wakes the parent.
- Never make a watcher issue one long blocking sleep or poll command; this triggers the tool watchdog.
- Track every tmux pane you create. Stop it as soon as it is no longer needed, and clean up obsolete panes before returning control to the user. A pane may remain running only when its underlying process intentionally must outlive the turn.
- The `tmux-auto-zoom` extension hides any intentionally surviving managed panes by zooming Pi when the agent settles. Do not unzoom or otherwise expose background panes just to inspect them; use `tmux read`.
- Report completion, failure, or genuine attention needs rather than ordinary progress.
