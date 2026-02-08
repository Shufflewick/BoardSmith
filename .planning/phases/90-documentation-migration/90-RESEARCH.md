# Phase 90: Documentation & Migration - Research

**Researched:** 2026-02-07
**Domain:** Documentation updates, example game migration, animation system v3.0
**Confidence:** HIGH

## Summary

This phase updates BoardSmith documentation and example games to reflect the v3.0 animation system changes. The core transformation is replacing the server-side theatre view model (mutation capture, acknowledgment protocol, theatre/current view split) with a client-side animation timeline model (pure data events, no server involvement in playback).

Three documentation files need updates (`ui-components.md`, `nomenclature.md`, new `migration-guide.md`). Two example games need migration: `demo-animation` (uses `game.animate()` with empty callbacks, needs verification) and `cribbage` (uses `game.animate()` with truth-advancing callbacks and an obsolete `acknowledge` parameter in `createAnimationEvents`).

**Primary recommendation:** Update docs to remove all theatre/mutation-capture/acknowledge language, then migrate games by removing the `acknowledge` parameter and updating `game.animate()` calls from the callback pattern where appropriate. Callbacks that advance truth are still supported as convenience -- the key change is they no longer capture mutations.

## Findings by Area

### 1. ui-components.md Animation Events Section (DOC-02)

**Confidence: HIGH** -- Directly read the file and compared against the v3.0 engine code.

The "Animation Events" section (lines 1090-1307) extensively describes the **old v2.9 theatre view model**. Key outdated content:

| Line Range | Outdated Content | What It Says | What v3.0 Actually Does |
|------------|------------------|--------------|------------------------|
| 1092-1101 | Key Concepts intro | "Animation events capture mutations for the theatre view system" | Animation events are pure data signals; no mutation capture |
| 1096-1101 | Theatre view description | Theatre state holds pre-animation snapshot, clients acknowledge to advance | No theatre state. One view = truth. Client manages playback locally |
| 1101 | Theatre view benefit | "theatre view ensures players see state consistent with last acknowledged animation" | Players always see truth; animations are visual overlays |
| 1105 | Engine-side heading | "`game.animate(type, data, callback)` -- mutations go inside callback" | Callback is optional convenience, mutations are NOT captured |
| 1131 | Parameter table | callback described as "mutations inside are captured for the theatre view" | Callback just runs immediately as normal game code |
| 1133-1135 | Mutation capture/Theatre view paragraphs | Full description of CapturedMutation[], theatre snapshot replay | All removed. No mutation capture, no theatre snapshot |
| 1137-1145 | Empty callbacks paragraph | "Some events exist purely to signal the UI" -- implies callback is usually for mutations | Callback is always a convenience for co-locating logic. Pure data is the default form |
| 1166-1186 | createAnimationEvents setup | Shows `acknowledge` callback parameter | `acknowledge` no longer exists in the API |
| 1287-1290 | Forgetting to acknowledge | "Events accumulate if not acknowledged" | No acknowledgment system exists |

**What must change:**
- Rewrite "Key Concepts" to describe pure data event model
- Update `game.animate()` API docs to show `game.animate(type, data)` as primary form, callback as optional convenience (not for mutation capture)
- Remove all `acknowledge` references from `createAnimationEvents` example
- Remove "Mutation capture" and "Theatre view" paragraphs
- Update pitfalls section (remove acknowledgment pitfall, update others)
- Add documentation for `handlerWaitTimeout` (new in v3.0, default 3s)

### 2. nomenclature.md Theatre/Current View References (DOC-03)

**Confidence: HIGH** -- Directly read the file and identified all references.

The following entries need updating or removal:

