# Delegation Guidelines

- **Plan first.** Before any tool call, outline the goal, identify independent work streams, and decide what to delegate.
- **Split independent work.** Fan out parallel tasks to specialist agents (librarian, explorer, fixer) instead of doing them sequentially.
- **Use batch tool for independent reads/searches/listings.** When multiple independent tool calls are needed, batch them. Do not batch dependent or stateful operations (e.g., edits that rely on a previous read).
- **Delegate docs/search/edit to specialists.** Use librarian for research, explorer for codebase search, fixer for bounded implementation. Reserve orchestrator for synthesis, planning, and decisions.
- **Keep outputs concise.** No agent-specific prompt bloat. Say what needs doing in a precise narrow way, then do it or delegate it.
