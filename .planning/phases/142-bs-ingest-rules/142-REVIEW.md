---
phase: 142-bs-ingest-rules
reviewed: 2026-07-04T22:25:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/cli/slash-command/bs/ingest-rules.md
  - src/cli/slash-command/bs/ingest/transcription.md
  - src/cli/slash-command/bs/ingest/interview-fallback.md
  - src/cli/slash-command/bs/ingest/scaffold.md
  - src/cli/slash-command/bs/ingest/sketch-derivation.md
  - src/cli/slash-command/bs/ingest.test.ts
findings:
  critical: 2
  warning: 5
  info: 5
  total: 12
status: issues_found
---

# Phase 142: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-04T22:25:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Iteration-1 fixes verify as coherent: the scaffold-first reorder is consistently reflected in
all four reference files (transcription.md and interview-fallback.md both state Step 1 has
already run and writes target the project dir, never the parent); the propose-then-write
sequence is airtight (Step 4 proposes only, Step 6 gates, Step 7 is the single write point,
with the deliberate carve-out that rulebook/, INDEX.md, and ASSETS.md are factual pre-approval
artifacts); the no-DESIGN.md rule matches DESIGN.template.md's header; visualEvidence[] is
threaded through the return shape, prompt, and synthesis; the CLI claims in scaffold.md
(`init` no-sanitize behavior, the exact already-exists error, the `--no-open` skip message, the
`Ready! Press Ctrl+C to stop.` line, `toPascalCase`/`toDisplayName` splitting only on `-`/`_`)
all verify against `src/cli/commands/init.ts`, `src/cli/commands/dev.ts`, and
`src/cli/lib/project-scaffold.ts`; the bs/-rooted relative-path citation convention is applied
consistently (including `../aspects/index.md`); and all 39 drift tests pass.

However, the end-to-end walk exposes two gaps the fixes did not close. First, the visual
identity survey — a required ingest output per the plan — is assembled in the orchestrator's
context at Step 3 but is never written to any file at any step, so it cannot survive to the
first UI chunk's `ask` in a later session. Second, the migration path (Step 0 case 3) routes
to Step 3 but produces none of the inputs Step 3/4 and every downstream `/bs-build-chunk`
step require: no `rulebook/` slices, no `citedTerms[]`, no INDEX — silently violating the
"identical rulebook/ shape" invariant interview-fallback.md itself declares load-bearing.

## Critical Issues

### CR-01: Visual identity survey has no durable write target — it evaporates at session end

