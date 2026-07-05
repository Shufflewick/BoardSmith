---
phase: 146-bs-build-chunk-playtest-revise-close-final-acceptance
fixed_at: 2026-07-05T20:12:00Z
review_path: .planning/phases/146-bs-build-chunk-playtest-revise-close-final-acceptance/146-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 146: Code Review Fix Report

**Fixed at:** 2026-07-05T20:12:00Z
**Source review:** .planning/phases/146-bs-build-chunk-playtest-revise-close-final-acceptance/146-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (3 critical + 4 warning; 2 Info out of `critical_warning` scope)
- Fixed: 7
- Skipped: 0

All fixes are documentation/orchestrator-coherence edits to the `bs-` skill markdown files at
the router seam. There is no runtime code path; correctness is enforced by the
`build-chunk.test.ts` drift-protection suite (now 106 tests, up from 100). The full repo suite
(2588 tests) and the phase drift suite are green, and `grep -c "authored in Phase" build-chunk.md`
is 0.

## Fixed Issues

### CR-01: `build-chunk.md` has no routing rule to dispatch `final-acceptance.md` on resume

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`
**Commit:** 552cc863
**Applied fix:** Added a **Final-acceptance chunk target** rule to Step 2 (Resume Routing): when
the resume target is the sketch's `## Mandated Chunks` final-acceptance chunk, the router routes
against a special Step Checklist (`final-acceptance, playtest, revise, close`) rather than the
plain `full`/`light` list, and dispatches `build/final-acceptance.md` when its leading
`final-acceptance` content step is the first incomplete item. Added a matching **final-acceptance**
content-step dispatch to Step Group 4. This makes a cold session that resumes directly into the
final-acceptance chunk reach `final-acceptance.md` instead of running it as an ordinary chunk.

### CR-02: "in place of" vs "on top of" contradiction for the final-acceptance group

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`
**Commit:** 82949fa0
**Applied fix:** Rewrote the Reference-Files entry (and the new Step 2/Group 4 routing prose) to
the "on top of" model that `final-acceptance.md` already asserts: the design-QA pass runs *as the
content of* the chunk's `{playtest, revise, close}` group and supplies its playtest script; the
standard playtest/revise/close semantics still run on top, never in place of the human
playtest/close of the finished game.

### CR-03: false `## Bookkeeping Sequence` citation for light-path sketch-tail detailing

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`, `src/cli/slash-command/bs/build/playtest.md`
**Commit:** 7360f5f3
**Applied fix:** Removed the "detailing the next 2-3 sketch-level tail entries" clause from both
the `build-chunk.md` light-path note and the `playtest.md` light-path bookkeeping note. The
light-path close bookkeeping now cites the exact **three-item** sequence `state-machine.md` "Step
Names (exact, light path)" lists (verified hash, Status write, decision rollup), and explicitly
states tail re-derivation lives in `close`'s user-gated `## Sketch-Tail Delta Gate` (not run on
the light path) with Step 2's lazy tail-entry detailing covering any undetailed entry instead.

### WR-01: "6-point" → "7-point" design-QA pass

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`
**Commit:** 82effc78
**Applied fix:** Changed "6-point check" to "7-point check" in the `final-acceptance.md`
Reference-Files entry, matching `final-acceptance.md`'s "7-Point Design-QA Pass" title and the
plan's seven enumerated checks.

### WR-02: `CHUNK.template.md` stale 3-category Revision-Rounds comment

**Files modified:** `src/cli/slash-command/bs/templates/CHUNK.template.md`
**Commit:** d649c8d9
**Applied fix:** Rewrote the `## Revision Rounds` HTML comment to describe `revise.md`'s four
triage categories — (a) this-chunk defect recorded here, (b) future scope → Ideas Backlog, (c)
not-built-yet = expectation reset (no write), (d) rules change → RULINGS.md — replacing the stale
three-category text that recorded category (c) as "refuted."

### WR-03: "one revise round" cap vs unbounded revise-2/revise-3 loop

**Files modified:** `src/cli/slash-command/bs/state-machine.md`, `src/cli/slash-command/bs/build-chunk.md`,
`src/cli/slash-command/bs/build/playtest.md`, `src/cli/slash-command/bs/build/revise.md`,
`src/cli/slash-command/bs/build/close.md`, `src/cli/slash-command/bs/build/repair.md`
**Commit:** a4f1e9e3 (label reconciliation) + 85bfe9c3 (close.md line-wrap so the label is a single
substring)
**Applied fix:** Retired the misleading `{playtest, one revise round, close}` label everywhere in
favor of `{playtest, revise, close}`, and clarified in `state-machine.md` and `build-chunk.md`
that the handoff seam wraps the whole group — a single session runs playtest → its revise loop
(`revise-1`, `revise-2`, … until every this-chunk-defect item is dispositioned) → close as one
unit — so the group name's single `revise` denotes the whole loop, not a hard one-round cap.

### WR-04: light-path tail handling left undefined by CR-03's over-claim

**Files modified:** `src/cli/slash-command/bs/build/close.md`
**Commit:** 5fb56f7e
**Applied fix:** Added an explicit statement to `close.md`'s `## Bookkeeping Sequence` that the
light path reuses **only** the three-item sequence and does NOT run the user-gated
`## Sketch-Tail Delta Gate` or `## Propose the Next Chunk` sections, deferring tail re-derivation
and next-chunk proposal to `build-chunk.md` Step 2's lazy detailing or the next full chunk's
`close`.

## Notes

- **Info findings IN-01 and IN-02 were out of scope** (`fix_scope: critical_warning`) and were not
  addressed. IN-01 (the "Step 8/9/10" back-references) is intentionally left intact; IN-02 (the
  5+2 check re-numbering in `final-acceptance.md`) remains a fragility observation, not a defect.
- **Drift-test additions:** a new `describe('UIQ-05 — final-acceptance router coherence ...')`
  block in `build-chunk.test.ts` pins CR-01 (routing rule + `- [ ] final-acceptance` checklist +
  dispatch), CR-02 (on-top-of, no "in place of"), CR-03 (no false tail-detailing citation,
  three-item sequence), WR-01 (7-point, no 6-point), WR-02 (four categories), and WR-03 (no "one
  revise round" cap; `{playtest, revise, close}` label in every file) so these coherence bugs
  cannot silently return.

---

_Fixed: 2026-07-05T20:12:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