**Quick Reference Table (lines 8-46):**
- Line 10: `Animation Event` -- described as "capturing mutations for theatre view playback" -- needs rewrite to "pure data signal for UI animation playback"
- Line 12: `Current View` -- "real, up-to-date game state (opt-in for truth-needing components)" -- **REMOVE entirely**. No longer a concept.
- Line 13: `Mutation Capture` -- "System recording element operations inside `game.animate()` callbacks" -- **REMOVE entirely**.
- Line 44: `Theatre View` -- "Frozen snapshot of game state shown during animation playback" -- **REMOVE entirely**.

**Animation Section (lines 427-493):**
- Lines 433-439: `Animation Event` definition -- references "captures state mutations", "theatre view advancement system", related terms include Theatre View, Current View, Mutation Capture. Rewrite as pure data event.
- Lines 451-460: `Soft Continuation` definition -- references "theatre view renders pre-animation state". Update to reflect client-side timeline model.
- Lines 462-471: `Theatre View` full definition and examples -- **REMOVE entirely**.
- Lines 473-482: `Current View` full definition and examples -- **REMOVE entirely**.
- Lines 484-493: `Mutation Capture` full definition and examples -- **REMOVE entirely**.

**What should replace removed entries:**
- `Animation Timeline` -- new concept: "Client-side playback queue that processes animation events sequentially, with wait-for-handler behavior for lazily mounted components"
- Update `Soft Continuation` to describe the simpler model: "state advances immediately, UI plays back events as visual overlays on truth"

### 3. migration-guide.md (DOC-04)

**Confidence: HIGH** -- File does not exist. Must be created from scratch.

The file `docs/migration-guide.md` does not exist yet. BREAKING.md (already written in prior phases) contains the raw breaking change information that should inform the migration guide. The migration guide should be user-facing and task-oriented (not just listing removals like BREAKING.md).

**Content from BREAKING.md to reference:**
- Theatre View System removal (full API table of removed items)
- Mutation Capture removal (before/after code examples)
- Acknowledgment Protocol removal (before/after code examples)
- currentView / Theatre View Split removal (before/after code examples)

**Migration guide should cover:**
1. Engine-side changes: `game.animate(type, data, callback)` -> `game.animate(type, data)` (callback optional convenience, no mutation capture)
2. UI-side changes: `createAnimationEvents({ events, acknowledge })` -> `createAnimationEvents({ events })`; `acknowledge` parameter gone
3. `useCurrentView()` -> use `gameView` from GameShell directly
4. `game.theatreState` / `game.theatreStateForPlayer()` -> `game.toJSON()` / `game.toJSONForPlayer()`
5. Custom UI components: replace any `useCurrentView()` with standard `gameView` prop
6. Wait-for-handler behavior (new): events wait up to `handlerWaitTimeout` (default 3s) for handlers to register before skipping

### 4. demo-animation Game (DOC-05)

**Confidence: HIGH** -- Read all source files.

**Location:** `/Users/jtsmith/BoardSmithGames/demo-animation/`

**Current state analysis:**

Rules (engine-side):
- `actions.ts` line 337-349: `createAnimationEventAction` uses `game.animate('demo', data, () => {})` with an **empty callback**. This is valid in v3.0 (callback is optional, empty is harmless) but should be simplified to `game.animate('demo', data)` to model the new pattern cleanly.
- Comments in `actions.ts` lines 307-315 describe "Captures state mutations for theatre view advancement" and "Queues events for sequential playback" -- **outdated comments** that need updating.

UI (client-side):
- `GameTable.vue` line 68: Comment says "Inject animation events from GameShell (which creates and provides it with server acknowledge)" -- **outdated comment**. GameShell's `createAnimationEvents` no longer takes an `acknowledge` parameter.
- `GameTable.vue` lines 72-95: Handler for 'demo' event type works correctly -- it's a pure UI handler that shows a toast. No migration needed in the handler logic itself.
- The game uses `useAnimationEvents()` (inject pattern) correctly -- GameShell creates and provides the instance.

**Migration work needed:**
1. Remove empty callback `() => {}` from `game.animate()` call in `actions.ts`
2. Update comments in `actions.ts` to describe pure data model (not theatre/mutation capture)
3. Update comment in `GameTable.vue` line 68
4. Verify the game runs correctly in browser after changes

