---
phase: 104-tutorial-lifecycle-action-gating
reviewed: 2026-06-25T00:00:00Z
resolved: 2026-06-25T00:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - src/engine/tutorial/types.ts
  - src/engine/tutorial/gate.ts
  - src/engine/element/game.ts
  - src/engine/element/volatile-state.ts
  - src/engine/action/action.ts
  - src/engine/utils/snapshot.ts
  - src/session/types.ts
  - src/session/game-session.ts
  - src/session/utils.ts
  - src/session/tutorial-controller.ts
  - src/ui/composables/useActionController.ts
  - src/ui/composables/useActionControllerTypes.ts
  - src/ui/composables/useActionController.helpers.ts
findings:
  blocker: 1
  critical: 1
  warning: 1
  high: 1
  medium: 3
  low: 4
  total: 9
status: partially_resolved
---

# Phase 104: Tutorial Lifecycle & Action Gating — Code Review

**Reviewed:** 2026-06-25
**Depth:** deep (cross-file: engine ⇄ session ⇄ ui)
**Status:** BL-01 and HR-01 resolved; MR-01 deferred to Phase 105 (per decision)

## Summary

The serialization discipline is genuinely solid: `tutorialProgress` is a plain
public `Map` that round-trips through `toJSON` (`Object.keys`) and is rebuilt as
a real `Map` via `resolveElementReferences` → `deserializeValue` (`__map`).
`tutorialDefinition` is correctly excluded from the snapshot, stripped from
`_constructorOptions`, and listed in `unserializableAttributes`. Undo/MCTS-clone
round-trips are covered by real, non-trivial tests (Map instance + numeric-key
assertions). Projection parity between `buildPlayerState` and `createPlayerView`
goes through the single shared `getActiveTutorialStepView` helper and is asserted
with `toEqual` on both sites. Value-level gating reuses the existing v2.8
`disabled` annotation path with **no parallel validation pipeline** — the same
`getChoices` → `disabled` → "Selection disabled: <reason>" surface enforces it in
`validateSelection`/`hasValidSelectionPath`. Auto-fill suppression guards both
the `tryAutoFillSelection` path and the post-fetch path, and is inert by default.

Two serious gaps undercut the phase, however:

1. **BLOCKER** — `GameSession.restore()` never re-supplies `tutorialDefinition`,
   so a routine restore-from-storage silently destroys the tutorial. The code's
   own comment claims restore re-threads it; the implementation does not.
2. **HIGH** — action-level gating is **advisory only**. The engine never blocks
   execution of an out-of-step action; `getActionLevelDisabledReasons` feeds the
   projection layer exclusively. A bare `{ action: 'move' }` gate keeps the
   learner on rails for *sub-choices of `move`* but does nothing to stop them
   executing `pass`/`endTurn`.

## Blocker Issues

### BL-01: `GameSession.restore()` loses `tutorialDefinition` on every restore-from-storage — **RESOLVED**

**Fix commit:** `74de8b2` (fix(104): re-supply tutorialDefinition in GameSession.restore())
**Test commit:** `12ec52c` (test(104): add failing restore-with-tutorial tests for BL-01)
**New tests:** 3 tests in `src/session/restore-snapshot-authoritative.test.ts` (BL-01 describe block).
Covers: gating reason survives snapshot → restore; advance() succeeds post-restore; pre-fix behavior documented.

**Original finding:**

**File:** `src/session/game-session.ts:645-693` (capture site `:230`; design comment `src/engine/element/game.ts:544`)

**Issue:**
`restore()` reconstructs the runner via `GameRunner.fromSnapshot(...)`. The
snapshot intentionally excludes `tutorial` (it is stripped from
`_constructorOptions` in the `Game` constructor), so the restored
`runner.game.tutorialDefinition` is `undefined`. The constructor then captures
`this.#tutorialDefinition = runner.game.tutorialDefinition` → `undefined`, and
`replaceRunner` only re-supplies `if (this.#tutorialDefinition)` — which is now
false. `restore()` takes **no `tutorial` parameter at all**, so there is no path
for the definition to come back.

The `create()` path threads `tutorial` correctly; `restore()` does not. This is
the exact failure class the phase set out to guard against (risk area #1:
"`tutorialDefinition` … must be re-supplied after undo/replaceRunner"), just on
the persistence boundary instead of the undo boundary.

Consequences after any server restart / durable-object reload / stored-state
restore of a tutorial game:
- `getActiveStep` returns `null` for every seat → `PlayerGameState.tutorial` and
  `disabledActions` silently vanish, even though serialized `tutorialProgress`
  still reads `status: 'running'`. Gating evaporates. The learner's UI loses the
  tutorial mid-session with no error.
- `startTutorial`/`advanceTutorial`/`skipTutorial`/`exitTutorial` throw
  `"No tutorial definition found on this game…"` — the lifecycle is dead.

