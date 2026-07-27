# Transcription Subagent Contract

**You are a transcription subagent.** The orchestrator (`ingest-rules.md` Step 2, via
`ingest/transcription.md`) dispatched you with a page range and a rulebook path. This file is
your complete instruction set — follow it exactly.

This contract lives in its own file on purpose. It used to be an inline block that the
orchestrator retyped into each subagent prompt, and the retyping silently dropped parts of it —
most damagingly the VISUAL line rule, which produced slices where every art and layout note was
misfiled under `Derived (p.N):`. Every contract test stayed green throughout, because the tests
asserted the instruction existed, not that a subagent received it. Reading the contract yourself,
from this file, is what makes that failure impossible. Do not accept a paraphrase of this file in
place of the file.

---

## Your inputs

The dispatching prompt gives you exactly three things:

- **Page range** `{N}-{M}` — the pages you are responsible for. Do not read outside it.
- **Rulebook path** `{rulebookPath}` — the PDF / image files / text to transcribe from.
- **Output directory** `rulebook/` — relative to the project directory you are already inside.

Identify natural section boundaries within your range. A section rarely spans a page-range seam
cleanly — note where a section continues into the next range.

---

## 1. WRITE the transcribed text to `rulebook/NN-topic.md`

`NN` is the section's **starting page number**, zero-padded to two digits (a section starting on
p.14 → `rulebook/14-movement.md`). Page-anchored numbering is self-allocating: you need no
knowledge of how many sections any other range produced, so parallel ranges can never collide.
If two sections start on the same page, you own both (a page range never splits mid-page) —
disambiguate with the topic name (`14-movement.md`, `14-combat.md`).

Slice text is made of **three visually distinct kinds of line — never blend them.**

### QUOTE lines

Exact source sentences under a citation prefix (e.g. `p.14, Movement:`). A citation prefix is a
promise of verbatim text — before writing each quote line, re-check it word-for-word against the
source page. Never put a paraphrase, a condensation, or a logical consequence under a citation
prefix, however faithful.

### DERIVED lines — `Derived (p.14):`

A **rule-bearing** condensation or inference: one that affects **legality, scoring, or
sequencing**. A derived line must follow from quote lines in this slice alone — never from your
own knowledge of this game or of any game like it.

Being inferred rather than quoted is **not by itself** enough to make a line `Derived`. An
inference about layout, art, palette, or typography is a VISUAL line, however much inference went
into producing it.

### VISUAL lines — `Visual (p.14):`

A diagram, art, layout, or typography description. Same page-citation shape as
`Derived (p.14):`.

**Deciding between `Derived` and `Visual` is a single decision test, not a category list:**

> Does this line affect **legality, scoring, or sequencing**?

- **Yes** → it is `Derived`. Write it under `Derived (p.N):` even though it was inferred rather
  than quoted.
- **No** → it describes a diagram, art, layout, or typography → it is `Visual`. A line answering
  "no" to this test is **never** written under the `Derived (p.N):` prefix, no matter how much
  inference went into describing it.

Two worked examples:

- **Derived** — a per-player starting-hand card count inferred from a setup diagram:
  `Derived (p.3): Each player starts with 5 cards.` It affects legality (how many cards a player
  may hold at setup), so it is `Derived`.
- **Visual** — a setup-diagram layout description:
  `Visual (p.3): Setup diagram shows the deck centered with each player's starting hand fanned
  below their seat.` It describes layout, not a rule, so it is `Visual`.

A publisher logo or copyright note is a useful edge case to keep in mind: it is neither a diagram
of play nor rule-bearing, so it fails the rule-bearing test and is `Visual`.

**Do not invent your own heading or section to hold visual observations.** A `## Visual notes`
heading with `Derived (p.N):` lines under it is the exact failure this contract exists to
prevent — the prefix is the marker, not the heading. Visual observations may sit anywhere in the
slice; what identifies them is `Visual (p.N):` on the line itself.

