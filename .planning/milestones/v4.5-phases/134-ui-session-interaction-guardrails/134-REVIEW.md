---
phase: 134-ui-session-interaction-guardrails
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - docs/custom-ui-guide.md
  - src/session/game-session.test.ts
  - src/session/game-session.ts
  - src/ui/components/auto-ui/ActionPanel.test.ts
  - src/ui/components/auto-ui/ActionPanel.vue
  - src/ui/components/GameShell.test.ts
  - src/ui/components/GameShell.vue
  - src/ui/composables/useActionController.picks.test.ts
  - src/ui/composables/useActionController.test.ts
  - src/ui/composables/useActionController.ts
  - src/ui/composables/useActionControllerTypes.ts
  - src/ui/composables/useDragDrop.test.ts
  - src/ui/composables/useDragDrop.ts
findings:
  critical: 2
  warning: 6
  info: 5
  total: 13
status: resolved
fixed_at: 2026-07-03
fix_scope: critical_warning
fixed: [CR-01, CR-02, WR-01, WR-02, WR-03, WR-04, WR-05, WR-06]
info_disposition: IN-05 resolved incidentally by WR-06; IN-01..IN-04 open (out of fix scope)
---

# Phase 134: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 13
**Status:** resolved — all Critical + Warning findings fixed 2026-07-03 (fix scope: critical_warning; IN-05 resolved incidentally, IN-01..IN-04 remain open)

## Summary

Phase 134 introduces seven guardrails across the UI action pipeline and session layer. The runner facade (SESS-01) is solid: all 5 `#runner` assignment sites rebuild `#runnerFacade`, `performAction` is absent at both the type and runtime levels, and no in-repo consumer relied on mutating members of `session.runner` (TestGame owns its own raw `GameRunner`). The `fill()` multiSelect guard and `start()` result changes are correct and tested.

The central toast chokepoint (UIX-01), however, has two correctness gaps that make it strictly weaker than the three ActionPanel toast sites it replaced: (1) Vue's ref-change semantics mean **identical consecutive failures produce no second toast** on all `fill()`-path failures (they never clear `lastError` to null between failures), and (2) **four `fill()` failure paths never set `lastError` at all**, so those failures now surface nothing — the ActionPanel comment claiming "fill() sets lastError on every failure path" is provably false. The 0×0 board diagnostic re-fires on every game-state broadcast (contradicting its own "fires once" comment), and the accumulated beforeAutoExecute hooks have no error isolation and an iteration/unregister hazard.

## Critical Issues

### CR-01: Toast chokepoint silently drops repeated identical failures (fill-path failures never clear lastError)

**File:** `src/ui/components/GameShell.vue:1805`, `src/ui/composables/useActionController.ts:1371,1428,1562,1631`
**Issue:** The UIX-01 watch fires only when `lastError`'s *value changes* (Vue ref triggers gate on `hasChanged`). The `execute()`/`executeCurrentAction()` paths clear `lastError` to `null` before each attempt, so repeated failures there re-fire. But every `fill()`-path failure sets `lastError` directly with **no intervening null-clear**:
- `fill()` validation failure (`lastError.value = validation.error`, line 1428)
- `fill()` multiSelect scalar rejection (line 1371)
- `handleOnSelectFill()` server rejection (lines 1562, 1631)
- `start()` unavailable-action (line 1272 area — repeated `start()` of the same unavailable action sets the same string; `devWarn` also dedups by key)

Concrete repro: a player clicks an invalid destination, gets the toast, then clicks the **same** (or any equally-invalid) destination again — `lastError` transitions `"Invalid selection for \"to\"" → "Invalid selection for \"to\""`, the ref does not trigger, and the retry gets no toast, no `assertiveMessage` update, no announce. The removed ActionPanel `toast.error(result.error)` fired on every attempt. This is a user-facing feedback regression at the exact center of the UIX-01 feature. The new GameShell test suite covers null→string transitions and same-tick batching, but never the identical-consecutive-failure case.
**Fix:** Watch a monotonic signal instead of the string. E.g. in the controller, replace direct `lastError` assignments with a `setError(msg)` helper that also bumps an `errorTick` counter; GameShell watches `errorTick` and reads `lastError.value` for the text:
```typescript
// useActionController.ts
const errorTick = ref(0);
function setError(msg: string): void {
  lastError.value = msg;
  errorTick.value++;
}
// ...use setError() at every failure site; expose errorTick (readonly)

// GameShell.vue
watch(actionController.errorTick, () => {
  const err = actionController.lastError.value;
  if (!err) return;
  toast.error(err);
  assertiveMessage.value = err;
  emitAnnounce('assertive', err);
});
```