The comment at `game.ts:544` explicitly documents the intended contract —
`"(GameSession.restore → GameRunnerOptions.gameOptions.tutorial)"` — so the
implementation contradicts its own stated design. No test exercises
`GameSession.restore()` with a tutorial, so this is uncaught.

**Fix:** Thread the definition through `restore()` exactly as `create()` does.

```typescript
static restore<G extends Game = Game>(
  storedState: StoredGameState,
  GameClass: GameClass<G>,
  storage?: StorageAdapter,
  botAIConfig?: BotAIConfig,
  tutorial?: TutorialDefinition,   // NEW — re-threaded from GameDefinition.tutorial
): GameSession<G> {
  ...
  const runner = GameRunner.fromSnapshot<G>(storedState.snapshot, GameClass);
  // Re-supply static config the snapshot intentionally omits, BEFORE the
  // constructor captures #tutorialDefinition.
  if (tutorial) runner.game.tutorialDefinition = tutorial;
  ...
}
```

The caller that holds the `GameDefinition` (platform/dev host) must pass
`GameDefinition.tutorial` into `restore()`, mirroring `create()`. Add a
`GameSession.restore()` round-trip test asserting `startTutorial` succeeds and
`getActiveStep` resolves after a snapshot restore.

## High / Warning Issues

### HR-01: Action-level gating is never enforced at execution — it only annotates a reason — **RESOLVED**

**Fix commit:** `cb2bc57` (fix(104): enforce tutorial action-level gating in Game.performAction())
**Test commit:** `4c4bf54` (test(104): add failing action-enforcement tests for HR-01)
**New tests:** 6 tests in `src/engine/action/tutorial-gate.test.ts` (HR-01 describe block).
Covers: out-of-step action rejected with gate reason; in-step action allowed; non-tutorialized seat unaffected; normal play unaffected; step change unblocks newly-allowed action.

**Original finding:**

**File:** `src/engine/tutorial/gate.ts:159-192`, `src/engine/element/game.ts:896-919`, `src/engine/action/action.ts:330-470`

**Issue:**
`getTutorialDisabledActions` / `getActionLevelDisabledReasons` is called from
exactly two places — `buildPlayerState` (`utils.ts:455`) and `createPlayerView`
(`snapshot.ts:233`). It is **never** consulted in `validateArgs`,
`executeAction`, or `isActionAvailable`. The only engine-side enforcement is
value-level: `getGateReasonForValue` short-circuits to `null` whenever
`gate.action !== actionName` (`gate.ts:118`) and also for any value of the
allowed action when `from`/`to` are absent (`gate.ts:123`).

Net effect for the canonical on-rails gate `{ action: 'move' }` (no `from`/`to`):
- `move` choices: all enabled (no `from`/`to` → `null`).
- every *other* available action (`pass`, `endTurn`, …): not value-gated at all.

So the learner can execute any available action; the gate merely populates a
`disabledActions` reason map for the UI to honor voluntarily. That is opt-in
enforcement living in each UI — a direct violation of the project's
"secure defaults, not opt-in" Pit-of-Success rule and the hard rule that "all UI
interactions must work … in parity with shared state." A custom UI that does not
read `disabledActions` lets the learner walk straight off the rails, and a raw
action submission bypasses gating entirely. For a feature literally titled
"Action Gating," the disallowed-action case is not gated.