This inline `Visual (p.N):` prefix is complementary to, not a replacement for,
`rulebook/00-visual-survey.md` — the survey remains the durable whole-rulebook handoff to the
first `ui:` chunk, written by the orchestrator from `visualEvidence[]` at Step 3.
`Visual (p.N):` instead marks a diagram/art note sitting mid-rule inside a rule slice.

### Named-but-undefined markers

If the source names a rule without defining it (a bare mention or cross-reference), write:

```
Named-but-undefined (p.N): <rule name>
```

and stop there — do **not** reconstruct the definition from the rule's name or from general
knowledge. Downstream steps surface it to the designer instead.

### Worked examples are transcription-critical

Worked examples, sample positions/states, and rule-bearing diagrams: copy their exact contents
(coordinates, values, quantities, captions) into the slice in full. They are the only seed
downstream test scenarios have — a dropped example gets silently replaced by an invented one
later.

---

## 2. RETURN a structured summary only — never the transcribed text itself

- **(a) `slicePath`** — the `rulebook/NN-topic.md` file you wrote.
- **(b) `sectionSummary`** — 2-4 sentences describing what the section covers, written for a user
  confirmation prompt.
- **(c) `citedTerms[]`** — every term this section defines or meaningfully references (rules
  vocabulary a cross-reference table would need — not every noun, just game-rules terms).
- **(d) `componentMentions[]`** — any physical component mentioned or depicted (cards, tiles,
  dice, board, tokens), each with its approximate aspect ratio if the rulebook shows or states
  dimensions, and the page citation.
- **(e) `visualEvidence[]`** — visual identity observations from your assigned pages: dominant
  palette candidates, typography feel, iconography, notes on board/card art, and a short
  description of every setup diagram or embedded component image (with page citation).
  **Weave those diagram/image descriptions into the slice text you write as well, each one under
  the `Visual (p.N):` prefix — never under `Derived (p.N):`, which is reserved for rule-bearing
  lines.** The slice is the only downstream record of them; nothing re-reads the PDF/images
  later.
- **(f) `variants[]`** — every rule this section marks as a variant, optional module, or
  advanced/expert rule (name + page citation). Also tag each one out-of-scope-by-default inline
  in the slice text you write (e.g. a `> Variant:` note) — the tag lives in the slice, the list
  entry lives in your return.
- **(g) `openGaps[]`** — every `Named-but-undefined (p.N): <rule name>` line you wrote in this
  section's slice, verbatim (rule name + page citation), so the orchestrator can build
  `## Open Rules Gaps` without re-reading the slice.
- **(h) `nextStep`** — this exact string, copied verbatim, in every return you make:

  > `BEFORE ANY STEP 3 ACTION: re-read Step 3 of ${CLAUDE_SKILL_DIR}/SKILL.md as an actual file read. Do not proceed from memory. Step 3 delegates the archive and rulebook/INDEX.md to a synthesis subagent; writing INDEX.md directly is the known failure.`

  You are not the consumer of this field and it will look redundant to you. Include it anyway.
  It exists because the orchestrator dispatching you will, by the time your return lands, be many
  turns from when it last read its own Step 3, and a reminder placed in text it read at the start
  drifts exactly as much as the instruction it was meant to protect. Your return is one of the
  few things that arrives in that session late and fresh. Carrying this string is the job.

Return exactly: one `{ slicePath, sectionSummary, citedTerms[], componentMentions[],
visualEvidence[], variants[], openGaps[], nextStep }` per section.

---

## Edition (opening-pages range only)

If — and only if — the dispatching prompt tells you that you own the rulebook's opening pages,
additionally return one top-level `edition` field: the edition/printing stated on the cover,
title page, or colophon (`null` if the rulebook states none). Other ranges never return it.

---

## Scope limit

Do not interpret or evaluate the rules — only transcribe, write, and extract the summary fields
above. Interpretation is the orchestrator's and, later, `/bs-build-chunk`'s job, not yours.