**Resolution:** Fixed in `77b73ec4` (docs follow-up `e0958560`). All failure sites route through `setError()` which bumps a readonly `errorTick`; GameShell's UIX-01 chokepoint watches `errorTick` and reads the message from `lastError`. Red-first: retry-identical-failure harness test + controller-level `errorTick` test proven RED pre-fix. `custom-ui-guide.md` updated to describe the errorTick mechanism.

### CR-02: Four fill()-path failures never set lastError — those failures are now fully silent

**File:** `src/ui/composables/useActionController.ts:1338-1345,1437-1439,1543-1545`; comment at `src/ui/components/auto-ui/ActionPanel.vue:686-688`
**Issue:** The ActionPanel justification comment — "fill() sets actionController.lastError on every failure path, which GameShell's central watch surfaces" — is false. These paths return a failure `ValidationResult` **without** touching `lastError`:
1. `fill()` → `'No action in progress'` (line ~1339)
2. `fill()` → `'Unknown selection: "..."'` (line ~1344)
3. `handleRepeatingFill()` → `'pickStep function not provided for repeating pick'` (line ~1438)
4. `handleOnSelectFill()` → `'pickStep function not provided for onSelect routing'` (line ~1544)

Path 1 is reachable in normal play via a race: a state broadcast (or a followUp teardown) clears `currentAction` between render and the user's click; `setSelectionValue` calls `fill()`, gets `{ valid: false }`, and returns — previously this produced `toast.error('No action in progress')`, now the click does literally nothing visible. The docs (`custom-ui-guide.md`, "Every action failure surfaces automatically — you don't have to wire your own toast") make the same now-broken promise to custom-UI authors, who are explicitly told *not* to add their own toast.
**Fix:** Set `lastError` (via the `setError()` helper from CR-01) on all four paths before returning, e.g.:
```typescript
if (!currentActionMeta.value) {
  const error = 'No action in progress';
  setError(error);
  return { valid: false, error };
}
```
Then the ActionPanel comment and the guide's guarantee become true.

**Resolution:** Fixed in `0d857bf1`. All four paths now `setError()` before returning; the ActionPanel comment and the custom-ui guide's "every failure surfaces automatically" promise are now true. Red-first: 4 controller tests (one per path, including the broadcast-race "No action in progress" path) proven RED pre-fix.

## Warnings

### WR-01: 0×0 board diagnostic re-fires on every game-state broadcast — contradicts its own "fires once" contract; no once-latch, no hidden-board guard

**File:** `src/ui/components/GameShell.vue:1823-1840`
**Issue:** The watch source is `gameView`, a computed that produces a new object on **every** state broadcast. The comment claims "Fires once per genuine post-state collapse," but there is no latch: while a board is collapsed (or hidden), every broadcast schedules another `setTimeout(SETTLE_MS)` and logs another `console.error` — in an AI-vs-AI dev game that is a console flood, and each broadcast leaves a 300ms timer pending (never cleaned up on unmount; safe only because the template ref nulls). Additionally, `getBoundingClientRect()` returns 0×0 for any `display:none` ancestor — a board temporarily hidden by `v-show` (e.g. behind a full-board modal or a dev-host layout state) while children are mounted will false-positive even though its sizing CSS is correct. The tests only exercise a single `gameView` transition, so neither behavior is covered.
**Fix:** Add a module-local `let warned0x0 = false;` latch set before `console.error` (reset never — one report per session is enough for a structural CSS bug), and skip hidden boards:
```typescript
if (warned0x0) return;
if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return; // hidden, not collapsed
```
Also `clearTimeout` any prior pending check when the watch re-fires.

**Resolution:** Fixed in `c866e843`. Once-per-session `warned0x0` latch, `clearTimeout` of any prior pending settle-check, and an `offsetParent === null && position !== 'fixed'` hidden-board guard. Red-first: repeated-broadcast latch test + hidden-board (real detached element) test proven RED pre-fix.

### WR-02: A throwing beforeAutoExecute hook aborts remaining hooks AND execution, permanently wedging the action

