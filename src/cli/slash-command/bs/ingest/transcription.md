# Transcription — Fan-Out Subagent Dispatch (INGEST-01)

This is the written-rulebook input path: the orchestrator (`ingest-rules.md` Step 2) delegates
here when the designer has a rulebook (PDF/images/text) to transcribe. The project scaffold
(`ingest-rules.md` Step 1) has already run — every `rulebook/NN-topic.md` write below targets
the scaffolded project directory the session is now inside, never its parent. No prior `bs-` skill or
old-skill section performs this kind of multi-subagent fan-out — this mechanism is net-new.

## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never reads the full rulebook, and it never re-reads a slice file after a
subagent writes it.** Every fact the orchestrator needs about a slice's content — its cited
terms, its component mentions — comes from the structured summary the subagent returns, not
from opening the file again. The single most tempting mistake in this entire skill is adding a
"let me double-check by re-reading what I just wrote" step after a subagent returns. Do not do
this. It silently reintroduces the exact context-exhaustion failure mode this fan-out design
exists to avoid. If something looks wrong in a returned summary, ask the user or dispatch a
narrower follow-up subagent — never fall back to reading the slice yourself.

## Fan-Out Dispatch

Divide the rulebook into page ranges (e.g. pp. 1-8, 9-16, 17-24, ...) sized so each subagent's
read stays bounded regardless of total rulebook length. Dispatch one Task-tool subagent per page
range, in parallel where the harness allows it. Each subagent's prompt:

```
Transcribe pages {N}-{M} of the rulebook to canonical text. Identify natural section
boundaries within this range (a section rarely spans a page-range seam cleanly — note where a
section continues into the next range). For each section, emit:

  (a) sectionText — the transcribed text, verbatim in substance, with an explicit page/section
      citation prefix (e.g. "p.14, Movement:").
  (b) citedTerms[] — every term this section defines or meaningfully references (rules
      vocabulary a cross-reference table would need — not every noun, just game-rules terms).
  (c) componentMentions[] — any physical component mentioned or depicted (cards, tiles, dice,
      board, tokens), each with its approximate aspect ratio if the rulebook shows or states
      dimensions, and the page citation.

Return exactly: { sectionText, citedTerms[], componentMentions[] }
```

Do not ask a subagent to summarize, interpret, or evaluate the rules — only transcribe and
extract terms/components. Interpretation is the orchestrator's and, later, `/bs-build-chunk`'s
job, not the transcription subagent's.

## Per-Rulebook-Section User Confirmation

Confirmation is batched per-section (per rulebook section), not per page and not one bulk gate
for the whole rulebook (this is a locked design decision, not a stylistic default). As each subagent's
sectionText lands, present its summary to the user:

> "Here's what I read on pages {N}-{M} ({section name}) — does this match your understanding of
> the rule?"

Wait for confirmation before writing the next page range's content and before moving to the next
subagent's summary. If the user corrects something, update `sectionText` before it's written to
disk — never write an unconfirmed slice, and never accumulate several sections' worth of
confirmations into a single end-of-rulebook checkpoint.

## Orchestrator Writes (never re-reads)

For each confirmed section:

1. Write `sectionText` to `rulebook/NN-topic.md` (numbered, topic-named — e.g.
   `rulebook/03-movement.md`).
2. Accumulate `citedTerms[]` into the running term → slice-file map that becomes
   `rulebook/INDEX.md` — built exclusively from these accumulated lists, WITHOUT re-reading the
   slice file just written.
3. Accumulate `componentMentions[]` (with aspect ratios) into the running component inventory
   that seeds `ASSETS.md` (see `templates/ASSETS.template.md` for the ledger shape this
   feeds — cite it, do not restate its columns here).

## Variant / Optional / Advanced Rules

Any rule the rulebook itself marks as a variant, optional module, or advanced/expert rule is
tagged out-of-scope-by-default directly in the slice where it appears (e.g. a `> Variant:` note
inline in the `rulebook/NN-topic.md` text), and the orchestrator lists it in `SKETCH.md`'s
"Variants (deferred)" section during Step 3 synthesis. Variants are never silently folded into
the base ruleset, and they are never dropped — they are deferred and visible.

## Downstream Shape (cite, never restate)

The written slices, `rulebook/INDEX.md`, and the accumulated component inventory feed Step 3
(Synthesis) in `ingest-rules.md`, which seeds `ASSETS.md` (`templates/ASSETS.template.md`) and
`SKETCH.md` (`templates/SKETCH.template.md`). This file does not restate either template's
structure — the orchestrator fills them from what this step returns.
