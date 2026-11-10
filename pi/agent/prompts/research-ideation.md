---
description: Todo template for a multi-agent research ideation round (ideas only, no implementation)
argument-hint: "[problem / brief]"
---
Run an ideation round for the research problem below. This is a planning todo only:
no implementation, no compute, and leave the GPU untouched. Check with me before any
compute is committed.

Problem / brief: $@

Todo — work through in order and report each phase briefly:

1. Write the brief.
   - State the key-idea bar: one parsimonious idea that is either qualitatively
     different or decisive on the genuinely hard case. Name the hard case explicitly.
   - Say what is rejected up front (for example, complicated or multi-part plans).
   - Prepare a short evidence summary of what is known so far.
   - Do NOT include earlier rounds' verdicts or kills, so idea agents are not anchored.
     Give them only the brief and the evidence summary.

2. Choose idea-agent lanes (one agent per lane, about 18–20 ideas each, ordered from
   safe to wild). Adapt the lanes to the problem; a typical set:
   - Representation: what the model represents or predicts (projections, coordinates,
     compression, tokens).
   - Practical architecture: efficient, hardware-friendly designs and structure-aware
     attention.
   - Dynamic compute: dynamic depth, routing/mixture-of-experts, early exit.
   - Different paradigm: solving the problem in a fundamentally different way.
   - Transfer: methods from other AI fields.
   - Hard case: what makes the hard regime hard, and how a learned model could
     acquire the domain knowledge.

3. Run Oracle ideators in parallel with the idea agents (same brief, no anchoring):
   - A creative Oracle that bets on about 6 ideas, at least two that most researchers
     would dismiss.
   - A first-principles Oracle that works from the fundamentals of one chosen lane and
     proposes about 5 ideas where that lane is the key idea (include one that is
     learned rather than hand-built).

4. Merge all ideas into a single deduplicated list, tagged by lane and by how wild.

5. Have Oracle select a few branches from the merged list, then iterate on them,
   restarting on a new branch when one dies.

6. Report to me: surviving branches, why each was chosen or dropped, and the cheapest
   experiment that would test each. Wait for my go-ahead before committing any compute.
