---
phase: 176-stale-chunk-repair
plan: 03
subsystem: cli
tags: [skill-text, delegation-by-reference, cli-registration, installer-probes, judgment-contract]

# Dependency graph
requires:
  - phase: 176-stale-chunk-repair
    plan: "176-01"
    provides: RULING_VERDICTS enum, enumerateRulingsForRecheck, resolveFreshTranscription, verifyRulingRecheckCommand, recordRulingVerdicts
  - phase: 176-stale-chunk-repair
    plan: "176-02"
    provides: selectStaleChunks, resolveStagedSlicePaths, planVerifyEpisodeRound/resolveVerifyEpisodeNumber, recomputeRepairGatePostRepair
provides:
  - "verify/ruling-recheck.md — CHECK-01's staged-only, absence-aware judgment contract, four verdicts, reasoning mandatory"
  - "verify/repair-dispatch.md — CHECK-02's route, delegating build/audit.md's lenses and build/repair.md's loop BY REFERENCE"
  - "verify-ruling-recheck and verify-repair CLI commands, registered with --project/--run-id/--json, no bypass option"
  - "verifyRepairStatusCommand (verify-repair.ts) — the CLI-facing read-only report wiring 176-02's pure functions together"
  - "SHARED_LEAF_PROBES entries + a real-install test proving both new skill files ship under bs-shared/verify/"