### 5. Cribbage Game (DOC-06)

**Confidence: HIGH** -- Read all relevant source files.

**Location:** `/Users/jtsmith/BoardSmithGames/cribbage/`

**Current state analysis:**

The cribbage game **heavily uses `game.animate()`** -- it's a core part of the scoring system.

Rules (engine-side):
- `game.ts` lines 594-748: `scoreRoundAndBuildSummary()` emits animation events for scoring reveal:
  - `game.animate('score-hand-start', data, () => {})` -- empty callback (pure signal)
  - `game.animate('score-item', data, () => {})` -- empty callback (pure signal)
  - `game.animate('score-hand-complete', data, () => { this.addPoints(...) })` -- **truth-advancing callback** -- this IS still valid in v3.0 (callback runs immediately, addPoints generates its own commands)
- Comments mention "theatre view state advancement" (line 595) -- **outdated**

UI (client-side):
- `CribbageBoard.vue` lines 283-289: `createAnimationEvents` is called with an **`acknowledge` parameter that no longer exists** in the v3.0 API:
  ```typescript
  const animationEventsController = createAnimationEvents({
    events: () => props.gameView?.attributes?.animationEvents as AnimationEvent[] | undefined,
    acknowledge: (upToId: number) => {  // THIS PARAMETER DOESN'T EXIST ANYMORE
      console.log('[Cribbage AnimationEvents] Acknowledged up to ID:', upToId);
    },
  });
  ```
  TypeScript should be erroring on this. This is the PRIMARY migration issue.
- `CribbageBoard.vue` lines 295-361: Animation event handlers (`score-hand-start`, `score-item`, `score-hand-complete`) are pure UI handlers that work correctly with v3.0.

**Migration work needed:**
1. Remove `acknowledge` parameter from `createAnimationEvents()` call in `CribbageBoard.vue`
2. Remove empty callbacks from `game.animate()` calls for `score-hand-start` and `score-item` events -- simplify to `game.animate(type, data)`
3. Keep callbacks for `score-hand-complete` events -- these advance truth (`this.addPoints(...)`)
4. Update outdated comments referencing theatre view
5. Verify the game runs correctly in browser after changes

### 6. New Animation System API Summary

**Confidence: HIGH** -- Read the actual source code.

**Engine-side: `game.animate(type, data, callback?)`**
- `type: string` -- event type identifier
- `data: Record<string, unknown>` -- JSON-serializable payload
- `callback?: () => void` -- optional, runs immediately as normal game code (no capture)
- Creates an ANIMATE command and pushes event to buffer
- Buffer clears at `performAction()` boundaries
- AnimateCommand is NOT invertible (like MESSAGE command)

**UI-side: `createAnimationEvents(options)`**
```typescript
interface UseAnimationEventsOptions {
  events: () => AnimationEvent[] | undefined;  // reactive getter
  defaultDuration?: number;   // delay for events without handlers (default: 0)
  handlerWaitTimeout?: number; // wait for handler registration (default: 3000ms)
}
```

**UI-side: `useAnimationEvents()` / `registerHandler()`**
- Inject from ancestor via `useAnimationEvents()`
- Register handlers: `registerHandler(type, async (event) => { ... })`
- Returns cleanup function
- Instance API: `isAnimating`, `paused`, `skipAll()`, `pendingCount`

**Wait-for-handler behavior (new in v3.0):**
- When processing an event with no registered handler, the queue pauses up to `handlerWaitTimeout` (default 3s)
- If a handler registers during the wait, processing resumes immediately
- If timeout expires, a console warning is logged and the event is skipped
- This prevents fire-and-forget silent consumption of events

### 7. Other Docs That Reference Outdated Concepts

**Confidence: HIGH** -- Searched all docs files.