**File:** `src/ui/composables/useActionController.ts:856-865`
**Issue:** The auto-execute watcher does `for (const hook of beforeAutoExecuteHooks.value) { await hook(...); } executeCurrentAction();` with no error handling. If any hook throws/rejects: (a) later-registered hooks (independent consumers, the whole point of UIX-05 accumulation) never run, (b) `executeCurrentAction()` never runs, (c) the rejection is unhandled inside a watch callback, and (d) `isReady` stays `true` so the watcher never re-fires — the action is stuck with all selections filled and nothing happening, with no toast (`lastError` untouched). With accumulation, one consumer's buggy animation hook now takes down every other consumer, where the old single-slot semantics at least confined the blast radius to the owner of the hook.
**Fix:** Isolate each hook and always proceed to execution:
```typescript
for (const hook of [...beforeAutoExecuteHooks.value]) {
  try { await hook(currentAction.value, buildServerArgs()); }
  catch (err) { console.error('[ActionController] beforeAutoExecute hook failed:', err); }
}
```

**Resolution:** Fixed in `b472eee4`. Each hook runs in its own try/catch with a loud `console.error('[ActionController] beforeAutoExecute hook failed:', err)`; `executeCurrentAction()` always proceeds. Red-first: throwing-hook test proven RED pre-fix.

### WR-03: Unregistering a hook during hook iteration skips the next hook

**File:** `src/ui/composables/useActionController.ts:860-862,943-951`
**Issue:** The watcher iterates `beforeAutoExecuteHooks.value` (the live array) while `setBeforeAutoExecute`'s unregister fn `splice`s that same array. A one-shot hook that unregisters itself inside its own body (a natural pattern: "capture positions for this action only, then remove") shifts the array under the `for...of` index iterator, so the hook registered immediately after it is silently skipped for that execution. Same hazard if hook A unregisters hook B.
**Fix:** Iterate a snapshot: `for (const hook of [...beforeAutoExecuteHooks.value])` (combines with the WR-02 fix above).

**Resolution:** Fixed in `d70eaf4a`. Watcher iterates `[...beforeAutoExecuteHooks.value]`. Red-first: self-unregistering one-shot hook test proven RED pre-fix.

### WR-04: Accumulation semantics leak hooks across component remounts — no scope-tied auto-unregister

**File:** `src/ui/composables/useActionController.ts:943-951`
**Issue:** Under the old replace semantics, a board component calling `actionController.setBeforeAutoExecute(hook)` in `setup()` self-healed across remounts. Under accumulation, every remount (dev UI switcher, seat switch in the dev host, HMR) registers an **additional** hook whose closure captures the unmounted component's scope — stale hooks keep running (duplicate animation captures, retained memory), and per WR-02 a stale hook that throws against dead DOM blocks execution entirely. Nothing in the controller ties registration to the caller's component lifetime; existing game code (BoardSmithGames, MERC) written against replace semantics gets this leak with zero code changes on its side. The docstring mentions the unregister fn but nothing enforces or defaults to calling it.
**Fix:** Pit of Success — auto-unregister when called inside a component/effect scope:
```typescript
import { getCurrentScope, onScopeDispose } from 'vue';
function setBeforeAutoExecute(hook: BeforeAutoExecuteHook): () => void {
  beforeAutoExecuteHooks.value.push(hook);
  const unregister = () => { /* splice as today */ };
  if (getCurrentScope()) onScopeDispose(unregister);
  return unregister;
}
```
(Also verify BoardSmithGames/MERC call sites per the cross-repo rule in CLAUDE.md.)

**Resolution:** Fixed in `304aa361`. `setBeforeAutoExecute` now calls `onScopeDispose(unregister)` when `getCurrentScope()` is active; scope-less registrations keep the manual-unregister contract. JSDoc updated in both the composable and the return type. Cross-repo call sites verified: cribbage `CribbageBoard.vue:539` (setup-scope, self-heals), demo-animation `GameTable.vue:344` (immediate watch in setup, self-heals), MERC `App.vue:126` — all register from component scopes; no game-side changes needed. Red-first: effectScope dispose test proven RED pre-fix.

### WR-05: ReadOnlyRunnerFacade is not exported from the session module entrypoint

**File:** `src/session/index.ts:112-118`, `src/session/game-session.ts:246`
**Issue:** `session.runner` now returns `ReadOnlyRunnerFacade<G>`, but the type is only exported from `game-session.ts` and is not re-exported in `src/session/index.ts` (the `export { GameSession, ... }` block omits it). External consumers (games, MERC) that need to name the type of `session.runner` — e.g. a helper function parameter `fn(runner: ReadOnlyRunnerFacade)` — cannot import it from the public `boardsmith/session` surface and are forced into `typeof session.runner` gymnastics or deep imports. A public getter's return type is public API.
**Fix:** Add `type ReadOnlyRunnerFacade` to the `export { ... } from './game-session.js'` block in `src/session/index.ts`.