affects: [176-04-verify-game-routing, 176-05-check-01-live-proof, 176-06-check-02-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delegation by reference: a route file points at ${CLAUDE_SKILL_DIR}/../bs-shared/build/{audit,repair}.md by path, never pastes their prose"
    - "Judgment contract in its own file with a versioned handshake token, mirroring classification-subagent.md's BS-CLASSIFY-V1 shape"
    - "CLI computes/reports, subagent judges — the orchestrator dispatching either skill file never reads a slice or ruling body itself"

key-files:
  created:
    - src/cli/slash-command/bs/verify/ruling-recheck.md
    - src/cli/slash-command/bs/verify/repair-dispatch.md
  modified:
    - src/cli/cli.ts
    - src/cli/commands/install-claude-command.ts
    - src/cli/commands/install-claude-command.test.ts
    - src/cli/commands/verify-repair.ts

key-decisions:
  - "verifyRepairStatusCommand was added to verify-repair.ts even though the plan's files_modified list did not name that file. 176-02 deliberately left CLI registration for this plan (per its own summary), but 176-02 also left no single orchestrating Command function to register — only pure helper functions. Registering `verify-repair` in cli.ts without a real backing command would have been either a dummy stub (forbidden by CLAUDE.md's no-dummy-data rule) or a bare re-export of a pure function with the wrong shape. verifyRepairStatusCommand wires selectStaleChunks + resolveStagedSlicePaths + resolveVerifyEpisodeNumber/planVerifyEpisodeRound into one --project/--run-id/--json report, mirroring verify-impact-status's read-only shape exactly. Tracked as a Rule 2 deviation (missing critical functionality) below."
  - "The absence-of-source trap (decision 4) is written entirely as reasoning instruction in ruling-recheck.md's prose — no keyword/phrase list in the skill text itself, matching 176-01's own no-heuristic discipline in code."
  - "Both new skill files delegate to build/audit.md and build/repair.md by ${CLAUDE_SKILL_DIR}/../bs-shared/... reference only; grepped confirmed neither file contains the two marker phrases 176-04's drift guard will pin (\"you are checking the CODE against the RAW SOURCE\", \"These raw sources, NOT the Visibility Declaration\") nor a verbatim copy of build/repair.md's round-bound sentence as its own policy statement."

patterns-established:
  - "A CLI-facing report command assembled from a prior plan's pure helper functions, added in the plan that actually needs a callable command surface, rather than forcing the mechanics-only plan to guess at the eventual CLI shape."

requirements-completed: []  # CHECK-01/CHECK-02 still need 176-04's routing/drift-guard proof and 176-05/06's live proof before full closure.

# Metrics
duration: ~55min
completed: 2026-07-30
---

# Phase 176 Plan 03: Ruling-Recheck + Repair-Dispatch Skill Text, CLI Registration, Installer Probes Summary

**Two skill-text files — CHECK-01's staged-only absence-aware judgment contract and CHECK-02's by-reference lens/repair route — plus real CLI registration and a real-install proof that both physically ship.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `verify/ruling-recheck.md` — a versioned-handshake (`BS-RULING-RECHECK-V1`) judgment contract in
  `classification-subagent.md`'s register: reads a ruling's full body plus the fresh STAGED
  transcription only, returns exactly one of `still-needed | resolved-by-source | contradicted |
  undetermined` plus mandatory reasoning. The absence-of-source trap is worked through `seven`'s
  real Ruling 1 (a designer-supplied scoring table for a card absent from the rulebook PDF, the
  game's sole scoring authority for it), naming both plausible wrong answers (`contradicted` —
  "couldn't find it"; `resolved-by-source` — "no gap detected") and why each is catastrophic. No
  absence-phrase list — the reasoning is instructed in prose, exactly as 176-01's code contains no
  heuristic. Supersession-skip and scope-limited behavior are described as already handled
  upstream, never re-derived in this file.
- `verify/repair-dispatch.md` — delegates `build/audit.md`'s three lens templates and
  `build/repair.md`'s bounded loop entirely BY REFERENCE (`${CLAUDE_SKILL_DIR}/../bs-shared/build/
  {audit,repair}.md`), naming all five substitution tokens explicitly and binding `{slicePaths}`
  to the fresh staged paths (decision 9). States `## Interpretation` remains forbidden to every
  lens and is MORE important on a rules-stale chunk (decision 11); states the per-verify-episode
  round budget and names the four chunks already at 3 build-era rounds
  (`best-seven-selection`, `table-and-draw`, `block`, `jab`) as the reason the rule exists
  (decision 17); states the post-repair gate re-derivation / VERIFY-06 seam explicitly (decision
  12); restates scope-limited and report-don't-fix for this step (decisions 10, 16). Grep-confirmed
  clean of the two lens marker phrases 176-04 will pin and of a verbatim copy of `build/repair.md`'s
  round-bound sentence as its own policy statement.
- `verifyRepairStatusCommand` (new, `verify-repair.ts`) — the CLI-facing read-only report Task 3
  needed to register `verify-repair` at all: for every `stale === true` impact-map entry, resolves
  fresh staged slice paths and plans the next verify-episode round, mirroring
  `verify-impact-status`'s shape. Documented as a deviation below.
- `verify-ruling-recheck` and `verify-repair` registered in `cli.ts` with `--project`/`--run-id`/
  `--json`, matching the existing `verify-impact-*` chain shape exactly; source-grepped to confirm
  neither registration block contains `force`/`skip`/`yes`/`bypass`.
- `SHARED_LEAF_PROBES` gained both new files; a real install into a scratch temp dir (mirroring
  175-05's `adjudication-gate.md` proof) asserts both physically land under
  `.claude/skills/bs-shared/verify/`.

## Task Commits

Each task was committed atomically:

1. **Task 1: verify/ruling-recheck.md** - `cba008f7` (feat)
2. **Task 2: verify/repair-dispatch.md** - `4af07c3c` (feat)
3. **Task 3: register both commands, ship both skill files** - `fffdb150` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/slash-command/bs/verify/ruling-recheck.md` - new: CHECK-01's judgment contract
- `src/cli/slash-command/bs/verify/repair-dispatch.md` - new: CHECK-02's by-reference route
- `src/cli/cli.ts` - `verify-ruling-recheck` and `verify-repair` registered
- `src/cli/commands/install-claude-command.ts` - `SHARED_LEAF_PROBES` gained both new files
- `src/cli/commands/install-claude-command.test.ts` - real-install existence assertion for both new files
- `src/cli/commands/verify-repair.ts` - added `verifyRepairStatusCommand`, `RepairStatusRow`, `VerifyRepairStatusResult`

## Decisions Made

- See key-decisions above for the full rationale on `verifyRepairStatusCommand`'s addition outside
  the plan's stated `files_modified` list — a Rule 2 (missing critical functionality) deviation:
  without it, `verify-repair` could not be registered as anything but a dummy stub, which CLAUDE.md
  forbids.
- Chose to keep both skill files' delegation purely at the prose level (pointing at
  `${CLAUDE_SKILL_DIR}/../bs-shared/build/{audit,repair}.md`) with zero inline lens or repair-loop
  text, per decisions 6 and 8 — verified by direct grep against both files for the two marker
  phrases 176-04's drift guard will pin.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added `verifyRepairStatusCommand` to `verify-repair.ts`**
- **Found during:** Task 3
- **Issue:** The plan's `files_modified` list for this plan does not include `verify-repair.ts`,
  but 176-02's own summary explicitly deferred CLI registration to this plan ("Neither new command
  is registered in cli.ts yet ... CLI registration is bundled with 176-03's skill-text plan") while
  176-02 itself created only pure helper functions (`selectStaleChunks`, `resolveStagedSlicePaths`,
  `planVerifyEpisodeRound`, `resolveVerifyEpisodeNumber`, `recomputeRepairGatePostRepair`) with no
  single orchestrating `*Command` function matching the `--project`/`--run-id`/`--json` shape every
  other `verify-*` CLI command has. Registering `verify-repair` in `cli.ts` without a real backing
  command would have required either a dummy/stub action (CLAUDE.md forbids dummy data/fallbacks)
  or re-exporting one pure function under the wrong signature.
- **Fix:** Added `verifyRepairStatusCommand` — a read-only report, mirroring `verify-impact-status`'s
  exact shape, that resolves each stale chunk's staged slice paths and next verify-episode round
  plan. It performs no writes and dispatches no lens; those actions remain
  `verify/repair-dispatch.md`'s orchestration.
- **Files modified:** `src/cli/commands/verify-repair.ts`
- **Commit:** `fffdb150`

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both skill files are ready for 176-04's `verify-game.md` routing update and its no-fork drift
  guards (the two marker-phrase pins and the round-bound-sentence pin can be added to
  `verify.test.ts` directly against these files with no further authoring needed here).
- `verifyRepairStatusCommand` is ready to be the report an orchestrating agent reads before
  dispatching `repair-dispatch.md`'s lens/repair loop; the actual write-side commands (appending a
  round heading, recording a post-repair gate) still route through `writeAppendedAuditRound` and
  `recomputeRepairGatePostRepair` directly — no new CLI surface was needed for those in this plan.
- `npm test`: 3876/3876 green (baseline 3875 + 1 new install-test assertion, zero regressions).
  `npx tsc --noEmit`: only the pre-existing permitted `docs/seed-to-state.test.ts` rootDir error.
  `node bin/boardsmith.js verify-ruling-recheck --help` / `verify-repair --help` both exit 0 and
  list `--project`/`--json`.

---
*Phase: 176-stale-chunk-repair*
*Completed: 2026-07-30*

## Self-Check: PASSED

All created files and all three commit hashes verified present on disk / in `git log --oneline --all`.
