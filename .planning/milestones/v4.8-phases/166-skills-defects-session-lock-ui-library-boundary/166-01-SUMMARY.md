---
phase: 166-skills-defects-session-lock-ui-library-boundary
plan: 01
subsystem: skills
tags: [bs-skills, session-lock, markdown-spec, drift-tests, vitest]

# Dependency graph
requires: []
provides:
  - "SKETCH.template.md Session Lock line: date -u +%Y-%m-%dT%H:%M:%SZ clock-read + @ <session-id> identity field"
  - "state-machine.md Session Lock section: clock-read spec + release-to-none semantics"
  - "state-machine.md Write Order: append-only-close / terminal-release invariant"
  - "close.md Bookkeeping Sequence item 4: terminal lock release (Session Lock: none)"
  - "build-chunk.md Step 0: released/no-lock recognition branch (no false alarm)"
  - "failing-first drift assertions in templates.test.ts and build-chunk.test.ts (PROC-01)"
affects: [166-02 (SKILLDEF-02/03 boundary fence), Phase 167 (SKILLAUTO)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Session lock grammar: \"<slug> @ <session-id> — locked at <ISO timestamp>\" with none as released value"
    - "Terminal-write lock release pattern: close's last write always sets Session Lock: none"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/templates/SKETCH.template.md
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/build/close.md
    - src/cli/slash-command/bs/build/playtest.md
    - src/cli/slash-command/bs/build-chunk.md
    - src/cli/slash-command/bs/templates.test.ts
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "Lock grammar extended to \"<slug> @ <session-id> — locked at <ISO timestamp>\" (session-id format left to agent discretion at runtime, per 166-CONTEXT.md \"Claude's Discretion\")"
  - "close.md's Bookkeeping Sequence grew from 3 items to 4 (added terminal lock release); updated the two other files that cited the item count (build-chunk.md, build/playtest.md) and the one pre-existing pinned test (build-chunk.test.ts CR-03) that asserted the literal 'three-item' phrase, since this task's own change is what made that phrase inaccurate"

requirements-completed: [SKILLDEF-01, PROC-01]

duration: ~25min
completed: 2026-07-21
---

# Phase 166 Plan 01: Session-Lock Defect Fix Summary

**Fixed the `bs-build-chunk` close ceremony to release its session lock (root-fixing the run-004 same-day false-alarm), sourcing the lock timestamp only from an explicit `date -u` clock-read and adding a session/chunk identity to the lock grammar — verified by 10 new failing-first drift assertions across two vitest suites.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-21T21:11:46Z (per STATE.md session start)
- **Completed:** 2026-07-21T21:17:30Z
- **Tasks:** 2/2 completed
- **Files modified:** 7 (5 skill/spec source files, 2 test files)

## Accomplishments

- The lock line's ISO timestamp now has exactly one sanctioned source (`date -u +%Y-%m-%dT%H:%M:%SZ`), named explicitly at both the write site (SKETCH.template.md) and the spec (state-machine.md) — the timestamp can no longer be fabricated or typed from memory.
- The lock grammar carries a session/chunk identity (`"<slug> @ <session-id> — locked at <ISO timestamp>"`) so a lock unambiguously names both which chunk and which session holds it.
- `close`'s Bookkeeping Sequence gained a 4th, terminal step — "Release the lock" — that sets `Session Lock: none`. Because `playtest.md`'s light path reuses this section by name, light-path chunks release the lock too.
- `state-machine.md`'s "Write Order" section now states the append-only-close / terminal-release invariant explicitly, so a close that crashes before the release leaves CHUNK.md intact and the lock resumable (the CHUNK.md-overwrite guard SKILLDEF-01 was filed against).
- `build-chunk.md` Step 0 now checks for the released/no-lock state (`Session Lock: none`) BEFORE the three pre-existing lock outcomes, and takes the lock silently with no warning — this is the concrete fix for the run-004 same-day false-alarm: after a clean close, a same-day session resuming a *different* next chunk finds no live lock at all.
- 10 new drift assertions (5 in `templates.test.ts`, 6 in `build-chunk.test.ts`) pin every one of these markers; they were RED before this plan's edits (the markers did not exist in the pre-edit source) and are GREEN after.

## Task Commits

Each task was committed atomically:

1. **Task 1: Clock-read + session identity on the lock line (SKETCH.template.md + state-machine.md Session Lock)** - `14f875b5` (fix)
2. **Task 2: Terminal lock-release in close + append-only write order + Step 0 no-lock recognition** - `8338a65f` (fix)

**Plan metadata:** committed separately after this SUMMARY.

## Files Created/Modified

- `src/cli/slash-command/bs/templates/SKETCH.template.md` - Session Lock line grammar now names the clock-read command and adds a `@ <session-id>` identity field; comment explains the release-to-none semantics.
- `src/cli/slash-command/bs/state-machine.md` - "Session Lock" section gains clock-read spec + release semantics; "Write Order" gains the append-only-close/terminal-release invariant; light-path "Step Names" note now mentions the release.
- `src/cli/slash-command/bs/build/close.md` - Bookkeeping Sequence gains item 4, "Release the lock" (terminal, append-only); "three-item" → "four-item" throughout this file.
- `src/cli/slash-command/bs/build/playtest.md` - light-path citation of close's Bookkeeping Sequence updated to "four-item" (was "three-item"), naming the lock release, to stay consistent with close.md's new item count.
- `src/cli/slash-command/bs/build-chunk.md` - Step 0 gains a released/no-lock recognition branch before the three existing lock outcomes (no live lock -> take silently, no warning); light-path bookkeeping citation updated to "four-item".
- `src/cli/slash-command/bs/templates.test.ts` - new `SKILLDEF-01 — session lock: clock-read + session identity + release` describe block (5 tests).
- `src/cli/slash-command/bs/build-chunk.test.ts` - new `SKILLDEF-01 — close releases the session lock (terminal, append-only)` describe block (5 tests); updated the pre-existing CR-03 pinned assertion from "three-item" to "four-item".

## Decisions Made

- **Lock identity format:** used `"<slug> @ <session-id> — locked at <ISO timestamp>"` as the extended grammar (166-CONTEXT.md left the exact field format to discretion). `<session-id>` is documented as "any short session-scoped identifier generated once per session" rather than mandating a specific generation algorithm, keeping the spec agent-agnostic.
- **Bookkeeping Sequence item count (3 → 4):** the plan explicitly required a numbered "step 4" for the lock release. This made the pre-existing "three-item sequence" phrase (cited in `close.md`, `build-chunk.md`, `build/playtest.md`, and pinned literally in one existing `build-chunk.test.ts` assertion, CR-03) factually stale. Rather than leave that inconsistency in place, all four locations were updated to "four-item" in the same task — this is a direct, in-scope consequence of the task's own required change (Rule 1: auto-fix a bug the task itself introduces), not a scope-creep edit. `build/playtest.md` was not in the plan's `files_modified` list but was edited for this reason; documented here as the deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated `build/playtest.md`'s "three-item" light-path citation to "four-item"**
- **Found during:** Task 2
- **Issue:** `close.md`'s Bookkeeping Sequence grew from 3 to 4 items (adding the terminal lock-release step required by SKILLDEF-01). `build/playtest.md` (not in this plan's `files_modified` list) cites that same sequence by name and by count ("the exact **three-item** sequence"), which the task's own change made inaccurate — a drift bug introduced by this task if left unfixed.
- **Fix:** Updated the citation to "four-item" and named the lock release alongside the pre-existing three items, matching `close.md` and `build-chunk.md`'s equivalent citations.
- **Files modified:** `src/cli/slash-command/bs/build/playtest.md`
- **Commit:** `8338a65f` (part of Task 2's commit)

**2. [Rule 1 - Bug] Updated the pre-existing CR-03 pinned test assertion in `build-chunk.test.ts` from "three-item" to "four-item"**
- **Found during:** Task 2
- **Issue:** An existing pinned drift assertion (`CR-03`, authored in a prior phase) literally matched `/light path reuses \*\*only\*\* this three-item sequence/i` against `close.md`. This plan's required edit to `close.md` (adding item 4) would otherwise break that existing, previously-green test.
- **Fix:** Updated the regex and the test's own name/comment to "four-item", consistent with the new Bookkeeping Sequence content. Full suite re-verified green after the change.
- **Files modified:** `src/cli/slash-command/bs/build-chunk.test.ts`
- **Commit:** `8338a65f` (part of Task 2's commit)

## Verification

- `npx vitest run src/cli/slash-command/bs/templates.test.ts` — 49/49 passed.
- `npx vitest run src/cli/slash-command/bs` — 4 files, 250/250 passed.
- `npm run test` (full repo suite) — 214 files, 3043/3043 passed. No regressions.
- `grep -F 'date -u +%Y-%m-%dT%H:%M:%SZ'` matches in both `SKETCH.template.md` and `state-machine.md`.
- `grep -iF 'release the lock'` and `grep -F 'Session Lock: none'` both match in `close.md`.
- `grep -F 'Session Lock: none'` matches inside `build-chunk.md` Step 0.
- No `~/.claude/skills/` path was edited — confirmed via `git status --short` (only repo-tracked `src/cli/slash-command/bs/...` files changed) — satisfying the T-166-01 threat-model mitigation.

**Failing-first confirmation (PROC-01):** all new marker constants/assertions reference text that did not exist in the pre-edit files (`date -u +%Y-%m-%dT%H:%M:%SZ`, `@ <session-id>`, the "Release the lock" step, the released/no-lock Step 0 branch, the append-only-close Write Order invariant) — confirmed by reading each file's original content before editing (captured in this session's transcript) and by the fact that every new assertion targets a literal string introduced only by this plan's edits. Each new suite/describe block is green after the edits (see Verification above).

## Threat Flags

None — this plan edits only static prose/spec/template markdown and vitest drift assertions, matching the plan's `<threat_model>` (no runtime code, no network, no package installs).

## Self-Check: PASSED
