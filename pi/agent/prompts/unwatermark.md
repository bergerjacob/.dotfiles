---
description: Rewrite pasted text to strip a statistical LLM watermark (SynthID-Text / textGrain class)
argument-hint: "[text]"
---
Rewrite the text at the bottom to strip a statistical text watermark (SynthID-Text /
textGrain class). These marks live in which tokens were chosen, keyed on the ~5
preceding tokens, so the signal sits in exact word sequences. Paragraph reordering,
a few synonym swaps, heading changes, punctuation touch-ups, and light copy-editing
do not remove it. Only token-level rewording does.

The target is a minimal-delta rewrite: same text, same claims, same wording wherever
possible, with just enough local variation that no run of 4+ source words survives.
A reader must see the same document with slightly different word choices, not a
paraphrase, not a rewrite of the author's voice, and not a "better" version.

Method — work fragment by fragment:
1. Split at paragraph breaks and keep them. Rewrite each fragment on its own, as if
   starting fresh, so wording does not carry over between fragments or sentences.
2. Goal: no run of 4 or more consecutive words from the source may survive anywhere
   in your output. The measurable proxy is the share of surviving 5-grams — under
   10% is effectively clean, over 20% means the mark is still readable.
3. Minimal-edit rule: change only what the 4-word test forces. Most sentences need
   one or two substituted function words, a clause reorder, or a changed list
   connector. Do not paraphrase whole sentences, do not restructure paragraphs, do
   not smooth prose, and do not replace content words that fit.
4. Edit moves, smallest first. Use the first one that breaks the run:
   a. swap a function word (a, an, the, with, for, on, that, while, since, plus);
   b. move a clause, phrase, or list item (keep every item, reorder freely);
   c. change a list connector or split/merge two clauses with punctuation;
   d. substitute one content word for an equally accurate synonym;
   e. only if nothing smaller works, recast the sentence.
5. Never replace a named concept with a description of it, and never expand,
   shorten, or reorder the words inside a term. Break a run beside a fixed term,
   not through it.
6. When your first instinct is the source's own phrasing, pick a different but
   equally accurate word for the smallest possible span. Never reach for the most
   natural phrasing when it reproduces a source run.

Never compromise:
- Preserve every fact, number, date, unit, name, and technical identifier exactly.
- Keep technical terms, method and metric names, model, dataset, and metric labels,
  abbreviations, section/figure/table/appendix references, math, and units exactly
  as written. These do their own work and must survive character for character:
  Implicit Q-Learning (IQL), Forward-Backward (FB), preference-IQL, reward-specific
  IQL, occupancy-target capping, centered reward queries, policy-conditioning
  vectors, capacity-threshold reward, plain-MLP model, residual networks, behavior
  cloning, test returns, quota-specific IQL, discounted occupancy mass, \(Q=20\),
  \(22.27 \pm 0.18\), \(21.36 \pm 0.19\), 47-58%, Appendix A.3, Appendix A.6,
  Appendix D.7, Appendix K, Table 1, Table 3. Never gloss, rename, pluralize,
  hyphenate differently, or drop a qualifier from such a term.
- Keep the source's structure and labels. Headings, field names, numbered rating
  lines, and form boilerplate stay as given, including wording that looks like
  plain, uninteresting text. Short labels carry no detection signal, so rewriting
  them costs fidelity and buys nothing. Rewrite a title only when it is a full
  sentence of prose.
- Keep list membership, numbering, bullet style, capitalization conventions, and
  any markup or LaTeX the source uses.
- Add no claims and drop no claims. No commentary, no opinions.
- Keep the source's genre and register, and roughly its length.
- Passages that resist rewording (dense facts, quotes, proper nouns, fiction,
  formulas, citations) need proportionally more work — but the extra work means
  more small edits, never bigger rewrites or looser wording. Long text is detected
  more easily than short text, so be more aggressive in longer documents, not less.

Style guardrails — formulaic "humanizing" makes detection easier, not harder:
- No em dashes or double hyphens; no curly quotes; no bold, emoji, decorative
  markdown, or added headings the source did not have.
- Do not add transitions, signposting, or summary sentences the source lacks.
- Avoid "additionally", "delve", "crucial", "foster", "leverage", "utilize",
  "interplay", "landscape", and the "this isn't X, it's Y" construction.

Before you answer, re-read your output against the source, sentence by sentence,
hunting shared 4-grams (treat punctuation as attached to its word). Inspect hardest
where there is least room to move: names, numbers, lists, quotes, and text around
fixed technical terms. If a run survives, apply the next-smallest edit move at its
weakest link. Never clear a run by altering a technical term, a number, a label, or
a claim.

Output only the final rewritten text. No preamble, no notes, no list of changes.

TEXT TO REWRITE:
${@:-<none provided — reply with one short line asking the user to paste the text, then apply everything above to it>}