The `game.ts:912` JSDoc frames this as intentional ("gated actions are NOT
removed from availability — they stay visible so the UI can surface the reason"),
but surfacing a reason and *enforcing* the gate are different requirements;
Phase 104's scope includes the latter.

**Fix:** Make the engine authoritative. In the submission path
(`validateArgs` / `executeAction`), consult `getActionLevelDisabledReasons` for
the acting seat and reject a gated action with its reason, e.g.:

```typescript
const gated = getActionLevelDisabledReasons(this.game, player.seat, [action.name]);
if (gated[action.name]) {
  return { success: false, error: gated[action.name] };
}
```

Keep `getAvailableActions` binary (still listing the action so the UI can render
it disabled-with-reason), but ensure execution is blocked in shared state, not
per-UI.

## Medium Issues

### MR-01: `suppressAutoFill` is never wired to a production consumer (inert end-to-end)

**File:** `src/ui/composables/useActionController.ts:485-486`, `src/ui/composables/useActionControllerTypes.ts:294`

**Issue:**
`isTutorialSuppressingAutoFill` reads `options.tutorialStep?.value`, but no
GameShell/AutoUI/custom-UI consumer passes `tutorialStep`. The data path
`engine → session → PlayerGameState.tutorial.suppressAutoFill` terminates at the
session layer; nothing reads `PlayerGameState.tutorial` back into the controller
option. The three new unit tests (Case A/B/C) pass `tutorialStep` directly, so
they exercise the branch but **mask the missing wiring** — exactly the
"option ignored / test passes trivially" hazard called out in risk area #6.
Per CLAUDE.md ("trace at least one real value through the full stack … confirm
data survives every layer boundary"), the value dies at the UI boundary, so the
suppression feature does nothing in a real game.

**Fix:** Wire `PlayerGameState.tutorial` into `useActionController({ tutorialStep })`
at the shell/AutoUI call site (a `computed(() => playerState.value.tutorial)`),
and add one integration test that drives suppression through the real player
state rather than an injected ref. If wiring is deliberately deferred to a later
phase, say so explicitly in the plan and mark the unit tests as substrate-only.

### MR-02: Predicate gates are silently all-or-nothing (permissive foot-gun)

**File:** `src/engine/tutorial/gate.ts:113-115, 170-182`

**Issue:**
A `TutorialGatePredicate` is `(ctx) => boolean` with `ctx = { game, seat }` — no
action or value. `getGateReasonForValue` returns `null` for predicate gates
(no value-level discrimination), and `getActionLevelDisabledReasons` calls the
predicate once: `true` blocks nothing, `false` blocks every available action
uniformly. So a predicate authored to *permit one specific action* silently
permits **all** actions (returns true), and the only way to block anything is to
block everything. This is the opposite of Pit-of-Success: the natural authoring
attempt fails open. Combined with HR-01 (no execution enforcement), a predicate
gate provides essentially no real restriction.

**Fix:** Either give the predicate the discriminating context it needs
(`{ game, seat, actionName, value }`) so it can actually gate, or constrain the
type so the "permit one action" intent is impossible to express incorrectly
(e.g. require an explicit `{ actions: string[] }` shape). At minimum, document
loudly at the type that a predicate is whole-step all-or-nothing.

### MR-03: `start()` with an empty `steps` array silently produces a no-op "running" tutorial

**File:** `src/session/tutorial-controller.ts:125-136`

**Issue:**
`const firstStep = def.steps[0]; ... stepId: firstStep?.id ?? null`. If a game
ships `tutorial: { steps: [] }`, `start()` sets `{ stepId: null, status: 'running' }`.
`getActiveStep` then returns `null` (null stepId), so the tutorial is "running"
yet gates nothing and projects nothing — a silent misconfiguration that survives
serialization. CLAUDE.md mandates fail-fast-and-loud with actionable messages.

**Fix:** Guard in `#requireDefinition` (or `start`):

```typescript
if (def.steps.length === 0) {
  throw new Error(
    'Tutorial definition has no steps. Add at least one step to ' +
    'GameDefinition.tutorial.steps before starting the tutorial.'
  );
}
```

## Low Issues

### LR-01: `skip()` and `advance()` are byte-identical; no `'skipped'` state is ever recorded

**File:** `src/session/tutorial-controller.ts:146-163`

**Issue:** Both delegate to `#forwardAdvance` and produce identical
`TutorialProgress`. The JSDoc claims they are "semantically distinct," but
`TutorialProgress.status` has no `'skipped'` member, so the distinction is
unobservable in state, history, or undo. Two public methods that do exactly the
same thing is a Pit-of-Success smell (which do I call? does it matter?).

**Fix:** Either drop `skip()` and let callers use `advance()`, or record the
distinction (add `'skipped'` to the status union / a `skipped: true` marker) so
the API earns its second method.

### LR-02: `getGateReasonForValue` lumps `from` + `to` into one allowed set, blind to which selection is evaluated

**File:** `src/engine/tutorial/gate.ts:127-138`

**Issue:** The evaluator receives only `actionName` + `value`, not the selection
name, so it cannot enforce "`from` must be `c3`, `to` must be `d4`" — it only
enforces "value ∈ {c3, d4}". For a two-step move where `from`/`to` share a value
space (e.g. both coordinates, or a self-move), the wrong target would pass. Works
today only because piece-choices and square-choices are disjoint. `from`/`to` are
marked RESERVED (Phase 109) in the type doc yet are already wired into runtime
gating, so this latent looseness ships now.

**Fix:** When `from`/`to` graduate from RESERVED, plumb the selection name into
`getGateReasonForValue` and match `from` against the source selection and `to`
against the destination selection rather than a merged set.

### LR-03: `#forwardAdvance` before `start()` silently skips step 0

**File:** `src/session/tutorial-controller.ts:94-99`

**Issue:** With no prior progress, `currentStepId` defaults to `steps[0].id`,
`currentIndex = 0`, so `advance()` jumps to `steps[1]` — step 0 is never visited
and never marked `running`. The inline comment acknowledges "shouldn't happen,"
but the guard chooses a confusing recovery. Prefer setting step 0 `running` (or
throwing) when called before `start()`.

### LR-04 (info): every seat's `tutorialProgress` is shipped to every client

**File:** `src/engine/element/game.ts:2361-2509` (`toJSONForPlayer`)

**Issue:** `tutorialProgress` is a game-level own attribute, so the full
all-seats Map is included in each player's `toJSONForPlayer` tree (visibility
filtering only touches element children). Not secret, but it leaks other seats'
lifecycle state unnecessarily alongside the per-seat `tutorial` projection.
Consider treating cross-seat progress as count-only / per-seat-filtered if it
ever carries authored content.

---

_Reviewed: 2026-06-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
