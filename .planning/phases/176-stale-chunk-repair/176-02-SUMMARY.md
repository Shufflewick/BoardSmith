---
phase: 176-stale-chunk-repair
plan: 02
subsystem: cli
tags: [stale-chunk-resolution, m-n-pairing, audit-round-bookkeeping, repair-gate, drift-check]

# Dependency graph
requires:
  - phase: 175-impact-map-repair-gating
    provides: verify-run.ts's atomicWriteFile/ClassificationRecord/stagingSlicesDir, verify-impact.ts's computeRepairGate/ImpactMapEntry, drift-check.ts's driftCheckCommand
  - phase: 174-anchor-attribution-classification
    provides: verify-classify.ts's ChunkVerdict.pairIds/attributions (the m:n pairing consumed, never re-derived)
provides:
  - "selectStaleChunks — decision 5's dispatch filter (stale === true only)"
  - "resolveStagedSlicePaths — stale chunk -> fresh staged slice paths, real m:n fan-out, scope-limited on an unresolved pairId"
  - "parseAuditRounds/planVerifyEpisodeRound/resolveVerifyEpisodeNumber/appendAuditRoundHeading/writeAppendedAuditRound — decision 17's per-verify-episode 3-round budget, append-only"
  - "recomputeRepairGatePostRepair — post-repair computeRepairGate re-derivation, structurally rejecting a caller-supplied driftState/gate"
affects: [176-03-repair-dispatch-skill-text, 176-04-verify-game-routing, 176-06-check-02-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated scope-limited result instead of throw, mirroring 176-01's resolveFreshTranscription / PROV-02's honest-partial-report pattern"
    - "Frozen-array-adjacent numeric budget constant (VERIFY_EPISODE_ROUND_BUDGET) instead of a magic literal"
    - "Structural type-level exclusion: a function's parameter TYPE omits a field entirely, so no caller can pass it, rather than a runtime guard that could be bypassed"
    - "Post-mutation re-derivation via the existing single authority (drift-check.ts), never a second git-diff implementation"

key-files:
  created:
    - src/cli/commands/verify-repair.ts
    - src/cli/commands/verify-repair.test.ts
  modified:
    - src/cli/commands/verify-impact.test.ts

key-decisions:
  - "resolveStagedSlicePaths takes a caller-supplied stagedSlicesDir string rather than re-deriving it from projectDir/runId internally — the ONE path-computation authority (verify-run.ts's stagingSlicesDir) stays a single call site at the orchestration layer, and this function stays pure/no-I/O, testable without touching the filesystem's path-assertion logic a second time."
  - "planVerifyEpisodeRound takes an explicit episode number rather than resolving it internally, keeping the round-planning math (pure, easily table-tested) separate from episode-boundary resolution (resolveVerifyEpisodeNumber, which reads the document's own history to decide whether to resume or open a new episode) — the same computes/decides separation this phase's other functions use."
  - "recomputeRepairGatePostRepair calls the full driftCheckCommand (whole-project) and looks up its own slug, rather than adding a single-chunk drift entry point to drift-check.ts — this keeps drift-check.ts as the SOLE authority with zero new surface area, at the cost of one extra full-project drift pass per re-derivation call; acceptable since repair-gate re-derivation is a per-chunk, end-of-repair-loop operation, not a hot path."
  - "CHECK-02 is NOT marked complete in REQUIREMENTS.md by this plan — ROADMAP.md's own phase 176 breakdown assigns CHECK-02 to four plans (176-02 mechanics, 176-03 skill text, 176-04 routing/drift-guard proof, 176-06 live proof); this plan is 176-02 (mechanics) only, matching 176-01's own precedent for CHECK-01."

patterns-established:
  - "Explicit-argument round planning + separate episode-boundary-resolution helper: keeps the pure, heavily-table-tested arithmetic (planVerifyEpisodeRound) decoupled from the document-history-reading decision (resolveVerifyEpisodeNumber) of which episode a caller should even be planning for."
  - "Type-level exclusion as the enforcement mechanism for 'this input must never carry that field' (recomputeRepairGatePostRepair's missing driftState/gate) — proven by a source-regex test extracting exactly the function's parameter-object literal and asserting the forbidden field names are absent from it, not just absent from a hand-written test call."

requirements-completed: []  # CHECK-02's mechanics only — see key-decisions; full closure is 176-03/04/06.

# Metrics
duration: ~50min
completed: 2026-07-30
---

# Phase 176 Plan 02: CHECK-02 Mechanics Summary

**`verify-repair.ts` resolves a stale chunk to its fresh staged slice paths under the real 3-live→6-staged fan-out, gives each verify pass its own append-only 3-round audit budget legible in CHUNK.md, and re-derives the repair gate from POST-repair drift state with the pre-repair snapshot structurally unpassable.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3/3 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `selectStaleChunks` filters `ImpactMapEntry[]` to `stale === true` only (decision 5) — proven against a mixed-entry list.
- `resolveStagedSlicePaths` maps a stale chunk's `pairIds` to the run's own `RUN.md` `ClassificationRecord.stagedSlices`, proven against the real committed 175 fixture (`174-07-contradictory/staged/{seven,one-two-punch}/`): `seven`'s single `pairId` genuinely resolves 3 live rule slices to exactly its 6 staged filenames (asserted against a live `readdir` of the fixture, not a hardcoded list). An unresolved `pairId` returns the scope-limited arm naming it, never an empty-but-successful path list and never a live `rulebook/` fallback — every resolved path is asserted to contain `/.verify/` and never match live-slice shape `/(^|\/)rulebook\/\d/`. The fixture on disk is proven byte-identical before/after.
- `parseAuditRounds` finds every `### Audit Round N` heading, proven against all three real precedent parenthetical shapes quoted in `176-PATTERNS.md` (`table-and-draw`, `block`, `jab`) plus a zero-round chunk.
- `planVerifyEpisodeRound` gives a verify episode its own fresh 3-round budget: a 3-build-round chunk's first verify dispatch is proven to land at absolute round 4 / episode 1, round 1 — never routed to triage on arrival (decision 17's whole point) — and the 4th episode-round request is proven to return the `triage` disposition with no heading produced.
- `resolveVerifyEpisodeNumber` lets a resumed pass continue its own in-progress episode, and opens a new episode once the current one's budget is exhausted — proven for all three states (zero rounds, in-progress, exhausted).
- `appendAuditRoundHeading`/`writeAppendedAuditRound` are proven append-only (`output.startsWith(input.trimEnd())`, every pre-existing heading string surviving exactly once) and proven to write exclusively through `atomicWriteFile` (source-regex guard: no `fs.writeFile`/`writeFileSync` in the module).
- `recomputeRepairGatePostRepair` re-derives `computeRepairGate` from POST-repair code state via `drift-check.ts` (the sole code-movement authority), proven with a real two-commit git fixture: a clean→drifted flip after a real file modification flips `close-without-replaytest` → `reopen-playtest`; an unchanged fixture preserves its disposition across two invocations; an invalid commit hash produces `unknown-drift` that short-circuits on both invocations. A source-regex assertion proves the function's parameter-object literal contains neither `driftState` nor `gate` — the pre-repair snapshot is structurally unpassable, not just discouraged.
- `verify-impact.test.ts` gained the idempotence/purity proof `computeRepairGate` needed (Assumption A3 from `176-RESEARCH.md`, previously unverified by unit test): two calls with identical input are deeply equal.