Only three files contain theatre/currentView/mutation-capture references:
1. `docs/ui-components.md` -- covered in finding #1
2. `docs/nomenclature.md` -- covered in finding #2
3. `docs/game-examples.md` -- line 379 mentions `acknowledgeScore` which is a **game action name** (not the animation acknowledge protocol). No change needed.

No other documentation files reference the removed concepts.

## Standard Stack

Not applicable for this phase -- this is a documentation and migration task, not new code construction. The "stack" is the existing codebase.

## Architecture Patterns

### Documentation Update Pattern

When updating docs to reflect API changes:

1. **Search-and-replace outdated concepts** -- find all references to removed APIs
2. **Update code examples** -- ensure all code snippets show current API
3. **Preserve structure** -- keep the same heading hierarchy and organization
4. **Add migration context** -- help users who learned the old way transition

### Example Game Migration Pattern

1. **Identify all uses of changed APIs** -- grep for `animate(`, `createAnimationEvents`, `acknowledge`, `useCurrentView`, `theatreState`
2. **Categorize changes** -- some are breaking (acknowledge parameter), some are cleanup (empty callbacks)
3. **Apply changes** -- update code
4. **Verify in browser** -- run the game and test the animated features

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration guide format | Custom format | Follow BREAKING.md structure with before/after examples | Consistency with existing documentation |
| Finding outdated references | Manual reading | Grep for known terms (theatre, currentView, acknowledge, mutation capture) | Systematic, catches all references |

## Common Pitfalls

### Pitfall 1: Removing Truth-Advancing Callbacks

**What goes wrong:** Removing ALL callbacks from `game.animate()` including ones that advance game state (like `this.addPoints()`)
**Why it happens:** BREAKING.md says "The animate callback pattern is gone" which is misleading -- callbacks are still supported, they just don't capture mutations
**How to avoid:** Only remove empty callbacks `() => {}`. Keep callbacks that contain game logic. The callback is now a convenience for co-locating logic, not for mutation capture.
**Warning signs:** Game state stops advancing after scoring if the callback is removed

### Pitfall 2: Not Removing the `acknowledge` Parameter

**What goes wrong:** TypeScript should catch this, but if type checking is loose, the dead `acknowledge` callback silently does nothing
**Why it happens:** The parameter was removed from the interface but existing code still passes it
**How to avoid:** Always remove the `acknowledge` property from `createAnimationEvents()` calls

### Pitfall 3: Documentation Inconsistency

**What goes wrong:** Updating one doc but leaving references in another, creating conflicting documentation
**Why it happens:** Theatre view concepts span multiple docs (ui-components.md, nomenclature.md)
**How to avoid:** Update all three target docs (ui-components, nomenclature, migration-guide) as a coordinated set. Grep to verify no remaining references.

### Pitfall 4: Forgetting to Verify in Browser

**What goes wrong:** Code compiles but animations don't play correctly
**Why it happens:** Animation behavior depends on runtime timing, DOM state, and event ordering
**How to avoid:** Success criteria explicitly require browser verification for both demo-animation and cribbage games

## Code Examples

### Before/After: Engine-side game.animate()

**Before (v2.9 -- mutation capture):**
```typescript
game.animate('combat', { damage: 5 }, () => {
  target.health -= damage;   // Captured as SET_PROPERTY mutation
  target.putInto(graveyard); // Captured as MOVE mutation
});
// event.mutations = [SET_PROPERTY, MOVE]
```

**After (v3.0 -- pure data + optional callback):**
```typescript
// Pure data form (preferred for signals)
game.animate('score-item', { points: 10, description: 'Pair' });

// With truth-advancing callback (convenience, no capture)
game.animate('score-hand-complete', { total: 15 }, () => {
  this.addPoints(player, 15, 'Hand');
});
// event = { type: 'score-hand-complete', data: { total: 15 } }
// callback ran but mutations are NOT on the event
```

### Before/After: UI-side createAnimationEvents()

