# Phase 133: Engine Flow & Action Validation - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Multi-player flow control and multi-step action validation behave correctly and surface failures instead of silently skipping players or accepting invalid input. Covers audit findings F4, F5, F6, F27 (requirements ENG-02, ENG-03, ENG-04, ENG-07; PROC-01/PROC-02 discipline applies fractally). Scope: `src/engine/flow/engine.ts` (executeEachPlayer, resumeSimultaneousAction, executeSwitch), `src/engine/flow/turn-order.ts` (preset docs), `src/engine/action/action.ts` (validateSelection choice branch), `docs/common-patterns.md` (dealer pattern).

</domain>

<decisions>
## Implementation Decisions

### Flow & Validation Fail-Loud Mechanisms
- **ENG-02 (F4, critical)**: `eachPlayer` with `startingPlayer` **wraps around always** — `eligibleSeats = [...players.slice(startIndex), ...players.slice(0, startIndex)]`. No `wrap: false` opt-out (truncation was never a sane board-game semantic). Fix `docs/common-patterns.md` dealer pattern and `TurnOrder` preset docs (LEFT_OF_DEALER / START_FROM / CONTINUE) in the same phase.
- **ENG-03 (F5, critical)**: `resumeSimultaneousAction` **mirrors the regular resume path** — sets `this.actionError = result.error` before returning `getState()` on failure and clears it on success. A failed simultaneous action surfaces `actionError`, returns failure to the client, and is NOT recorded in `actionHistory`.
- **ENG-04 (F6)**: **Port multiSelect min/max count enforcement from the elements branch** (action.ts ~795-807) into the choice-type array branch of `validateSelection`, resolving function-valued `multiSelect` the same way. Also **reject non-array values** when multiSelect is configured.
- **ENG-07 (F27)**: `switchOn` with no matching case and no default **throws** an actionable error naming the stringified value and the available case keys (e.g. "switchOn 'phase' got 'combatt' — no matching case (draw, play, combat) and no default"). Matches the loop `maxIterations` throw precedent from v4.3 Phase 120.

### Process (carried over from Phases 131/132 locked decisions)
- PROC-01 verify-first: per-finding verdict recorded in `133-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED output recorded in SUMMARY.
- Tests in existing engine suites; full suite green per wave; same-phase doc updates (DOCX-04).

### Claude's Discretion
- Exact error message wording (actionable, names the offending value and valid options).
- Whether ENG-02's wrap needs a checkpoint-restore compatibility note (eligibleSeats snapshot is persisted in frame data — verify restored mid-round frames from pre-fix snapshots don't break; a clean break is acceptable per No Backward Compatibility).
- Where the ENG-04 count-validation helper lives if shared between elements and choice branches (dedupe if clean).

</decisions>

<code_context>
## Existing Code Insights

### Key trace points (from audit; re-verify per PROC-01 — engine.ts was modified by Phase 132's ENG-06 fix, line numbers have shifted)
- `src/engine/flow/engine.ts` ~1116 (pre-132 numbering) — `executeEachPlayer` builds `eligibleSeats` via `players.slice(startIndex)` with no wrap. Note: Phase 132's executeForEach snapshot fix (a85c4ae6) touched nearby code.
- `src/engine/flow/engine.ts` ~457 — `resumeSimultaneousAction` returns `getState()` on failure WITHOUT setting `this.actionError`; the regular path (~267) records it. `GameRunner.performAction` (runner.ts ~207) detects failure only via `flowState.actionError`.
- `src/engine/action/action.ts` ~699-715 — choice-type array branch checks membership only; elements branch (~795-807) has the count enforcement to port. Note: Phase 132's ENG-05/WR-03 fixes touched resolveArgs in this file.
- `src/engine/flow/engine.ts` ~1387-1392 — `executeSwitch` marks frame completed and continues on unmatched value.
- `src/engine/flow/turn-order.ts:50,82,131` — LEFT_OF_DEALER / START_FROM / CONTINUE presets encode the broken pattern in docs.
- `docs/common-patterns.md:54` — canonical dealer-rotation example teaches the broken pattern.

### Established Patterns
- `eligibleSeats` snapshot pattern (executeEachPlayer) — ENG-02 modifies its construction only.
- Actionable throw precedent: loop maxIterations (v4.3), ENG-01/ENG-08 errors (Phase 132).
- Red-first test insertion: engine.test.ts has ForEach/EachPlayer describe blocks; action.test.ts has validateSelection coverage.

### Integration Points
- `actionError` flows through `FlowState` → `GameRunner.performAction` → session → client `lastError` (UIX-01 in Phase 134 builds on this being correct).
- eachPlayer wrap affects simultaneous+sequential turn logic in all example games — cross-repo verification in Phase 138.

</code_context>

<specifics>
## Specific Ideas

- ENG-02 and ENG-03 are both critical severity — the audit's #2 and #3 findings after F1. Regression tests must cover: 4 players, dealer at seat 3 → all 4 get turns in wrapped order; failed simultaneous action → actionError set, client gets failure, actionHistory clean.
- Suite baseline after Phase 132: 168 files / 2148 tests green — keep green.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