**Resolution:** Fixed in `7c4c2373`. `type ReadOnlyRunnerFacade` added to the GameSession export block in `src/session/index.ts` (type-only change; no red-first test — tsc verifies).

### WR-06: dragProps `when:false` removes the onDragend handler — a `when` flip mid-drag strands boardInteraction in the dragging state

**File:** `src/ui/composables/useDragDrop.ts:216-223`
**Issue:** Before UIX-04, `dragProps()` always attached `onDragstart`/`onDragend`. Now, if `when` flips false while a drag is in flight (e.g. the in-progress action is torn down by a broadcast, flipping the caller's `canDrag` computed) and the component re-renders, `v-bind` removes both handlers. When the user releases, no `dragend` listener runs, so `boardInteraction.endDrag()` is never called — `isDragging` stays true and drop-target/hover highlights stay wedged until some other interaction clears them. `drag()` has always had this hazard (it returned `{}`), but UIX-04 newly introduces it for `dragProps()` consumers who previously kept their handlers unconditionally.
**Fix:** Keep the `onDragend` handler even in the inert branch:
```typescript
if (!evalCondition(options)) {
  return {
    draggable: false as const,
    onDragend: () => { if (boardInteraction?.isDragging) boardInteraction.endDrag(); },
  };
}
```
(Apply the same to `drag()`'s inert branch for parity.)

**Resolution:** Fixed in `e239a958`. Both `dragProps()` and `drag()` now return a shared `InertDragProps` shape (`draggable: false`, no `onDragstart`, `onDragend` retained and guarded to only run user cleanup + `endDrag()` when a drag is actually in flight). This also resolves IN-05 (the two divergent inert shapes are unified). Red-first: mid-drag `when`-flip tests for both `dragProps()` and `drag()` proven RED pre-fix.

## Info

### IN-01: Fallback toast text in the UIX-01 watch is dead code

**File:** `src/ui/components/GameShell.vue:1807-1809`
**Issue:** `lastError` is typed `Ref<string | null>`; after `if (!err) return;` the value is necessarily a non-empty string, so `typeof err === 'string' && err.length > 0` is always true and the `` `${currentAction ?? 'Action'} failed…` `` branch is unreachable. Harmless belt-and-suspenders, but the comment ("the UIX-01 fallback copy below") implies it can fire.
**Fix:** Either delete the branch or keep it with a comment noting it is provably unreachable given the current type.

### IN-02: multiSelect rejection message can render "max undefined"

**File:** `src/ui/composables/useActionController.ts:1366-1369`
**Issue:** `multiSelectCfg.max` is optional; for an unbounded multiSelect the error reads "(min 2, max undefined)".
**Fix:** `` `(min ${cfg.min}${cfg.max !== undefined ? `, max ${cfg.max}` : ''})` ``.

### IN-03: GameShell tests duplicate the production watch bodies instead of exercising them

**File:** `src/ui/components/GameShell.test.ts:150-390`
**Issue:** Both new suites copy-paste the watch source into a harness ("mirrors GameShell.vue exactly"). Any future drift in GameShell.vue (including fixing CR-01 there) leaves these tests green while testing stale code. The comments acknowledge the tradeoff (WebSocket-heavy component), but extracting the watch bodies into small exported functions (e.g. `createActionErrorWatchHandler(deps)`) would let the tests import the real code.
**Fix:** Extract the handler functions from GameShell.vue and import them in both the component and the tests.

### IN-04: Facade freshness relies on 5 call sites remembering to rebuild

**File:** `src/session/game-session.ts:392-393,431-432,537-538,1523-1524,1544-1545`
**Issue:** All current `#runner = …` sites correctly rebuild `#runnerFacade` (verified), but the invariant is manual — the sixth future assignment site is a latent staleness bug. Closing the facade over a getter removes the class of bug: `buildRunnerFacade(() => this.#runner)` built once in the constructor, with each member reading `getRunner()`.
**Fix:** Change `buildRunnerFacade` to take `getRunner: () => GameRunner<G>` and build the facade exactly once.

### IN-05: Two different inert shapes for disabled drag

**File:** `src/ui/composables/useDragDrop.ts:219-221,337-338`
**Issue:** `dragProps()` with `when:false` returns `{ draggable: false }` while `drag().props` returns `{}` for the same condition. Both work under `v-bind`, but the asymmetry is a small API inconsistency.
**Fix:** Return the same inert shape from both (whichever survives the WR-06 fix).

**Resolution:** Resolved incidentally by the WR-06 fix (`e239a958`) — both now return the shared `InertDragProps` shape.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