**Before (v2.9):**
```typescript
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  acknowledge: (upToId) => {
    session.acknowledgeAnimations(playerSeat, upToId);
  },
  defaultDuration: 0,
});
```

**After (v3.0):**
```typescript
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  defaultDuration: 0,
  handlerWaitTimeout: 3000,  // new: wait for lazy handler registration
});
```

### Before/After: useCurrentView

**Before (v2.9):**
```typescript
import { useCurrentView } from 'boardsmith/ui';
const view = useCurrentView(); // theatre during animation, truth after
```

**After (v3.0):**
```typescript
// useCurrentView is removed. Use gameView directly.
// gameView from GameShell is always truth.
const { gameView } = props; // always current truth
```

## Detailed Migration Checklists

### demo-animation Game

| File | Line | Change | Type |
|------|------|--------|------|
| `src/rules/actions.ts` | 337 | `game.animate('demo', data, () => {})` -> `game.animate('demo', data)` | Cleanup |
| `src/rules/actions.ts` | 307-315 | Update comments about mutation capture/theatre view | Cleanup |
| `src/ui/components/GameTable.vue` | 68 | Update comment about "server acknowledge" | Cleanup |

### cribbage Game

| File | Line | Change | Type |
|------|------|--------|------|
| `src/rules/game.ts` | 595 | Update comment about "theatre view state advancement" | Cleanup |
| `src/rules/game.ts` | 607,658,710 | `game.animate('score-hand-start', data, () => {})` -> `game.animate('score-hand-start', data)` | Cleanup |
| `src/rules/game.ts` | 623,674,726 | `game.animate('score-item', data, () => {})` -> `game.animate('score-item', data)` | Cleanup |
| `src/rules/game.ts` | 635,686,738 | KEEP callbacks for `score-hand-complete` -- they advance truth | No change |
| `src/ui/components/CribbageBoard.vue` | 283-289 | Remove `acknowledge` parameter from `createAnimationEvents()` | Breaking fix |
| `src/ui/components/CribbageBoard.vue` | 284 | Check if `animationEvents` path is correct for new state shape | Verify |

## Open Questions

1. **Cribbage animation events path**: The cribbage UI reads events from `props.gameView?.attributes?.animationEvents`. In the main app, GameShell reads from `state.value?.state?.animationEvents`. These may or may not be equivalent depending on how the game view serialization works. The planner should verify this path works correctly in browser.

2. **TypeScript strictness in example games**: The cribbage game passes an `acknowledge` parameter that no longer exists on the interface. If TypeScript is strict, this should already be a compile error. Need to verify whether the game currently compiles or is silently broken.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` lines 2340-2368 -- `game.animate()` v3.0 implementation
- `/Users/jtsmith/BoardSmith/src/ui/composables/useAnimationEvents.ts` -- full composable source, no `acknowledge` parameter
- `/Users/jtsmith/BoardSmith/BREAKING.md` -- v3.0 breaking changes documentation
- `/Users/jtsmith/BoardSmith/docs/ui-components.md` -- current (outdated) animation events docs
- `/Users/jtsmith/BoardSmith/docs/nomenclature.md` -- current (outdated) terminology definitions
- `/Users/jtsmith/BoardSmithGames/demo-animation/` -- full game source
- `/Users/jtsmith/BoardSmithGames/cribbage/` -- full game source

### Verification
- `docs/migration-guide.md` confirmed not to exist (file not found)
- `docs/game-examples.md` line 379 `acknowledgeScore` is game action name, not animation system concept
- No other docs files reference removed concepts (grep verified)

## Metadata

**Confidence breakdown:**
- Documentation scope (what needs changing): HIGH -- directly compared doc content against engine source
- demo-animation migration: HIGH -- read all source files, changes are straightforward
- cribbage migration: HIGH -- read all source files, identified exact breaking changes
- migration-guide content: HIGH -- BREAKING.md provides comprehensive reference material

**Research date:** 2026-02-07
**Valid until:** Stable -- this documents completed v3.0 changes, not evolving APIs
