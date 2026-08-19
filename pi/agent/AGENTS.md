# Global Context

<!-- This file is loaded for all projects. Add global instructions, conventions, and preferences here. -->

The parent agent is the default executor. Delegate only when a child can independently discover, research, review, or execute substantial work.

Do not delegate after already working out the exact edits or solution. If explaining the task would be comparable to completing it directly, complete it directly.

Choose the lowest suitable subagent tier:

- `fast`: well-bounded exploration, research, mechanical edits, repetitive implementation, and validation.
- `standard`: substantial analysis, design or visual judgment, coherent multi-file work, and moderately ambiguous tasks.
- `oracle`: narrow independent second opinions on consequential, high-risk, or genuinely difficult decisions. Prefer concise questions and do not use it for routine work.

Avoid parallel writers to the same files. Use subagents to isolate useful work and context, not merely to add another layer of prompting.
