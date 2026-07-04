---
phase: 142-bs-ingest-rules
fixed_at: 2026-07-04T15:17:00-07:00
review_path: .planning/phases/142-bs-ingest-rules/142-REVIEW.md
iteration: 1
findings_in_scope: 14
fixed: 14
skipped: 0
status: all_fixed
---

# Phase 142: Code Review Fix Report

**Fixed at:** 2026-07-04T15:17:00-07:00
**Source review:** .planning/phases/142-bs-ingest-rules/142-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 14 (6 Critical, 8 Warning; fix_scope=critical_warning — IN-01/IN-02 out of scope)
- Fixed: 14
- Skipped: 0

All fixes were resolved in the direction the canonical contract (`.planning/bs-skills-plan.md`
§ingest) specifies. Each fix was verified against the drift test (`ingest.test.ts`); after all
fixes: `ingest.test.ts` 39/39, `templates.test.ts` 44/44, full suite 180 files / 2469 tests green.

## Fixed Issues

### CR-06: rulebook/ slices were written before the project directory existed

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`, `src/cli/slash-command/bs/ingest/transcription.md`, `src/cli/slash-command/bs/ingest/interview-fallback.md`, `src/cli/slash-command/bs/ingest/scaffold.md`
**Commit:** 1fa04b25
**Applied fix:** Took the review's "cleaner fix" (reorder): Scaffold + Verify is now Step 1, before
transcription/interview (Step 2) and synthesis (Step 3). Step 0 now frames the fresh-directory case
as the parent directory; after `init` verifies, the session `cd`s into `<name>/` and every artifact
write targets the project. All four files' step-number cross-references updated; transcription.md
and interview-fallback.md state explicitly that slice writes target the scaffolded project, never
the parent. (Applied first because it renumbers steps that other fixes reference.)

### CR-02: Migration path routed to a mislabeled step

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** a3119749
**Applied fix:** With the CR-06 renumbering, Synthesis is genuinely Step 3. The migration case now
explicitly skips Step 1 (Scaffold) entirely — the old project is already scaffolded and `init`
hard-fails on an existing directory — optionally re-running only the compile/serve verification
portion (no `init`), and skips Step 2, proceeding to Step 3 with the old project's captured content.

### CR-01: SKETCH.md written before the approval gate, then clobbered by a skeleton copy

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** 67a67ab8
**Applied fix:** Steps 4-5 now produce an in-conversation proposal only ("do not write SKETCH.md
yet — a rejection at Step 6 must leave no sketch state on disk to undo"). Step 7 is the single
write point, gated on Step 6's explicit approval, with copy-and-fill as one operation per file and
an explicit prohibition on copying a blank skeleton over a filled file.

### CR-03: Slice-writing responsibility contradicted; sectionText defeated context economics

**Files modified:** `src/cli/slash-command/bs/ingest/transcription.md`, `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** e2ee2f99
**Applied fix:** Resolved in the plan's direction: transcription subagents write `rulebook/NN-topic.md`
directly; the return shape drops `sectionText` and becomes `{ slicePath, sectionSummary, citedTerms[],
componentMentions[] }` (later extended by CR-04/WR-08). Per-section confirmation is driven from the
short `sectionSummary`; user corrections dispatch a narrow follow-up subagent to amend the written
slice. "Orchestrator Writes" became "Orchestrator Records (never writes slices, never re-reads them)".
ingest-rules.md's Step 2 routing note now states the full text never enters orchestrator context.

### CR-04: Visual identity survey had no data source

**Files modified:** `src/cli/slash-command/bs/ingest/transcription.md`, `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** 57ca0a9d
**Applied fix:** Subagent prompt gains `visualEvidence[]` (palette/typography/iconography/art
observations plus descriptions of setup diagrams and embedded component images, with citations),
with the instruction to also weave diagram descriptions into the slice text (per the plan's Input
modes requirement). Step 3 item 5 builds the survey exclusively from accumulated `visualEvidence[]`,
parallel to INDEX.md-from-`citedTerms[]`; interview path uses designer-volunteered descriptions.

### CR-05: DESIGN.md created at ingest against Phase 141's template and the plan

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** 56e52c24
**Applied fix:** Step 7 no longer copies "six skeletons". It writes SKETCH.md, the detailed first
chunks' CHUNK.md files, and seeds RULINGS.md/DECISIONS.md as empty ledgers — documented as a
deliberate choice (later gates append rather than decide whether to create). It explicitly does
NOT create DESIGN.md, citing DESIGN.template.md's header and the file-existence trigger
`/bs-build-chunk`'s first-UI-chunk design ask depends on. ASSETS.md is noted as already seeded at
Step 3 (factual inventory, not gated sketch state) and is not re-copied.

### WR-01: Rulebook edition had no recording location and no data source

**Files modified:** `src/cli/slash-command/bs/ingest/transcription.md`, `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** 0621dbee
**Applied fix:** Home: a header line in `rulebook/INDEX.md` (e.g. `Edition: 2nd edition, 2019
printing`). Source: the opening-pages transcription subagent returns an `edition` field (cover/title
page/colophon; null → ask the user); interview path records `Edition: unpublished — designer
statement`. Chosen over a SKETCH.md field to avoid touching Phase 141's template parse contract and
because the edition anchors the transcription, so it belongs with the rulebook index.

