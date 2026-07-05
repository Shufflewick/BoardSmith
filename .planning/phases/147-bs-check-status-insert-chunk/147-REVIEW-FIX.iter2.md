---
phase: 147-bs-check-status-insert-chunk
fixed_at: 2026-07-04T21:10:00Z
review_path: .planning/phases/147-bs-check-status-insert-chunk/147-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 147: Code Review Fix Report

**Fixed at:** 2026-07-04
**Source review:** .planning/phases/147-bs-check-status-insert-chunk/147-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 critical + 5 warning; IN-01 is Info, out of `critical_warning` scope)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: Mandated-Chunks guard fails to block removal for 2 of 3 mandated chunks

**Files modified:** `src/cli/slash-command/bs/insert-chunk.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** e2762248
**Applied fix:** Rewrote operation (a)'s `## Mandated Chunks` guard to use ONE consistent rule
per mandated chunk that rejects both a `remove` targeting it AND a `reorder` that displaces it —
replacing the three inconsistent verbs ("move off tail" / "displace" / "drop") that let a delete
of the final-acceptance or core-event-loop chunk slip through. Added an explicit statement that a
mandated chunk may only be removed when the user explicitly replaces it in the same role/position,
never as a silent drop. Added a drift-test assertion (`mandated-chunks guard blocks DELETION, not
just reordering`) pinning "reject any remove targeting it", "must remain present", "explicitly
replaces it", and "never a silent drop".

### WR-01: The core reshape mutation (editing the Ordered Chunk List) is never enumerated

**Files modified:** `src/cli/slash-command/bs/insert-chunk.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** 79dd0c0d
**Applied fix:** Added operation (e) "Ordered Chunk List edit — the reshape itself" as a named,
first-class operation, and pinned its write-order placement: the list edit lands in the SAME
`SKETCH.md` write as the version bump (d) — rewrite the list first, then the `Sketch Version:`
line last, per `state-machine.md` "## Write Order". Renamed the section from "The Four Operations"
to "The Operations" and updated the Write Order section and the Close accordingly. Added a
drift-test assertion (`enumerates op (e)`) pinning the named op and its same-SKETCH.md-write
placement.

### WR-05: insert-chunk writes state but never resolves a live session lock

**Files modified:** `src/cli/slash-command/bs/insert-chunk.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** d49bf5ea
**Applied fix:** Added a "Live session-lock check" to Step 0 requiring insert-chunk (a writing
session) to handle a live (non-stale) lock exactly as `build-chunk.md` Step 0 outcome 2 does:
warn the user and STOP before writing if the `Session Lock:` note names a chunk this reshape will
stale-mark or reorder, instead of silently clobbering a concurrent build. Cites
`state-machine.md` "## Session Lock" and the plan's hard rule. Added a drift-test assertion
(`Step 0 resolves a LIVE (non-stale) session lock`).

### WR-02: build-chunk.md forward-ref retirement left a dangling "Phase 147" reference

**Files modified:** `src/cli/slash-command/bs/build-chunk.md`, `src/cli/slash-command/bs/status-tools.test.ts`
**Commit:** dc963b0a
**Applied fix:** Dropped the leftover ", Phase 147" internal-planning reference at build-chunk.md:76.
Tightened the drift test with a new assertion (`leaks no internal planning-phase reference`)
using `expect(buildChunk).not.toMatch(/Phase 147/)` so any dangling phase-number leak fails loudly.

### WR-03: check-status Item 7 has no next-command case for an unstarted or undetailed current chunk

**Files modified:** `src/cli/slash-command/bs/check-status.md`
**Commit:** e4d578bf
**Applied fix:** Broadened Item 7's first case to cover every in-progress state — mid-ceremony,
detailed-but-not-started (zero steps checked), and undetailed sketch-level tail entry — all routing
to `/bs-build-chunk`, so none falls through. Kept the reshape (`/bs-insert-chunk`) and no-project
(`/bs-ingest-rules`) cases as overrides.

### WR-04: check-status Item 3 reads the current chunk's CHUNK.md without the "not yet detailed" guard

**Files modified:** `src/cli/slash-command/bs/check-status.md`
**Commit:** d33ee5b8
**Applied fix:** Added the same "not yet detailed" guard Item 2 uses to Item 3: if the current
chunk is a sketch-level tail entry with no `chunks/<slug>/CHUNK.md`, report
"n/a — current chunk not yet detailed" and skip the `## Revision Rounds` read rather than reading a
file that does not exist.

## Skipped Issues

None. (IN-01 is an Info finding outside the `critical_warning` fix scope and was not attempted.)

## Verification

- `npx vitest run src/cli/slash-command/bs/` — 233 passed (4 files)
- `npm test` — 2631 passed (183 files)

---

_Fixed: 2026-07-04_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
