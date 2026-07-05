---
phase: 147-bs-check-status-insert-chunk
fixed_at: 2026-07-05T02:30:00Z
review_path: .planning/phases/147-bs-check-status-insert-chunk/147-REVIEW.md
iteration: 3
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 147: Code Review Fix Report

**Fixed at:** 2026-07-05T02:30:00Z
**Source review:** .planning/phases/147-bs-check-status-insert-chunk/147-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope: 5 (4 warnings + IN-01, fixed as a one-line reframe)
- Fixed: 5
- Skipped: 0

All fixes are to agent-instruction markdown (`insert-chunk.md`, `check-status.md`) plus the
structural drift-protection test (`status-tools.test.ts`) that pins their load-bearing strings.
Each fix was checked against the canonical sources: `.planning/bs-skills-plan.md`
(§/bs-insert-chunk, §/bs-check-status) and `state-machine.md` "## Session Lock" / "## Write Order".
Verification: `npx vitest run src/cli/slash-command/bs/` → 237 passed (status-tools now 41 tests,
4 new drift assertions); full `npm test` → 183 files / 2635 tests passed.

## Fixed Issues

### WR-01: insert-chunk live-lock guard broadened to any live lock

**Files modified:** `src/cli/slash-command/bs/insert-chunk.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** 0537a4f6
**Applied fix:** Rewrote the Step 0 live session-lock check so it warns-and-stops on ANY live
(non-stale) lock naming in-flight work, not only one naming a chunk the reshape will stale-mark or
reorder. Rationale is stated inline: the reshape rewrites the ENTIRE `## Ordered Chunk List` + the
version stamp, so its write footprint is the whole `SKETCH.md` and can overlap any live build
session's derived-pointer write — matching `state-machine.md` "## Session Lock" (any live lock
naming different work triggers the warning) and build-chunk Step 0 outcome 2. Added a drift
assertion pinning "names ANY chunk", "NOT limited to", and the whole-list footprint wording.

### WR-02: insert-chunk ops enumeration ordered so list edit (e) precedes version bump (d)

**Files modified:** `src/cli/slash-command/bs/insert-chunk.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** 9a5b7665
**Applied fix:** Removed the "runs all of the following, in order" framing that put version-bump
(d) before list-edit (e) — inverting the required write sequence. Rewrote the intro to state that
(a)-(c) run in order, then the single SKETCH.md write rewrites the list (e) FIRST and stamps the
version line (d) LAST per "## Write Order", and physically reordered the two operation blocks so
(e) appears before (d) (letters remain stable IDs). Added an index-comparison drift assertion that
"(e) Ordered Chunk List edit" precedes "(d) Version-stamp bump".

### WR-03: dangling "see the heading below" remove reference repointed to op (e)

**Files modified:** `src/cli/slash-command/bs/insert-chunk.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** 0d1dbcd1
**Applied fix:** Replaced "`remove` is a first-class operation (see the heading below)" — a dangling
intra-file pointer to a nonexistent `remove` heading — with "`remove` is one of the four reshape
types operation (e) performs (add / reorder / split / remove)". Added a drift assertion that
forbids "see the heading below" and pins the new op-(e) phrasing.

### WR-04: check-status Item 2 stale current-chunk carve-out added

**Files modified:** `src/cli/slash-command/bs/check-status.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** 50b6191e
**Applied fix:** Added a stale guard to Item 2 parallel to the not-yet-detailed guard: a current
chunk whose `Status:` reads `stale — re-derive before build` is reported as "stale — needs
re-derivation (run `/bs-insert-chunk` or re-derive)" and its `## Step Checklist` is NOT read for a
"current step", because a stale chunk's checklist is invalid and build-chunk Step 2 stops routing
on it (cited build-chunk "Status Enum and Stale Marker", verified to exist). Added a drift
assertion pinning the stale marker, the re-derivation report string, and "do NOT report a step".

### IN-01: unreachable check-status Item 7 no-SKETCH.md bullet reframed as a note

**Files modified:** `src/cli/slash-command/bs/check-status.md`
**Commit:** 5f67865c
**Applied fix:** One-line change: reframed the dead third bullet (unreachable behind Step 0's early
exit) as an explicit "(Note, not a live branch:)" that documents the no-SKETCH.md case is terminal
at Step 0 and only kept here so the next-command mapping stays complete.

---

_Fixed: 2026-07-05T02:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
