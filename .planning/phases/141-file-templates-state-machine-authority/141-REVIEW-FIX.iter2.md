---
phase: 141-file-templates-state-machine-authority
fixed_at: 2026-07-04T21:15:00Z
review_path: .planning/phases/141-file-templates-state-machine-authority/141-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 141: Code Review Fix Report

**Fixed at:** 2026-07-04T21:15:00Z
**Source review:** .planning/phases/141-file-templates-state-machine-authority/141-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (2 Critical, 7 Warning; 3 Info findings out of scope per fix_scope=critical_warning)
- Fixed: 9
- Skipped: 0

Verification: `npx vitest run src/cli/slash-command/bs/templates.test.ts` — 41/41 pass (was 27; 14 new drift tests). Full `npm test` — 179 files, 2427 tests, all pass. `tsc --noEmit` reports no errors in any file touched by these fixes (pre-existing errors in unrelated test files were present before and after).

## Fixed Issues

### CR-01: CHUNK.template.md parse contract omits "## Newly Discovered Citations"

**Files modified:** `src/cli/slash-command/bs/templates/CHUNK.template.md`
**Commit:** db70239e
**Applied fix:** Added `"## Newly Discovered Citations"` to the PARSE CONTRACT heading list between `"## Visibility Declaration"` and `"## Findings Ledger"`, matching the skeleton's actual headings. The WR-07 drift test now verifies contract-vs-actual headings for all six templates, so this defect class fails CI.

### CR-02: Consistency check guaranteed to false-positive on sketch tail chunks

**Files modified:** `src/cli/slash-command/bs/state-machine.md`, `src/cli/slash-command/bs/templates/SKETCH.template.md`
**Commit:** a3c78e85
**Applied fix:** Chose option (b) per the plan ("Only the next 2-3 chunks are detailed; the tail stays sketch-level" — ingest does NOT create stub directories). Consistency-check item 1 now exempts tail entries; SKETCH tail entries use the machine-distinguishable marker `- Status: proposed (sketch-level — no CHUNK.md yet)`, with a comment stating the directory + CHUNK.md are created (and the Status line rewritten to the derived form) when the entry is detailed at a close gate. Decision recorded in both files.

### WR-01: Relative references dangle after instantiation

**Files modified:** all six templates (`SKETCH`, `CHUNK`, `RULINGS`, `DECISIONS`, `DESIGN`, `ASSETS` `.template.md`)
**Commit:** 8360e7eb
**Applied fix:** Replaced every `../state-machine.md` with the logical name `state-machine.md` and added a note at the top of each template stating it refers to the bs- skills' shared reference file installed alongside the skills. Decision recorded in each template: state-machine.md is NOT copied into game projects (a copy would drift from the shipped authority — the exact drift this phase prevents). Cross-template references changed to instantiated names: `DESIGN.template.md "Placeholder Policy"` → `DESIGN.md "Placeholder Policy"` (ASSETS), `see ASSETS.template.md` → `see ASSETS.md` (DESIGN).

### WR-02: Light-path status transitions undefined; light checklist requires restructuring

**Files modified:** `src/cli/slash-command/bs/state-machine.md`, `src/cli/slash-command/bs/templates/CHUNK.template.md`
**Commit:** f83fafe8
**Applied fix:** state-machine.md now defines light-path transitions: `approved` is unreachable for light chunks; they move `proposed → built` directly when the user accepts the proposal (the ask-equivalent gate) and build+test complete, then `built → verified` at playtest as usual. CHUNK.template.md's Step Checklist is now ceremony-conditional by contract: exactly one checklist matching the declared Ceremony, with the three exact light-path items given, and an explicit statement that writing the checklist to match the declared ceremony at proposal time is filling, not restructuring.

### WR-03: Cutover scope contradicts the canonical plan

**Files modified:** `src/cli/slash-command/bs/state-machine.md`, `src/cli/slash-command/bs/templates/SKETCH.template.md`
**Commit:** b7167311
**Applied fix:** Aligned to the plan (bs-skills-plan.md line 115): the UI-strategy cutover explicitly flips ALL previously verified chunks back to `built` and re-opens their test scripts (the total case). The general restyle rule and DESIGN.md changes flip the chunks whose verified surfaces are affected. Both state-machine.md's Restyle/Cutover Rule and SKETCH.template.md's UI Strategy reminder now state this distinction.

### WR-04: `close` belongs to no session handoff step group

**Files modified:** `src/cli/slash-command/bs/state-machine.md`
**Commit:** 87ada693
**Applied fix:** Group 4 is now `{playtest, one revise round, close}`, with a rationale note (close is cheap; splitting it off would leave a verified-but-unclosed chunk across a handoff) and an explicit statement that every one of the 10 steps belongs to exactly one group. (The plan shares the original gap; state-machine.md is the shipping authority and resolves it.)

### WR-05: "Stale session lock" has no staleness criterion

**Files modified:** `src/cli/slash-command/bs/state-machine.md`
**Commit:** 5f015dcd
**Applied fix:** Added a staleness criterion to the Session Lock section: a lock older than 24 hours is stale (reported; user confirms clearing); a lock naming the same chunk the entering session resumes is not stale (the session refreshes the timestamp — the normal resume path, false-positive-free); any other lock is treated as a live concurrent session and warns. Note: the 24-hour threshold is a judgment call — the plan is silent on a number; chosen to keep cold resumes across days from warning spuriously while still catching crashed sessions.

### WR-06: Status-line grammar ambiguous across state files

**Files modified:** `src/cli/slash-command/bs/state-machine.md`, `src/cli/slash-command/bs/templates/SKETCH.template.md`
**Commit:** a5398576
**Applied fix:** (1) Scoped the Cold-Resume sentence: only CHUNK.md and SKETCH.md's derived pointers carry a status; RULINGS/DECISIONS/DESIGN/ASSETS carry none and their contracts don't require one. (2) Defined the exactly-two SKETCH Status-line forms (derived long form for detailed entries; sketch-level marker for tail entries, rewritten to the long form on detailing) in both files — the `(derived from ...)` qualifier is the machine-distinguishing feature. (3) Consistency-check item 3 now enumerates the three recognized value classes: the Status Enum, the CHUNK-level stale marker, and the SKETCH tail sketch-level marker; anything else is a parse failure.

### WR-07: Drift-test gaps let core contract strings mutate without failing CI

**Files modified:** `src/cli/slash-command/bs/templates.test.ts`
**Commit:** 8ff281c5
**Applied fix:** Added a single-source-of-truth `STATUS_ENUM_VALUES` array from which both pinned enum lines are derived (state-machine.md's backticked form and the templates' plain form incl. the stale marker) — asserted verbatim in state-machine.md, CHUNK.template.md, and SKETCH.template.md, replacing the bare-word containment checks. Pinned the exact ASSETS ledger header row `| needed-by-chunk | requested | received | placeholder-in-use | file path |`. Added a new suite comparing each template's actual H2 headings (exact, in order, deep-equal) against a hardcoded expected list AND asserting the PARSE CONTRACT comment enumerates every shipped heading in order — the CR-01 defect class now fails in both directions. Added SKETCH machine-anchor assertions (`Sketch Version:`, `Session Lock:`, stale marker with hyphen-regression guard, sketch-level tail marker). 27 → 41 tests, all passing.

## Skipped Issues

None — all in-scope findings were fixed. (IN-01, IN-02, IN-03 are Info-severity and out of scope for fix_scope=critical_warning.)

---

_Fixed: 2026-07-04T21:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
