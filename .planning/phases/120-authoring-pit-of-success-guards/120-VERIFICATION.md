---
status: passed
phase: 120-authoring-pit-of-success-guards
verified: 2026-07-01
must_haves_verified: 4
must_haves_total: 4
method: goal-backward with per-criterion automated tests + code review (5 findings resolved) + full suite green
---

# Phase 120 Verification — Authoring Pit-of-Success Guards

**Status: PASSED** — all 4 success criteria TRUE, each backed by passing automated tests. Full suite 1872/1872 green; lint baseline unchanged (only 3 pre-existing no-shadow errors + 1 pre-existing game.ts:450 warning).

## Success Criteria

1. **PIT-01 — `loop()` without `maxIterations` fails fast at construction (not a dev-console warning).**
   ✅ `src/engine/flow/builders.ts` throws an actionable `Error` at construction when `config.maxIterations === undefined`; the `devWarn('loop-no-max')` path was removed entirely (No-Backward-Compat). Internal callers `turnLoop`/`stateAwareLoop` default via `?? 100` and are correctly exempt. Proof: `src/engine/flow/builders.test.ts` (throw + message + happy-path). The 6 pre-existing in-repo `loop({})` test call sites were given explicit `maxIterations` so the suite stays green.

2. **PIT-02 — game start validates element registration and fails loud, naming any used-but-unregistered class.**
   ✅ Recording hook on all 6 `GameElement` finder methods (`all/first/firstN/last/lastN/has` — `has` added per review WR-01) records class-typed queries into a per-`_ctx` Set during the first `startFlow()` traversal (try/finally window); post-traversal diff vs `_ctx.classRegistry` throws naming the class → `game.registerElements([Class])`. Per-game scoped (no global leak; two-game isolation test). Documented limitation: direct `ElementCollection` queries (`board.children.all()`) and post-start/async queries are out of scope by design. Proof: `src/engine/element/game.test.ts` `describe('PIT-02')` (unregistered throw, positive still-starts, post-start scope-off, two-game isolation, has()-only query).

3. **PIT-03 — game start validates action reachability; warns/errors on actions that can never fire.**
   ✅ `walkFlowNodes` (exhaustive over all 11 FlowNode types, with a `never` exhaustiveness guard per review WR-04) + `Game#validateActionReachability()` at `startFlow()`: THROWS on an `actionStep`-referenced-but-unregistered action (→ `registerActions`); devWarn (never throw) for a registered-but-unreferenced action; function-valued `actions` treated as a documented static-walk blind spot (no throw). Proof: `src/engine/flow/walk-flow-nodes.test.ts` + `game.test.ts` `describe('PIT-03')`.

4. **PIT-04 — lint rules catch the confirmed identity/state footguns with actionable messages.**
   ✅ Two syntactic-only ESLint rules registered in `src/eslint-plugin/index.ts`: `no-element-identity-comparison` (===/!== between GameElement-looking operands + `GameElement[].includes(element)`; auto-fixes `a===b`→`a.id===b.id`) and `no-element-array-state` (GameElement[] class fields / `game.all()` stored to persistent props; not auto-fixable). Both resolve identifiers by lexical binding via the scope manager (review WR-03) to avoid cross-function false positives. First RuleTester coverage in the repo, built on the built-in eslint RuleTester + existing `@typescript-eslint/parser` — **no new dependency**. Proof: `no-element-identity-comparison.test.ts` (9) + `no-element-array-state.test.ts` (7), including scope-hygiene regression fixtures.

## Code Review

`120-REVIEW.md`: 0 critical, 4 warning, 1 info. All 5 resolved (`120-REVIEW-FIX.md`): WR-01 has() coverage, WR-02 documented ElementCollection bound, WR-03 scope-aware matching, WR-04 exhaustiveness guard, IN-01 dead-conditional cleanup. +3 regression tests added.

## Notes

- No new dependencies added (CLAUDE.md hard rule honored — used built-in eslint RuleTester, not `@typescript-eslint/rule-tester`).
- Real-world lint firing against `~/BoardSmithGames/` + MERC is exercised in Phase 121, not here.
- Design-doc anchor drift (game.ts 1426→1554, `_flowDefinition` not `_flow`, `first()` not `firstOf()`) was caught in research and applied; a plan-check blocker (nonexistent `ElementCollection._ctx` linkage) was fixed before execution.
</content>
