# Phase 106: Predicate Triggers & CI-Verifiable Authoring - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

(a) A tutorial step **auto-advances when a game-state predicate matches** (`advanceWhen`), covering "before first turn / after N turns / first forced capture" — as state predicates, NOT a new event bus. (b) An author can express a **complete tutorial as a CI-verifiable test** via the `testing` DSL, such that a rule change that breaks the tutorial **fails the test** instead of rotting silently. Delivers **TUT-03, TUT-04**. Also resolves carry-forwards **MR-02** (predicate gates → labeled) and **MR-03** (fail-loud on empty/malformed).

Defines the Phase 104 reserved `advanceWhen` slot. **In scope:** the predicate trigger model, server-side evaluation + auto-advance, named-predicate helpers, the `simulateTutorial` DSL + assertions, a demonstration test (incl. a deliberately-broken-rule proof) in THIS repo. **Out of scope:** AI teaching (107), tooltips (108), the real checkers tutorial content + its cross-repo test (109), browser demo (110).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Trigger model
- `advanceWhen` is a **labeled `ObjectCondition`**: `Record<string, (ctx: TutorialGateContext) => boolean>` (e.g. `{ 'first capture forced': (ctx) => ... }`), mirroring action conditions (v0.7) so it reuses `evaluateConditionWithTrace` (auto-tracing, consistency). Narrows the reserved `advanceWhen?: unknown`.
- **Triggers are state predicates, NOT a new event subsystem.** Ship named-predicate helpers as sugar (`beforeFirstTurn`, `afterTurns(n)`, `onForcedCapture`-style) that compile to predicates. No `turn-start`/`action:move`/`capture` event emitter.
- Predicates are evaluated **server-side after each action completes** (in `GameSession.performAction`, post-broadcast ~game-session.ts:906) AND once at tutorial start (covers "before first turn"). When `advanceWhen` is true, the `TutorialController.advance(seat)` runs and the session re-broadcasts.
- A fired trigger **auto-advances to the next step**, whose `content` displays on entry. A "tip on forced capture" is a step whose `advanceWhen` is the forced-capture predicate. No separate "fire content without advancing" channel.

### Area 2 — CI-verifiable testing DSL (TUT-04)
- Add `simulateTutorial(testGame, tutorialDef, { seat, scenario, seed })` reusing the existing `TestGame` (src/testing) + assertion helpers `assertTutorialStep` / `assertTutorialCompletes`. Reuse, don't reinvent.
- **Failure-on-drift is the point.** The DSL asserts: (a) each scripted action is LEGAL under the active step's gate (a rule change that gates-out the taught move fails), (b) each `advanceWhen` actually fires when expected (a rule change that stops a predicate firing fails), (c) the tutorial reaches completion. 
- **Proof lives in THIS repo:** ship the DSL in `src/testing` (exported via `boardsmith/testing`) PLUS a demonstration test using a minimal in-test game with a tutorial AND a deliberately-broken-rule variant proving the test fails (criterion #3). The real checkers tutorial test is Phase 109 (cross-repo).
- `simulateTutorial` takes a pinned `seed` for reproducible CI (TestGame already threads seed).

### Area 3 — Predicate consistency + carry-forwards
- **MR-02 fixed:** predicate-form GATES use the SAME labeled `ObjectCondition` shape as `advanceWhen`, evaluated by the shared `evaluateConditionWithTrace` — no more all-or-nothing/permissive predicate gate.
- Reuse `evaluateConditionWithTrace` for all tutorial predicates (gates + advanceWhen) → free debug tracing, consistency.
- **MR-03 fixed (fail-loud):** `start()` on a tutorial with zero steps throws an actionable error; a non-function gate/advanceWhen predicate throws at registration/start, not silently.
- Auto-advance runs **server-side** (engine/session) then re-broadcasts — UI-agnostic (parity hard-rule).

### Claude's Discretion
- Exact helper names/signatures (`afterTurns` etc.), the `simulateTutorial` return shape, file placement within `src/engine/tutorial` vs `src/session` vs `src/testing`, and how a turn counter is derived (existing game state vs a tutorial-local counter) are at implementation discretion, consistent with conventions.
- Whether `skip()` vs `advance()` get a recorded distinction (LR-01) — address if cheap, else leave noted.
</decisions>

<code_context>
## Existing Code Insights (from Phase 106 scout)

### Reusable Assets
- `src/engine/tutorial/types.ts:198` — `advanceWhen?: unknown` slot (narrow here); `:100-105` `TutorialGateContext { game, seat }`.
- `src/engine/action/types.ts:393-408` — `ConditionPredicate`/`ObjectCondition`/`ConditionConfig` (the labeled-predicate pattern to mirror).
- `src/engine/action/action.ts:32-67` — `evaluateConditionWithTrace` (labeled-predicate evaluator w/ trace) — reuse for tutorial predicates.
- `src/engine/tutorial/gate.ts:170-175` — current predicate gate evaluation `gate({game,seat})` (MR-02 target — switch to labeled ObjectCondition + shared evaluator).
- `src/session/game-session.ts:863-906` — `performAction` → `runner.performAction` → `broadcast()` (:906); the post-action hook for evaluating `advanceWhen` + `tutorialController.advance(seat)`. Controller lifecycle: `:1506` advance delegate.
- `src/testing/test-game.ts:50-228` (`TestGame.create`/`doAction`/`getFlowState`, seed at :26/:72), `src/testing/simulate-action.ts`, `src/testing/assertions.ts`, `src/testing/index.ts` (add `simulateTutorial` + helpers).
- `src/utils/random.ts` `SeededRandom` (mulberry32); `runner.ts:89-95` threads seed → game constructor.
- `boardsmith/testing` subpath export already configured (package.json:26-28) — game repos import from it.
- `game.getTutorialDisabledActions(seat)` (Phase 104) — the DSL asserts the scripted action is NOT in it (gate-legality check).

### Integration Points
- `advanceWhen` evaluation: new post-action hook in GameSession (server-side) calling the shared evaluator then `tutorialController.advance`.
- Gates (MR-02): refactor `gate.ts` predicate-form path to labeled ObjectCondition + `evaluateConditionWithTrace`.
- DSL: `src/testing/index.ts` exports `simulateTutorial` + assertions; demonstration test colocated in this repo.
</code_context>

<specifics>
## Specific Ideas
- Criterion #3 ("a deliberately broken rule fails the test") MUST be demonstrated in-repo: a test that, when a rule is broken, the tutorial test goes red. Prove it both ways (intact → green, broken → red).
- No event bus — keep the surface minimal; predicates evaluated post-action cover all the named examples.
- Parity: auto-advance is server-side; the client just renders the advanced step.
</specifics>

<deferred>
## Deferred Ideas
- AI-driven hints/heatmap → Phase 107.
- Per-action help tooltips → Phase 108.
- Real checkers tutorial content + cross-repo tutorial test → Phase 109 (this phase ships the DSL + an in-repo demonstration).
- LR-02 (per-selection-name gating) → Phase 109.
</deferred>
