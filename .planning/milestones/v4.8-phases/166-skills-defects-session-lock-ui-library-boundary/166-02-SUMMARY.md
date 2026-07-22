---
phase: 166-skills-defects-session-lock-ui-library-boundary
plan: 02
subsystem: skills
tags: [bs-skills, game-library-boundary, action-panel, markdown-spec, drift-tests, vitest]

# Dependency graph
requires: []
provides:
  - "build.md ## Boundaries section: board-only, read-only node_modules/boardsmith symlink, file-not-patch, never-suppress-built-in-UI"
  - "investigate.md Required Reading pointer to the read-only-library boundary"
  - "final-acceptance.md never-override-explicit-client-instruction rule at the client-judgment gate"
  - "build.md UI section: platformActionPanelEscapeHatch never-without-client don't + .suppressFromDock() named as the only sanctioned per-action mechanism"
  - "failing-first drift assertions (SKILLDEF-02, SKILLDEF-03) in build-chunk.test.ts (PROC-01)"
affects: [Phase 167 (SKILLAUTO)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Boundary prose framed as pit-of-success: the right move (file the gap) is always the easy move, the wrong move (patch/suppress) is always out of bounds"
    - "Never restate a retired API name literally when explaining a rename — reference by description only, to keep 'retired name appears nowhere' drift assertions honest"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/build/build.md
    - src/cli/slash-command/bs/build/investigate.md
    - src/cli/slash-command/bs/build/final-acceptance.md
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "Split the two requirements into two atomic commits despite both editing build.md and build-chunk.test.ts, by temporarily removing Task 2's hunks before Task 1's commit, then restoring them for Task 2's commit — preserves per-task atomicity without git add -p."
  - "Fixed a self-inflicted drift-test failure: the first draft of the SKILLDEF-03 'don't' explained the LIBX-01 rename by literally quoting the retired name 'suppressActionPanel', which violated its own 'never contains the retired name' assertion. Reworded to describe the rename without repeating the retired identifier."

requirements-completed: [SKILLDEF-02, SKILLDEF-03, PROC-01]

duration: ~20min
completed: 2026-07-21
---

# Phase 166 Plan 02: Game/Library Boundary Fix Summary

**Fenced the game/library boundary into the `bs-build` skill: a new "## Boundaries" section in build.md forbids patching or suppressing anything under `node_modules/boardsmith` (a read-only live symlink) and mandates filing library gaps instead, `investigate.md` carries the read-only rule forward before any fix is proposed, `final-acceptance.md` forbids overruling an explicit client instruction, and build.md's UI section now forbids the fenced `platformActionPanelEscapeHatch` without the client while naming `.suppressFromDock()` as the only sanctioned per-action dock-hiding mechanism — all verified by 10 new failing-first drift assertions.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed
- **Files modified:** 4 (3 skill/spec source files, 1 test file)

## Accomplishments

- `build.md` gained a "## Boundaries" section (4 numbered rules): the agent controls the game board only; `node_modules/boardsmith` is a live symlink to the client's real checkout and is read-only, never patched; a library shortfall is a library gap that is FILED, never patched; built-in BoardSmith UI must never be suppressed — an unusable built-in surface is a library gap to FILE, not a feature to switch off. This directly closes the `bs-skills-never-suppress-builtin-ui.md` Failure-2 seam (an agent suppressed built-in UI and considered editing the library).
- `investigate.md`'s Required Reading now carries the read-only-library rule forward explicitly, so the interpretation step (which proposes fixes) has the boundary in view before any fix is written.
- `final-acceptance.md` gained a "Never Override an Explicit Client Instruction" rule at the client-judgment gate, closing the "agent decided to suppress built-in UI against implied client intent" pattern from the same finding.
- `build.md`'s UI-writing section (beside the Placeholder/AssetImage prose) gained a "Never fence the whole panel without the client" don't: never set `platformActionPanelEscapeHatch` (the LIBX-01 rename) without explicit client direction, and `.suppressFromDock()` is named as the ONLY sanctioned per-action dock-hiding mechanism. The retired name `suppressActionPanel` appears nowhere in build.md — including in the prose explaining the rename, which required a rewording fix (see Deviations).
- 10 new drift assertions (6 SKILLDEF-02, 3 SKILLDEF-03, plus one board-only-control assertion folded into SKILLDEF-02) in `build-chunk.test.ts`, pinning every one of these markers. Confirmed red-first per 166-CONTEXT.md's "grep-confirmed clean slate" note (no bs-skill referenced `node_modules`, "suppress", `platformActionPanelEscapeHatch`, or `suppressFromDock` before this plan) and green after the edits.

## Task Commits

Each task was committed atomically:

1. **Task 1: "## Boundaries" section in build.md + read-only pointer in investigate.md + never-override-client in final-acceptance.md (SKILLDEF-02)** - `0fffa0de` (fix)
2. **Task 2: Fenced escape-hatch "don't" in build.md UI section (SKILLDEF-03)** - `41b7a894` (fix)

**Plan metadata:** committed separately after this SUMMARY.

## Files Created/Modified

- `src/cli/slash-command/bs/build/build.md` - Added "## Boundaries" (4-rule game/library boundary section, placed after "Extends, Never Restructures") and "### Never fence the whole panel without the client" (placed in the UI-writing section, after the AssetImage prose).
- `src/cli/slash-command/bs/build/investigate.md` - Required Reading region gained a paragraph carrying the read-only-library boundary rule forward into this chunk's interpretation.
- `src/cli/slash-command/bs/build/final-acceptance.md` - New "## Never Override an Explicit Client Instruction" section, placed immediately before "## Findings Destination".
- `src/cli/slash-command/bs/build-chunk.test.ts` - New `describe('SKILLDEF-02 — game/library boundary')` (6 tests) and `describe('SKILLDEF-03 — fenced escape hatch')` (3 tests) blocks, plus 4 new named marker constants (`NODE_MODULES_BOARDSMITH`, `ESCAPE_HATCH_PROP`, `SUPPRESS_FROM_DOCK`, `RETIRED_SUPPRESS_ACTION_PANEL`).

## Decisions Made

- **Two-commit split of shared files:** both tasks edit `build.md` and `build-chunk.test.ts`. To keep the per-task commit atomic without an interactive `git add -p` session, Task 2's hunks (the escape-hatch prose and SKILLDEF-03 describe block/constants) were written, then temporarily removed before Task 1's commit, verified green standalone, committed, then restored and committed as Task 2. Both intermediate and final states were test-verified.
- **Retired-name self-check:** the plan's acceptance criteria required build.md to contain zero occurrences of the retired `suppressActionPanel` name. The first draft of the SKILLDEF-03 prose explained the LIBX-01 rename by quoting the retired name directly ("the LIBX-01 rename of the retired `suppressActionPanel`"), which is itself an occurrence and broke the drift test built to catch exactly this. Reworded to "the LIBX-01 rename of the now-retired whole-panel escape hatch" — same information, zero literal occurrences of the retired identifier. This is the drift test doing its job correctly on the first run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed the literal retired-name reference from build.md's own SKILLDEF-03 prose**
- **Found during:** Task 2, first `npx vitest run` after writing the escape-hatch prose
- **Issue:** The draft prose explaining `platformActionPanelEscapeHatch` referenced the retired `suppressActionPanel` name literally to explain the rename, causing the new `build.md never references the retired suppressActionPanel name` assertion to fail against the just-written source (not pre-edit source — this was a bug in the edit itself, not a pre-existing gap).
- **Fix:** Reworded to describe the rename ("the now-retired whole-panel escape hatch") without repeating the retired identifier string.
- **Files modified:** `src/cli/slash-command/bs/build/build.md`
- **Commit:** `41b7a894` (part of Task 2's commit)

## Verification

- `npx vitest run src/cli/slash-command/bs` — 4 files, 260/260 passed (up from 250/250 in 166-01).
- `npm run test` (full repo suite) — 214 files, 3053/3053 passed (up from 3043 baseline in 166-01's summary). No regressions.
- `grep -F '## Boundaries' src/cli/slash-command/bs/build/build.md` matches.
- `grep -F 'node_modules/boardsmith' src/cli/slash-command/bs/build/build.md` matches, with "read-only" and "symlink" in the same section.
- `grep -F 'platformActionPanelEscapeHatch' src/cli/slash-command/bs/build/build.md` matches, with a never-without-client instruction in the same region.
- `grep -F 'suppressFromDock' src/cli/slash-command/bs/build/build.md` matches, named as the only sanctioned per-action dock-hiding mechanism.
- `grep -c 'suppressActionPanel' src/cli/slash-command/bs/build/build.md` returns 0.
- No `~/.claude/skills/` path was edited — confirmed via `git status --short` (only repo-tracked `src/cli/slash-command/bs/...` files changed), satisfying the T-166-02/T-166-03 threat-model mitigations.

**Failing-first confirmation (PROC-01):** 166-CONTEXT.md's scout pass grep-confirmed a clean slate — no bs-skill referenced `node_modules`, "suppress", `platformActionPanelEscapeHatch`, or `suppressFromDock` anywhere before this plan's edits, so every new assertion in `SKILLDEF-02`/`SKILLDEF-03` was red-first by construction (referencing text that did not exist pre-edit). Confirmed further by the Task 2 self-inflicted failure above: the suite genuinely failed mid-edit when a draft violated one of its own new assertions, then passed once fixed — direct empirical proof the assertions are load-bearing, not tautological.

## Threat Flags

None — this plan edits only static prose/spec markdown and vitest drift assertions, matching the plan's `<threat_model>` (no runtime code, no network, no package installs).

## Self-Check: PASSED
