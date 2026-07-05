---
phase: 142-bs-ingest-rules
fixed_at: 2026-07-04T15:32:00-07:00
review_path: .planning/phases/142-bs-ingest-rules/142-REVIEW.md
iteration: 3
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 142: Code Review Fix Report

**Fixed at:** 2026-07-04T15:32:00-07:00
**Source review:** .planning/phases/142-bs-ingest-rules/142-REVIEW.md (iteration-2 review)
**Iteration:** 3

**Summary:**
- Findings in scope: 7 (2 Critical, 5 Warning; fix_scope=critical_warning — IN-01..IN-05 out of scope)
- Fixed: 7
- Skipped: 0

All fixes verified against the drift test after each commit (`ingest.test.ts` 41/41 after
CR-01's new pin) and against the full suite after the last commit: 180 files / 2470 tests green
(`npx vitest run src/cli/slash-command/bs/` — 2 files, 84 tests — and `npm test` both pass).
Fixes were applied in an isolated worktree and fast-forwarded onto `main`.

## Fixed Issues

### CR-01: Visual identity survey has no durable write target

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`, `src/cli/slash-command/bs/ingest/transcription.md`, `src/cli/slash-command/bs/ingest.test.ts`
**Commit:** 340541f1
**Applied fix:** Chose `rulebook/00-visual-survey.md` as the durable home (the plan's artifact
table has no dedicated survey row; the plan calls it ingest evidence consumed by the first UI
chunk's ask, and rulebook/ is where ingest's evidence artifacts live — `00` cannot collide with
page-anchored slice numbering since pages start at 1, nor with the interview path's question
numbering, which starts at Q1). Step 3 item 5 now writes the survey there alongside
INDEX.md/ASSETS.md (factual evidence, pre-approval, consistent with Step 7's carve-out), with
the rationale that its consumer — the first UI chunk's design `ask` — is a later fresh-context
session. Step 7's write list now names it in the already-written-at-Step-3 bullet (do not
re-write). transcription.md's orchestrator-records item 4 names the file as the durable handoff.
Added a drift-test pin asserting both files contain `rulebook/00-visual-survey.md` (40 tests →
41 after subsequent count; test named "gives the survey a durable write target consumed by the
first UI chunk ask (CR-01)").

### CR-02: Migration path produces no rulebook/ slices

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** d6ee93aa
**Applied fix:** Step 0's migration case no longer routes straight to Step 3 with raw old-project
content. It now converts the old interview/PROJECT.md content into the standard `rulebook/`
shape first — `rulebook/NN-topic.md` slices grouped by topic per interview-fallback.md's
"Output Re-Target" mechanism, citation format `designer statement, migrated from /design-game
project` — collecting `citedTerms[]`/`componentMentions[]` while writing, exactly as the
interview path does, so Step 3 runs unchanged. Explicitly states the input-path identity
invariant now covers migration ("Migration is never a fourth shape") so downstream
`/bs-build-chunk` citation reads always find real slice files.

### WR-01: Transcription subagent prompt under-parameterized

**Files modified:** `src/cli/slash-command/bs/ingest/transcription.md`
**Commit:** 6f4887f2
**Applied fix:** The prompt template now opens "Transcribe pages {N}-{M} of the rulebook at
`{rulebookPath}`" with orchestrator-facing instructions to fill the path (fresh-context
subagents inherit nothing). Added the page-count-source sentence: total page count comes from
the user or file metadata (file listing / PDF metadata), never from opening the rulebook
content. The `edition` field is now an explicit quoted line the orchestrator appends to the
opening-range dispatch's prompt only, so it is actually communicated to that subagent rather
than existing only in orchestrator-facing prose. The review's missing-`{base}`-placeholder
point is resolved by WR-02's scheme (below), which eliminates the numbering-base concept
entirely rather than parameterizing it.

### WR-02: Slice-numbering base scheme unspecified — parallel collisions

**Files modified:** `src/cli/slash-command/bs/ingest/transcription.md`
**Commit:** 73465a61
**Applied fix:** Adopted the review's page-anchored scheme: `NN` = the section's zero-padded
starting page number, stated directly inside the prompt template (example updated from
`rulebook/03-movement.md` to `rulebook/14-movement.md`, matching the template's existing
"p.14, Movement:" citation example). Added an orchestrator-facing paragraph explaining why
it is self-allocating (no coordination between parallel ranges, sorts in page order),
explicitly forbidding sequential numbering-base schemes (with the review's duplicate-prefix
failure mode named), covering same-page section collisions (topic name disambiguates; a
range never splits mid-page), reserving `00` for the visual survey, and noting the interview
path's question-group numbering is mutually exclusive with this scheme.

### WR-03: State detection misses the partial-ingest crash state

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** 8ebe85e5
**Applied fix:** Step 0 is now four cases. New case 2 "Interrupted ingest" fires when
`rulebook/` or `ASSETS.md` is present without `SKETCH.md`: STOP and ask the user to resume
from the existing slices (skip Steps 1-2, re-run Step 3 onward) or discard and restart
(delete the partial artifacts; `init` already ran, so only re-verify). Case 1's "fresh"
condition tightened to also require no `rulebook/` and no `ASSETS.md` so it can no longer
match a half-ingested project (the nested `<name>/<name>/` + re-transcription failure mode
is named in the case text). The migration case (now case 4) adds "no `rulebook/`" to its
condition so the trio can never shadow or be shadowed by case 2.

### WR-04: Display Name contradiction with the CLI's lossy derivation

**Files modified:** `src/cli/slash-command/bs/ingest/scaffold.md`
**Commit:** 7eae2219
**Applied fix:** Added a "Display Name correction" step immediately after `init` succeeds:
compare `boardsmith.json`'s `displayName` (set by `init` via the lossy
kebab-case-round-trip `toDisplayName` — "The Duke's Gambit" → `the-duke-s-gambit` →
"The Duke S Gambit") to the name as the designer wrote it; if they differ, edit
`boardsmith.json` to the designer's original. The earlier "do not re-derive those two" line
was narrowed to the Class name only, with a forward pointer to the correction, resolving the
contradiction: Display Name is user-facing verbatim text and is reconciled; Class name is
never re-derived.

### WR-05: Installed location of templates never stated

**Files modified:** `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** 65c563d2
**Applied fix:** Added an "Installed location" paragraph to the Reference Files section: every
relative path (`ingest/`, `state-machine.md`, `templates/`) resolves against the directory
containing the skill file itself — the `bs/` tree is copied as one unit, so the layout is
identical wherever installed; Step 7's template "copy" resolves from the skill file's own
directory, never the game project or cwd. Because `src/cli/commands/install-claude-command.ts`
does not yet install the bs- skills (verified — it only handles design-game/generate-ai), the
paragraph carries an explicit installer-phase dependency note: the phase that adds bs-
installation MUST preserve this skill-file-relative layout or update the paragraph. This
closes the templates' dangling "the skill instructions state its installed location" promise.

## Verification

- Per-fix: `npx vitest run src/cli/slash-command/bs/ingest.test.ts` after every commit — 41/41
  (40 pre-existing + 1 new CR-01 pin).
- Directory: `npx vitest run src/cli/slash-command/bs/` — 2 files, 84 tests, green.
- Full suite: `npm test` — 180 files, 2470 tests, green.

---

_Fixed: 2026-07-04T15:32:00-07:00_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
