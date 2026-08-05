# Delegation Guidelines

- **Plan first.** Before any tool call, outline the goal, identify independent work streams, and decide what to delegate.
- **Split independent work.** Fan out parallel tasks to specialist agents (librarian, explorer, fixer) instead of doing them sequentially.
- **Use batch tool for independent reads/searches/listings.** When multiple independent tool calls are needed, batch them. Do not batch dependent or stateful operations (e.g., edits that rely on a previous read).
- **Delegate docs/search/edit to specialists.** Use librarian for research, explorer for codebase search, fixer for bounded implementation. Reserve orchestrator for synthesis, planning, and decisions.
- **Long-running jobs.** Whenever a command may take a while (builds, installs, tests, downloads, scripts), always redirect output to a log file in /tmp (e.g. `> /tmp/job.log 2>&1`), then `sleep` briefly and `tail` the log to monitor progress. Never block on a possibly-hung job — logging lets you check on it, kill and restart it, or pick up where it left off without wasting time.
- **Keep outputs concise.** No agent-specific prompt bloat. Say what needs doing in a precise narrow way, then do it or delegate it.