**File:** `src/cli/slash-command/bs/ingest-rules.md:94-101` (Step 3 item 5); `src/cli/slash-command/bs/ingest/transcription.md:98-101`
**Issue:** Step 3 item 5 says the survey is "built exclusively from the accumulated
`visualEvidence[]` lists," and transcription.md says the orchestrator "accumulate[s]
visualEvidence[] into the running visual identity survey" — but no step ever writes the survey
to a file. Step 7 enumerates every write (SKETCH.md, CHUNK.md stubs, RULINGS.md, DECISIONS.md,
explicitly-not-DESIGN.md, ASSETS.md-already-seeded) and the survey is not among them; Step 3's
other artifacts (INDEX.md, ASSETS.md) each name their file, the survey names none. Per the
plan, the survey's consumer is the first UI chunk's `ask` step ("Ingest produces the evidence…
The first UI chunk's `ask` is the design ask") — which by the session-handoff-seams rule is a
different, fresh-context session, possibly many chunks later. An in-context-only survey is
data loss: the evidence the design ask depends on is gone the moment the ingest session ends.
(Setup-diagram descriptions survive inside slice text per transcription.md lines 48-49, but the
synthesized survey — palette candidates, typography feel, iconography — exists only in the
orchestrator's accumulation.)
**Fix:** Name a durable home and write it at Step 3 alongside INDEX.md/ASSETS.md (it is factual
evidence, not gated sketch state, so pre-approval writing is consistent with the Step 7 note).
E.g. in Step 3 item 5:
```markdown
5. **Visual identity survey** — ... written to `rulebook/00-visual-survey.md` (evidence only,
   no decision) so the first UI chunk's design `ask` — a later, fresh session — can read it;
   an in-context-only survey would be lost at session end.
```
Coordinate the chosen path with whatever `/bs-build-chunk`'s design-ask step will read, and
add a drift-test pin for the filename.

### CR-02: Migration path (Step 0 case 3) produces no `rulebook/` slices — every downstream step it routes to consumes inputs that don't exist

**File:** `src/cli/slash-command/bs/ingest-rules.md:35-43` (Step 0 case 3), `:74-104` (Step 3), `:105-113` (Step 4)
**Issue:** Case 3 says "Skip Step 2 as well and proceed to Step 3 (Synthesis) using the old
project's captured content instead of new transcription/interview output." But Step 3's
instructions are defined exclusively in terms of subagent returns: INDEX.md is "built
exclusively from the accumulated `citedTerms[]` lists," the survey "exclusively from the
accumulated `visualEvidence[]` lists," ASSETS.md from `componentMentions[]` — none of which
exist on the migration path, and no instruction converts PROJECT.md content into them. Worse,
an old `/design-game` project has no `rulebook/NN-topic.md` slices at all, yet Step 4 carves
chunks "from the rulebook slices" with citations, SKETCH.template.md requires per-chunk
`Citations:` lines, and `/bs-build-chunk`'s investigate step reads "the chunk's cited slices."
interview-fallback.md:14-16 declares the invariant explicitly: "INGEST-03 depends on this
identity: every downstream ingest step … is unaffected by which input path was taken."
Migration is a third input path that silently breaks that identity — a migrated project cannot
run a single chunk without agents improvising citations against files that don't exist.
**Fix:** Make migration produce the same `rulebook/` shape, reusing the interview path's
Output Re-Target mechanism. In case 3, replace "proceed to Step 3 … using the old project's
captured content" with an explicit conversion step:
```markdown
   On acceptance, convert the old project's captured content into the standard rulebook/
   shape first: write the old interview/PROJECT.md content as `rulebook/NN-topic.md` slices
   (grouped by topic, per `ingest/interview-fallback.md` "Output Re-Target"), with citation
   format `designer statement, migrated from /design-game project`. Collect citedTerms[] /
   componentMentions[] from those slices as you write them, then proceed to Step 3 — which
   runs unchanged, preserving the input-path identity `ingest/interview-fallback.md` declares.
```

## Warnings

### WR-01: Transcription subagent prompt template is under-parameterized — no rulebook source location, no numbering-base placeholder, no edition field

**File:** `src/cli/slash-command/bs/ingest/transcription.md:26-57`
**Issue:** The quoted prompt template opens "Transcribe pages {N}-{M} of the rulebook" but never
tells the subagent WHERE the rulebook is (path to the PDF/image files/text). A fresh-context
Task subagent has no inherited knowledge of the source location; an orchestrator copying this
template verbatim dispatches subagents that cannot do the job. Similarly, line 26's
parenthetical instructs "give it the slice-numbering base for its range" — but the template
itself contains no `{base}` placeholder, so the base is never actually communicated; and the
`edition` field (lines 59-64) is described only in orchestrator-facing prose after the prompt,
not as an addition to the opening-range subagent's prompt. There is also no stated mechanism
for the orchestrator to learn the total page count needed to divide ranges without violating
the "never reads the full rulebook" rule (ask the user? file metadata?).
**Fix:** Add `{rulebookPath}` and `{numberingBase}` placeholders to the template, an explicit
"opening-range only: also return `edition`" line to append for the first dispatch, and one
sentence stating page count comes from the user or file metadata — never from opening the
rulebook content itself.

### WR-02: Slice-numbering base scheme is unspecified — parallel ranges will collide or go out of order

**File:** `src/cli/slash-command/bs/ingest/transcription.md:26`
**Issue:** "give it the slice-numbering base for its range so file numbers stay in page order"
— but the orchestrator cannot know how many sections a range will yield before dispatching the
next range's base. If range pp.1-8 gets base 01 and produces five sections (01-05) while range
pp.9-16 was dispatched in parallel with base 04, prefixes duplicate and page order breaks —
defeating the stated purpose. No allocation scheme is given.
**Fix:** Specify a collision-free scheme, e.g. page-anchored numbering (`NN` = the section's
starting page number, zero-padded: `rulebook/14-movement.md` for a section starting on p.14),
or a fixed stride per range (range k gets bases k*10+1..k*10+9). Page-anchored is
self-allocating and needs no coordination between parallel subagents.

### WR-03: State detection misses the partial-ingest crash state — re-run inside a half-ingested project scaffolds a nested project and re-transcribes

**File:** `src/cli/slash-command/bs/ingest-rules.md:21-43` (Step 0)
**Issue:** The re-run guard keys solely on `SKETCH.md`, which is written only at Step 7. A
session that crashes anywhere between Step 1 and Step 7 leaves a project containing `rulebook/`
slices, `rulebook/INDEX.md`, and `ASSETS.md` but no `SKETCH.md` and no `PROJECT.md`. Re-running
`/bs-ingest-rules` inside that directory matches case 1 ("fresh"), so Step 1 runs `init` again
— creating a nested `<name>/<name>/` project — and Step 2 re-transcribes from scratch, orphaning
the already-confirmed slices. (Re-running from the parent fails loudly via `init`'s
already-exists error, which is fine; the inside-the-project case is the silent one.)
**Fix:** Add a case between 1 and 2: `rulebook/` or `ASSETS.md` present without `SKETCH.md` →
"a previous ingest was interrupted after transcription but before sketch approval"; STOP and
ask the user whether to resume from the existing slices (skip Steps 1-2, re-run Step 3 onward)
or discard and restart.

### WR-04: Display Name contradiction — defined as "as they wrote it" but the CLI derivation scaffold.md defers to is lossy

**File:** `src/cli/slash-command/bs/ingest/scaffold.md:20,31-37`
**Issue:** Line 20 defines Display Name as "The name as they wrote it," but lines 34-36 say the
CLI's `toDisplayName` derives it "from an already-kebab-cased name, so do not re-derive those
two." Those two statements conflict for any name with punctuation or nonstandard casing:
`initCommand` (verified, `src/cli/commands/init.ts:36`) sets `displayName: toDisplayName(name)`
from the kebab-case argument with no override — "The Duke's Gambit" kebab-cases to
`the-duke-s-gambit` and round-trips to "The Duke S Gambit". The scaffolded `boardsmith.json`
then carries a wrong display name that "do not re-derive" forbids the session from noticing.
**Fix:** After `init`, add one step: compare `boardsmith.json`'s `displayName` to the name as
the designer wrote it; if they differ (punctuation, casing), edit `boardsmith.json` to the
designer's original. Keep "do not re-derive the Class name" as-is — only Display Name needs
the correction because it is user-facing verbatim text.

### WR-05: Templates promise "the skill instructions state its installed location" — ingest-rules.md (the skill instructions) never does

**File:** `src/cli/slash-command/bs/ingest-rules.md:166-179` (Reference Files)
**Issue:** SKETCH.template.md, ASSETS.template.md, and DESIGN.template.md each open with:
"state-machine.md … installed alongside the bs- skills themselves (the skill instructions
state its installed location)." ingest-rules.md is the skill-instruction file for ingest, and
it cites `state-machine.md` and `templates/*.template.md` by bare bs/-rooted relative path
only — no installed location is stated anywhere. A session running the installed skill from
inside a game project has no stated way to resolve where `templates/SKETCH.template.md` lives
on disk when Step 7 says to "copy" it. The cross-file promise is currently dangling.
**Fix:** In the "Reference Files" section, add one sentence stating where the shared reference
files and templates are installed relative to the skill file (matching whatever
`install-claude-command.ts` will do — if that layout is decided in a later phase, add a
placeholder note flagging the dependency so the installer phase closes it rather than nobody).

## Info

### IN-01: Stale test-file header comment claims most tests are RED / files don't exist

**File:** `src/cli/slash-command/bs/ingest.test.ts:10-19`
**Issue:** "Most tests below are RED (or ERROR, since the files don't exist yet)" — all four
reference files now exist and all 39 tests pass. The Wave-0 framing is now misleading history.
**Fix:** Reword to past tense ("Authored first, Wave-0; the referenced files have since landed").

### IN-02: Weak pins — edition not asserted; PROJECT.md negative assertion nearly vacuous

**File:** `src/cli/slash-command/bs/ingest.test.ts:77-81,110-114`
**Issue:** The "names variant/edition tagging" test asserts only `/variant/i`, never `edition`
— an edition-line removal in ingest-rules.md/transcription.md would not fail any test. And
`not.toMatch(/Outputs?:?\s*PROJECT\.md/)` passes against almost any phrasing (the file
literally contains "not PROJECT.md prose" without tripping it) — it pins little.
**Fix:** Add `expect(ingestRules).toMatch(/edition/i)` and pin transcription.md's `edition`
field; consider asserting interview-fallback contains `rulebook/NN-topic.md` as the positive
output pin instead of relying on the negative.

### IN-03: interview-fallback.md cites `instructions.md` line numbers — a file scheduled for deletion, cited outside the bs/-rooted path convention

**File:** `src/cli/slash-command/bs/ingest/interview-fallback.md:7-8`
**Issue:** "(`instructions.md` lines 121-223)" — the range is currently accurate (verified),
but the plan deletes `instructions.md` when the bs- skills ship (scaffold.md:120-122
acknowledges exactly this for the doc list), and the bare name doesn't follow the bs/-rooted
citation convention (`../instructions.md`). Post-deletion this is a dangling line-number
citation.
**Fix:** Reword as historical provenance ("extends the old /design-game skill's Phase 2
sequence, carried over verbatim before that skill's removal") rather than a live file:line
pointer.

### IN-04: Interview path never elicits visual evidence — the survey will be empty by construction

**File:** `src/cli/slash-command/bs/ingest-rules.md:98-100`; `src/cli/slash-command/bs/ingest/interview-fallback.md`
**Issue:** Step 3 item 5 says "whatever visual description the designer volunteers stands in
for `visualEvidence[]`," but the interview's eight questions contain no visual prompt — nothing
invites the designer to volunteer one. For a designer with a physical prototype, real evidence
(prototype colors, art direction) exists and is simply never asked for.
**Fix:** Add one optional light question after Q2 ("Does your prototype have a look — colors,
art style, a vibe you want kept?"), feeding `visualEvidence[]` the same way Q2's proportions
follow-up feeds `componentMentions[]`.

### IN-05: `autoui-with-cutover`'s named cutover chunk is not validated against the Ordered Chunk List

**File:** `src/cli/slash-command/bs/ingest-rules.md:123-126`; `src/cli/slash-command/bs/ingest/sketch-derivation.md:17-28`
**Issue:** Step 5 requires "a scheduled custom-UI cutover chunk named now," and
SKETCH.template.md carries a `Cutover chunk (if autoui-with-cutover): <slug>` field — but
neither sketch-derivation.md's mandated-chunks section nor Step 7 requires that the named slug
actually appear as an entry in the Ordered Chunk List. A dangling cutover slug would pass every
stated check.
**Fix:** Add to sketch-derivation.md section 2: "If UI strategy is `autoui-with-cutover`, the
named cutover slug must appear as an entry in the Ordered Chunk List."

---

_Reviewed: 2026-07-04T22:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