## Task Commits

Each task was committed atomically:

1. **Task 1: Resolve a stale chunk to its fresh staged slice paths** - `bfe52c55` (feat)
2. **Task 2: Verify-episode round bookkeeping (decision 17)** - `5de8b371` (feat)
3. **Task 3: Re-derive the repair gate AFTER repair (Pitfall 1)** - `e90c9472` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/commands/verify-repair.ts` - new module: `selectStaleChunks`, `resolveStagedSlicePaths`, `parseAuditRounds`, `planVerifyEpisodeRound`, `resolveVerifyEpisodeNumber`, `appendAuditRoundHeading`, `writeAppendedAuditRound`, `recomputeRepairGatePostRepair`, `VERIFY_EPISODE_ROUND_BUDGET`
- `src/cli/commands/verify-repair.test.ts` - 27 tests covering every behavior above, over the real committed 175 fixture and a real two-commit git fixture
- `src/cli/commands/verify-impact.test.ts` - added the `computeRepairGate` idempotence/purity test (Assumption A3)

## Decisions Made

- `resolveStagedSlicePaths` accepts a caller-supplied `stagedSlicesDir` rather than `projectDir`/`runId`, keeping `verify-run.ts`'s `stagingSlicesDir` as the single path-computation call site and this function pure/no-I/O (see key-decisions above for the full rationale).
- `planVerifyEpisodeRound` takes an explicit `episode` number; a separate `resolveVerifyEpisodeNumber` reads the document's own round history to decide which episode a caller should plan for (resume vs. open new) — the same computes/decides split this milestone uses throughout.
- `recomputeRepairGatePostRepair` reuses the existing whole-project `driftCheckCommand` rather than adding a single-chunk entry point to `drift-check.ts`, trading one extra full-project drift pass for zero new surface area on the sole drift authority.
- CHECK-02 was intentionally NOT marked complete in `REQUIREMENTS.md` — `ROADMAP.md`'s own phase 176 breakdown assigns CHECK-02 to four plans (176-02 mechanics, 176-03 skill text, 176-04 routing/drift-guard proof, 176-06 live proof); this plan is 176-02 only, following 176-01's own precedent for CHECK-01.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `must_haves`/`acceptance_criteria` are met by the code and tests as designed; no bug fixes, missing-functionality additions, or blocking-issue fixes were required beyond the plan's own specified behavior.

## Issues Encountered

None. One inbound carried-forward item from the plan's interfaces section — the `lineFindings[]` multi-delta persistence gap (a `ClassificationRecord` retains only the max-severity `quotedPass1`/`quotedPass2` pair per pair group) — was checked against this plan's actual code path: `resolveStagedSlicePaths` never reads `quotedPass1`/`quotedPass2` at all (it only consumes `pairId`/`stagedSlices`), so the gap does not affect this plan's input contract. Recorded here rather than silently assumed resolved, per the plan's own instruction.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `resolveStagedSlicePaths`, `planVerifyEpisodeRound`/`resolveVerifyEpisodeNumber`, and `recomputeRepairGatePostRepair` are all ready for 176-03's `verify/repair-dispatch.md` skill text to consume directly as the glue that dispatches the (verbatim, decision 8) `build/audit.md` lenses and `build/repair.md` loop — no further mechanics are needed on the CHECK-02 side before that skill text can be written.
- `npm test`: 3875/3875 green (baseline 3851 + 24 new tests, zero regressions). `npx tsc --noEmit`: only the pre-existing permitted `docs/seed-to-state.test.ts` rootDir error.
- Neither new command is registered in `cli.ts` yet — per `176-PATTERNS.md`'s file classification, CLI registration is bundled with 176-03's skill-text plan alongside `verify-ruling-recheck`'s own registration.

---
*Phase: 176-stale-chunk-repair*
*Completed: 2026-07-30*

## Self-Check: PASSED

All created files and all three commit hashes verified present on disk / in `git log --oneline --all`.
