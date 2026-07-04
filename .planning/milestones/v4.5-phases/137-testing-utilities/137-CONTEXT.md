# Phase 137: Testing Utilities - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

`TestGame`'s default behavior matches the library's own deterministic, fail-loud doctrine. Covers audit findings F36, F37 (requirements TST-01, TST-02; PROC-01/PROC-02 discipline applies fractally). Scope: `src/testing/test-game.ts` + its consumers (BoardSmith-internal tests using doAction), docs/api/testing.md, docs/agent-control.md.

</domain>

<decisions>
## Implementation Decisions

### TestGame Defaults
- **TST-01 (F36)**: **`doAction` throws on failure by default**, carrying the rich `debugActionAvailability` trace that `assertActionAvailable` already builds (actionable: why the action failed, what was available). Add **`tryAction()`** returning `ActionExecutionResult` for tests that deliberately expect failure. The TestGame class-level example (test-game.ts:101-102), docs/api/testing.md:404, and docs/agent-control.md:165 all stop modeling ignore-the-result same-phase.
- **TST-02 (F37)**: **Fixed literal default seed** (e.g. `'test-seed'` — match `playUntilComplete`'s deterministic-by-default doctrine; simulate-action.ts:313 is the precedent). Also **expose `testGame.seed`** and include it in assertion-helper failure messages so explicitly-seeded/random runs are one copy-paste from a deterministic repro.

### Process (carried over from Phases 131-136 locked decisions)
- PROC-01 verify-first: per-finding verdict in `137-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED recorded in SUMMARY.
- Same-phase doc updates (DOCX-04). Full suite green per wave.

### Claude's Discretion
- Error class shape for the doAction throw (a dedicated TestActionError or reuse GameStuckError conventions from v4.3 — pick what reads best in vitest output).
- Exact fixed seed literal.
- Sweep strategy for BoardSmith-internal doAction call sites that intentionally relied on failure results (migrate to tryAction) vs those that silently depended on never-throwing (they now surface real bugs — fix them).

</decisions>

<code_context>
## Existing Code Insights

### Key trace points (from audit; re-verify per PROC-01)
- `src/testing/test-game.ts:272` — doAction returns ActionExecutionResult, never throws; `:101-102` — the class-level example modeling the trap; `:127` — `test-${Date.now()}` default seed.
- `src/testing/simulate-action.ts:313` — playUntilComplete's "Deterministic by default … NEVER falls back to Math.random" precedent; simulateRandomGames surfaces its seed for replay.
- `assertActionAvailable` / `debugActionAvailability` — the rich trace to reuse in the throw (v4.3 TEST ergonomics work).
- docs/api/testing.md:404, docs/agent-control.md:165 — unchecked-doAction examples to fix.

### Established Patterns
- v4.3 shipped `playUntilComplete`/`GameStuckError` + assertion traces — the fail-loud testing house style.
- v4.4 Phase 123 established the determinism doctrine (seeded-RNG enforcement).
- Memory note: `mcts-bot.test.ts` is excluded from vitest; new AI-adjacent tests go in separate files.

### Integration Points
- Every BoardSmith-internal test using `TestGame.doAction` — the throw flip may surface tests whose setup moves were silently failing (that's the point; fix them).
- Games/MERC use TestGame heavily — Phase 138 migrates them; expect `tryAction` migrations and possibly newly-surfaced real bugs there (v4.2 precedent: broadcast bug found this way).

</code_context>

<specifics>
## Specific Ideas

- TST-01's RED test: a doAction with an unavailable action/wrong seat must throw with a message naming the action and including the availability trace; tryAction returns {success:false} without throwing.
- TST-02's RED test: two TestGames constructed without seeds produce identical shuffles; testGame.seed returns the seed.
- Suite baseline after Phase 136: 175 files / 2358 tests green.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
