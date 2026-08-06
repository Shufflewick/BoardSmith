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

## Who transcribes — read this before choosing

Two paths produce slices, and **both are governed by
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md`.** Whoever writes a slice
file reads that contract first, in full, as an actual file read. There is no path where slices
get written from a recollection of what a transcription prompt looks like.

- **Rulebook of 4+ pages → fan-out.** Dispatch one subagent per page range, as below. Context
  economics require it: the orchestrator cannot hold a long rulebook and still run the rest of
  the skill.
- **Rulebook of 1-3 pages → the orchestrator may transcribe inline**, without dispatching. At
  that size, fan-out buys nothing and every observed session skipped it anyway. **If you take
  this path, read `transcription-subagent.md` in full first and follow it exactly** — the same
  three line kinds (`QUOTE` / `Derived (p.N):` / `Visual (p.N):`), the same decision test, the
  same `Named-but-undefined` markers, the same structured summary per section. You are doing the
  subagent's job; you are held to the subagent's contract.

This branch is written down because pretending otherwise was measurably worse. Every rulebook in
this ecosystem is 2 pages. Sessions were dispatching a subagent nominally, then reading the PDF
and writing all slices in the orchestrator anyway — and, because they never read the contract,
transcribing to a superseded version of it recalled from memory: two line kinds, no
`Visual (p.N):` at all. The rule that "the orchestrator never reads the rulebook" was being
violated on every real run, so the contract that rode on it never reached anything. A rule the
system reliably breaks protects nothing; a rule matched to what actually happens does.

The Context-Economics Hard Rule above still holds without exception for **slice re-reads** and
for rulebooks large enough to fan out. Reading a 2-page source once, inline, to transcribe it is
not the failure that rule guards against — accumulating slice text across a long session is.

## Fan-Out Dispatch (4+ pages)

Divide the rulebook into page ranges (e.g. pp. 1-8, 9-16, 17-24, ...) sized so each subagent's
read stays bounded regardless of total rulebook length. The total page count needed to divide
the ranges comes from the user or from file metadata (a file listing for page images, PDF
metadata for a PDF) — never from opening the rulebook content itself; that would violate the
Hard Rule above. Dispatch one Task-tool subagent per page range, in parallel where the harness
allows it. **The subagent writes the slice files itself** — the transcribed text never flows
back through the orchestrator's context.

**Do not compose, restate, or summarize the transcription contract in the dispatch prompt.** The
contract lives in `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md`; the
subagent reads it directly. Each dispatch prompt is short, and carries only the three
substitutions the subagent cannot know on its own:

```
BS-DISPATCH-V2

Read `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` in full and follow it
exactly.