### WR-08: Variant tagging responsibility contradicted between Step 2 and transcription.md

**Files modified:** `src/cli/slash-command/bs/ingest/transcription.md`, `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** c7f63af8
**Applied fix:** In-slice tagging is now explicitly the subagent's job at write time (inline
`> Variant:` note), reported via a new `variants[]` return field (name + citation). The synthesis
step's only variant job is building SKETCH.md's "Variants (deferred)" listing from the accumulated
`variants[]` — the orchestrator never edits or re-reads a slice. (Committed after WR-01 because both
edit Step 3 item 2 and the return-shape block.)

### WR-02: Interview missed setup/actions topics and could not populate aspect ratios

**Files modified:** `src/cli/slash-command/bs/ingest/interview-fallback.md`
**Commit:** ef7e0f13
**Applied fix:** Added Question 3 (Setup) and Question 5 (Actions) with the same one-at-a-time
cadence and altitude discipline; renumbered Turn Structure/Round/Game End/Summary to Q4/Q6/Q7/Q8;
extended Q2 with a light per-component proportions follow-up feeding `componentMentions[]` aspect
ratios; summary block gains Setup and Actions lines; output re-target mapping gains
`rulebook/03-setup.md` / `rulebook/05-actions.md` examples. Header no longer claims "same six
questions" — it states the two plan-required additions and why.

### WR-03: Misleading claim that CLI helpers implement the name-derivation algorithm

**Files modified:** `src/cli/slash-command/bs/ingest/scaffold.md`
**Commit:** f0528c2b
**Applied fix:** Reworded per the review (verified against `project-scaffold.ts:83-99`): the agent
MUST kebab-case the Project Name itself — `boardsmith init` does not sanitize its argument;
`toPascalCase`/`toDisplayName` split only on `-`/`_` and derive Class/Display names from an
already-kebab-cased name, so those two are not re-derived.

### WR-04: `aspects/index.md` was a dangling relative path from the bs/ tree

**Files modified:** `src/cli/slash-command/bs/ingest/interview-fallback.md`, `src/cli/slash-command/bs/ingest.test.ts`
**Commit:** 58750399
**Applied fix:** All three citations now read `../aspects/index.md` (resolvable from bs/, matching
the file set's path convention). Drift test gains two checks: interview-fallback.md cites the
resolvable path, and `../aspects/index.md` exists on disk.

### WR-05: Required Reading pointer cited instructions.md, which the plan deletes at ship

**Files modified:** `src/cli/slash-command/bs/ingest/scaffold.md`
**Commit:** 6ad142c3
**Applied fix:** The doc list is now cited by the docs' own names directly (`docs/core-concepts.md`,
`docs/common-pitfalls.md` always; `docs/actions-and-flow.md`, `docs/custom-ui-guide.md`,
`docs/ui-components.md`, `docs/dice-and-scoring.md` by need — all six verified to exist), with an
explicit note that `instructions.md` is deleted when the bs- skills ship and the docs are the
durable reference. No line-number citations into a doomed file remain.

### WR-06: UI strategy "recorded into templates/SKETCH.template.md" — the shipped template

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** c24490de
**Applied fix:** Step 5 now says the decision lands in the proposed sketch's `## UI Strategy`
section (skeleton from `templates/SKETCH.template.md`; "never edit the shipped template itself")
and is written to the game project's `SKETCH.md` at Step 7 — resolved together with CR-01's
single-write-point decision as the review directed.

### WR-07: Drift-test gaps — CLI strings, aspects path, cross-citations, return shape unpinned

**Files modified:** `src/cli/slash-command/bs/ingest.test.ts`, `src/cli/slash-command/bs/ingest/scaffold.md`
**Commit:** 65071d1f
**Applied fix:** Removed the rot-prone raw line numbers (`init.ts:19`, `dev.ts:788`, `dev.ts:791`)
from scaffold.md prose (file-path citations remain). Added three test groups: (1) CLI string pins —
reads `../../commands/init.ts` / `../../commands/dev.ts` and asserts the already-exists error, the
`--no-open` skip message, and the load-bearing `Ready! Press Ctrl+C to stop.` line exist in source
AND are quoted by scaffold.md; (2) reference-file cross-citations (transcription.md →
ASSETS.template.md, sketch-derivation.md → SKETCH.template.md, scaffold.md → project-scaffold.ts)
each cited and existing on disk; (3) the full return-shape field list (`slicePath`, `sectionSummary`,
`citedTerms[]`, `componentMentions[]`, `visualEvidence[]`, `variants[]`) pinned across
transcription.md / ingest-rules.md / interview-fallback.md. Test count: 28 → 39, all green.

## Out of Scope (not skipped — excluded by fix_scope=critical_warning)

- IN-01 (stale Wave-0 narration in the test header) — Info tier.
- IN-02 (weak negative assertions) — Info tier. Note: WR-07's positive pins partially mitigate this.

---

_Fixed: 2026-07-04T15:17:00-07:00_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
