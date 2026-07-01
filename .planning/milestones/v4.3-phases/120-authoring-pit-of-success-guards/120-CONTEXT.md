# Phase 120: Authoring Pit-of-Success Guards - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** Design-doc-anchored (discuss = confirmation; all decisions locked in Phase 116)

<domain>
## Phase Boundary

Convert the highest-value silent authoring footguns into fail-fast, actionable errors at construction/start time, plus lint coverage for the identity/state mistakes confirmed in DSGN-01.

Requirements: **PIT-01, PIT-02, PIT-03, PIT-04**. Scope: `src/engine/` (construction/start validation) + `src/eslint-plugin/` (two new rules). No cross-repo work here (game/MERC migration is Phase 121).

Success criteria (what must be TRUE):
1. `loop()` without `maxIterations` fails fast at game construction with an actionable error (not a dev-console-only warning).
2. Game start validates element registration and fails loud, naming any custom element class used but unregistered.
3. Game start validates every registered action is reachable from at least one `actionStep`; warns/errors on actions that can never fire.
4. Lint rules catch the highest-value silent footguns confirmed in DSGN-01 (element identity comparison via `includes`/`===`, element arrays used as state), with actionable messages.
</domain>

<decisions>
## Implementation Decisions — LOCKED in `.planning/v4.3-API-DESIGN.md` (PIT section, approved Phase 116)

### PIT-01 — `loop()` maxIterations construction-time throw (BUILD, breaking)
- Location: `src/engine/flow/builders.ts:85–96`.
- Replace the `devWarn('loop-max-iterations', …)` path **entirely** with an unconditional `throw new Error(...)` when `config.maxIterations === undefined`. No dual behavior, no shim (No-Backward-Compat hard rule).
- Error text: requires `maxIterations`, shows `loop({ maxIterations: 100, ... })`, explains the silent 10 000 cap risk.
- The runtime cap `DEFAULT_MAX_ITERATIONS = 10000` at `src/engine/flow/engine.ts:1045` stays as a secondary safety net.

### PIT-02 — Element class registration validation at `startFlow()` (BUILD)
- Implementation point: `src/engine/element/game.ts:1426` (`game.startFlow()`).
- Scope (RESOLVED, Open Question 4): classes encountered during the **first `startFlow()` traversal only**. Post-construction dynamic queries and classes accessed in async handlers after `startFlow()` are **out of scope** — documented as a known limitation.
- Collect classes accessed via `game.all(Class)`/`game.firstOf(Class)`/similar; cross-check `game.classRegistry`; throw on first unregistered class with an actionable `game.registerElements([Class])` message.

### PIT-03 — Action reachability validation at `startFlow()` (BUILD)
- Implementation point: `src/engine/element/game.ts:1426` (`game.startFlow()`).
- Enumerate all `actionStep` nodes via `game._flow`; collect the union of referenced action names; for each, verify `game.getAction(name)` is defined; **throw** on any `actionStep`-referenced-but-unregistered name with an actionable `registerAction`/`registerActions` message.
- Bidirectional check is a **devWarn, NOT a throw**: a registered action referenced by no `actionStep` is suspicious but may be intentional (invoked via non-actionStep paths).

### PIT-04 — Two ESLint rules (BUILD)
- `boardsmith/no-element-identity-comparison` — `src/eslint-plugin/rules/no-element-identity-comparison.ts`. Catches `===`/`!==` between two `GameElement` (sub)instances and `GameElement[].includes(element)`. **Auto-fixable** for simple binary expressions (`a === b` → `a.id === b.id`). Message steers to `element.id === other.id`.
- `boardsmith/no-element-array-state` — `src/eslint-plugin/rules/no-element-array-state.ts`. Catches `GameElement[]`-typed class fields in non-`GameElement` classes and assigning `game.all()`/`game.firstOf()` results to persistent class properties. **Not auto-fixable**. Message steers to element-tree accessors at point-of-use or storing IDs.
- Register both in `src/eslint-plugin/index.ts` `rules` map, mirroring `no-network`/`no-timers`/`no-nondeterministic`.
</decisions>

<code_context>
## Existing Code Insights

- Phase 116 DSGN-01 confirmed these footguns as real with file:line evidence (see `.planning/v4.3-API-DESIGN.md` and `116-RESEARCH.md`).
- `devWarn` infrastructure exists; PIT-01 removes one of its call sites (do not remove `devWarn` itself — PIT-03's bidirectional check uses it).
- Known repo-wide pre-existing lint state: 3 `no-shadow` errors (game.ts, useAnimationEvents.ts, useFlyingElements.ts) — out of scope for this phase.
- The new lint rules will fire against real games in Phase 121 (migration); expect them to surface actual violations there, which is the point.
</code_context>

<specifics>
## Specific Ideas

- Follow TDD: RED (failing test proving the footgun is silent / rule missing) → GREEN (guard/rule) → REFACTOR.
- PIT-01/02/03 need tests that a bad game construction/startFlow now throws with the actionable message; PIT-02/03 need a passing test that a correct game still starts.
- PIT-04 rules need valid/invalid RuleTester fixtures, including the auto-fix output for `no-element-identity-comparison`.
- Do NOT migrate games in this phase — only build+unit-test the guards/rules in `src/`. Any real violations found in this repo's own games/tests are fixed here only if they block the suite; broad game migration is Phase 121.
</specifics>

<deferred>
## Deferred Ideas

- Static analysis of dynamically-queried element classes (post-`startFlow()`/async) — explicitly out of scope for PIT-02 (accepted limitation, to be documented in Phase 122 DOC).
- Broad application of the new lint rules across `~/BoardSmithGames/` and MERC — Phase 121.
</deferred>
</content>
