---
phase: 146-bs-build-chunk-playtest-revise-close-final-acceptance
fixed_at: 2026-07-04T20:31:00Z
review_path: .planning/phases/146-bs-build-chunk-playtest-revise-close-final-acceptance/146-REVIEW.md
iteration: 3
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 146: Code Review Fix Report

**Fixed at:** 2026-07-04T20:31:00Z
**Source review:** .planning/phases/146-bs-build-chunk-playtest-revise-close-final-acceptance/146-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope (critical + warning): 5
- Fixed: 5
- Skipped: 0

All five in-scope findings (CR-01 + WR-01..04) share one root cause: the mandated final-acceptance
chunk is a special step-group `[final-acceptance, playtest, revise, close]`, but it is also the last
sketch tail entry, so the generic lazy tail-detailing path pre-empted its detection and filled a
normal full/light checklist. The cluster is fixed coherently across `build-chunk.md`,
`templates/CHUNK.template.md`, `build/close.md`, `build/final-acceptance.md`, and `state-machine.md`,
with new drift-test pins in `build-chunk.test.ts`.

Verification: `grep -c "authored in Phase" build-chunk.md` = 0; the bs slash-command drift suite is
196/196 green (112/112 in build-chunk.test.ts, up from 106 with 6 new pins); full `npm test` is
2594/2594 green (182 files).

## Fixed Issues

### CR-01: Final-acceptance chunk's special 4-item checklist has no author; lazy detailing pre-empts detection

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`, `src/cli/slash-command/bs/templates/CHUNK.template.md`
**Commit:** 21059dc2
**Applied fix:** Reordered Step 2 so the "Final-acceptance chunk target" rule is detected BEFORE
the "Sketch-level tail-entry target" path, and added a carve-out to the tail-entry path pointing
back to it. Made detailing procedural: when the final-acceptance chunk is first detailed, the router
writes `## Ceremony: final-acceptance` and the fixed 4-item Step Checklist
(`final-acceptance / playtest / revise / close`), never the template's full/light list. Added the
recognized third `final-acceptance` variant to CHUNK.template.md's CEREMONY-CONDITIONAL block so the
physical file the router reads legitimately contains the 4-item checklist.

### WR-01: `## Ceremony` undefined for final-acceptance; Step 3 ceremony routing has no carve-out

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`, `src/cli/slash-command/bs/templates/CHUNK.template.md`
**Commit:** 05d115f7
**Applied fix:** Added `final-acceptance` as a valid `## Ceremony` value (`full | light |
final-acceptance`) in CHUNK.template.md with an explanatory comment. Added a Step 3 carve-out in
build-chunk.md: the final-acceptance chunk is exempt from full/light ceremony routing — its step
group is fixed by the Step 2 rule, so `## Ceremony: final-acceptance` skips full/light routing.

### WR-02: `close.md` never creates the next chunk's CHUNK.md, contradicting build-chunk.md's close-gate-duty claim

**Files modified:** `src/cli/slash-command/bs/build/close.md` (build-chunk.md wording corrected within the CR-01 reorder)
**Commit:** a4970d62 (close.md); the false "detailing is normally the previous chunk's close-gate
duty" claim in build-chunk.md was removed as part of the CR-01 Step 2 reorder (commit 21059dc2)
**Applied fix:** Chose the simpler, reality-matching option (per the review's recommendation):
detailing always happens lazily in Step 2. build-chunk.md now states plainly that `close` never
creates a next chunk's CHUNK.md. Added an explicit paragraph to close.md's `## Propose the Next
Chunk` stating close does NOT create the next chunk's `chunks/<slug>/CHUNK.md` — it owns only tail
*description* re-derivation and the next-chunk proposal; CHUNK.md creation is Step 2's lazy path.

### WR-03: final-acceptance step group oversized and content step not sub-step resumable

**Files modified:** `src/cli/slash-command/bs/build/final-acceptance.md`, `src/cli/slash-command/bs/build-chunk.md`, `src/cli/slash-command/bs/state-machine.md`
**Commit:** 54f5a84a
**Applied fix:** Added a "Sub-Step Resumability and the Handoff Seam Before `playtest`" section to
final-acceptance.md establishing an extra handoff seam (final-acceptance content step is its own
session; `{playtest, revise, close}` is the next) and per-sub-part persistence (coverage result,
each agent-dispatch finding in `## Findings Ledger`, each human-narrated check) so a mid-pass crash
resumes mid-pass rather than re-dispatching. Cited from build-chunk.md's group-4 note and documented
the exception in state-machine.md's "Session Handoff Seams".

### WR-04: light-path/close citations name a heading that isn't byte-exact

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`, `src/cli/slash-command/bs/build/playtest.md`, `src/cli/slash-command/bs/build/close.md`
**Commit:** 47437c02
**Applied fix:** Corrected all citations from `"Step Names (exact, light path)"` to the byte-exact
heading `"Step Names (exact, light path — trivial chunks)"` (state-machine.md:29). Two occurrences
in build-chunk.md, one in playtest.md, one (multi-line) in close.md.

### Drift-test pins

**Files modified:** `src/cli/slash-command/bs/build-chunk.test.ts`
**Commit:** 0ec1f3e0
**Applied fix:** Added a new `describe` block pinning: (1) final-acceptance detection runs before the
generic lazy tail-entry detailing and the tail-entry path carries the carve-out; (2) CHUNK.template.md
recognizes the `final-acceptance` ceremony and its 4-item variant; (3) Step 3 exempts the chunk from
full/light ceremony routing; (4) close.md's corrected close-duty statement and build-chunk.md's
removal of the false close-gate-detailing claim; (5) the handoff seam + sub-step resumability; (6)
the byte-exact light-path citation heading in all three citing files matching state-machine.md's
actual heading. Suite grew 106 → 112, all green.

---

_Fixed: 2026-07-04T20:31:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