Your page range: {N}-{M}
Rulebook path:   {rulebookPath}
Write slices to: design/rulebook/
```

`Write slices to:` is a per-dispatch substitution, not a constant — it is the one place a real
on-disk path appears rather than a design-relative one, because the subagent has no project
context to resolve it against. This ingest path always fills it with `design/rulebook/`, but the verify orchestrator (`bs/verify/*.md`) is the other caller of this
same contract and fills it with a staging path instead. The contract in
`transcription-subagent.md` treats it as an input either way.

**The `BS-DISPATCH-V2` token is required and the subagent validates it.** A dispatch without it is
rejected unread. This is not ceremony: sessions reliably read this file, see this block, and then
send a prompt they composed from memory instead — one that reproduces a superseded version of the
contract describing only two kinds of slice line, silently dropping `Visual (p.N):`. You cannot
produce the token from memory, so carrying it is the proof you copied this block rather than
recalled one. Copy the block; do not retype it from what you remember a transcription prompt
looking like.

Fill `{rulebookPath}` with the actual path to the PDF/image files/text and `{N}`-`{M}` with the
range — a fresh-context Task subagent has no inherited knowledge of where the source lives.

This indirection is load-bearing; do not "simplify" it back into an inline block. When the
contract was inline, composing each dispatch prompt silently dropped parts of it — most
damagingly the `VISUAL lines` rule, which produced slices where every art and layout note was
misfiled under `Derived (p.N):`. Every contract test stayed green while it happened, because the
tests asserted that the instruction existed, not that a subagent ever received it. A pointer
cannot degrade in transit; a retyped 70-line block can, and did.

**Edition (opening-pages range only):** for the subagent assigned the rulebook's first pages,
append this line to the dispatch prompt above — it is not part of the base dispatch, so the other
ranges never return it:

```
You own the rulebook's opening pages: additionally return the top-level `edition` field
described in the contract.
```


If it comes back null, the orchestrator asks the user. The
orchestrator records it as a header line in `rulebook/INDEX.md` (e.g. `Edition: 2nd edition,
2019 printing`) so every later citation is anchored to the exact text that was transcribed. On
the interview path the line reads `Edition: unpublished — designer statement`.

**Slice numbering is page-anchored** (`NN` = the section's zero-padded starting page number,
specified in `ingest/transcription-subagent.md`) precisely because it is self-allocating: a subagent needs no
knowledge of how many sections any other range produced, so parallel ranges can never collide
on a prefix and the files sort in page order with zero coordination between subagents. Do not
substitute a sequential "numbering base" scheme — the orchestrator cannot know a range's
section count before dispatching the next range's base, so sequential bases duplicate or go
out of order under parallel dispatch. If two sections start on the same page, the subagent
that owns that page writes both (a page range never splits mid-page), so it disambiguates
locally (e.g. `14-movement.md`, `14-combat.md` — the topic name keeps the paths distinct).
`rulebook/00-visual-survey.md` is reserved for the orchestrator's Step 3 visual identity
survey — page numbering starts at 1, so no slice can collide with it. (The interview path
numbers by question group instead — see `ingest/interview-fallback.md` "Output Re-Target";
the two paths are mutually exclusive, so the schemes never mix in one project.)

Do not ask a subagent to interpret or evaluate the rules — only transcribe, write, and extract
the summary fields above. Interpretation is the orchestrator's and, later, `/bs-build-chunk`'s
job, not the transcription subagent's.

## Per-Rulebook-Section User Confirmation

Confirmation is batched per-section (per rulebook section), not per page and not one bulk gate
for the whole rulebook (this is a locked design decision, not a stylistic default). As each
section's `sectionSummary` lands, present it to the user:

> "Here's what I read on pages {N}-{M} ({section name}) — does this match your understanding of
> the rule?"

Wait for confirmation before moving to the next section's summary, and never accumulate several
sections' worth of confirmations into a single end-of-rulebook checkpoint. If the user corrects
something, dispatch a **narrow follow-up subagent** to amend the already-written slice with the
correction (the same mechanism used for a suspect summary — see the Hard Rule above); never
"fix it yourself" by opening the slice, and never hold unconfirmed transcription text in your
own context awaiting confirmation — the subagent wrote it, the follow-up subagent amends it.

**Every subagent return carries a `nextStep` field.** It says to re-read Step 3 of
`${CLAUDE_SKILL_DIR}/SKILL.md` as an actual file read before taking any Step 3 action. Act on it.
It is placed in the returns deliberately: a reminder written here, in text read at the start of
the session, drifts by the time it matters — the returns are the only channel that delivers it
late and fresh.

**When the last section is confirmed, do not continue from memory.** This loop is the longest
stretch of the whole skill — many turns, all of them about rulebook content rather than about
what happens next. Sessions leaving this loop reliably carry on with their own plan for synthesis
instead of the one `ingest-rules.md` Step 3 specifies, skipping the source archive and composing
`rulebook/INDEX.md` freehand. Re-open `${CLAUDE_SKILL_DIR}/SKILL.md` and re-read Step 3 as an
actual file read before taking any Step 3 action. Exiting this loop is the single highest-risk
handoff in the skill.

## Orchestrator Records (never writes slices, never re-reads them)

The subagents write every `rulebook/NN-topic.md`; the orchestrator only accumulates the
summary fields. For each confirmed section:

1. Record `slicePath` against the section so INDEX entries and sketch citations can point at it.
2. Accumulate `citedTerms[]` into the running term → slice-file map that becomes
   `rulebook/INDEX.md` — built exclusively from these accumulated lists, WITHOUT re-reading the
   slice file the subagent wrote.
3. Accumulate `componentMentions[]` (with aspect ratios) into the running component inventory
   that seeds `ASSETS.md` (see `templates/ASSETS.template.md` for the ledger shape this
   feeds — cite it, do not restate its columns here).
4. Accumulate `visualEvidence[]` into the running visual identity survey, which Step 3 item 5
   in `ingest-rules.md` writes to `rulebook/00-visual-survey.md` — the survey is built
   exclusively from these returned observations, exactly parallel to how `rulebook/INDEX.md`
   is built from `citedTerms[]`; the orchestrator never looks at the rulebook's visuals
   itself. The file is the durable handoff to the first UI chunk's design `ask`, which runs
   in a later, fresh-context session.

## Variant / Optional / Advanced Rules

Any rule the rulebook itself marks as a variant, optional module, or advanced/expert rule is
tagged out-of-scope-by-default **by the subagent, at write time**, directly in the slice where
it appears (e.g. a `> Variant:` note inline in the `rulebook/NN-topic.md` text) and reported in
the subagent's `variants[]` return list. The orchestrator's only variant job is downstream: at
Step 3 synthesis it lists the accumulated `variants[]` entries in `SKETCH.md`'s
"Variants (deferred)" section — it never edits or re-reads a slice to tag anything itself.
Variants are never silently folded into the base ruleset, and they are never dropped — they are
deferred and visible.

## Downstream Shape (cite, never restate)

The written slices, `rulebook/INDEX.md`, and the accumulated component inventory feed Step 3
(Synthesis) in `ingest-rules.md`, which seeds `ASSETS.md` (`templates/ASSETS.template.md`) and
`SKETCH.md` (`templates/SKETCH.template.md`). This file does not restate either template's
structure — the orchestrator fills them from what this step returns.
