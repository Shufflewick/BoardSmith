# Phase 86: Simplified Animation Events - Research

**Researched:** 2026-02-07
**Domain:** Engine command system, animation event API, serialization
**Confidence:** HIGH

## Summary

Phase 86 builds the new `game.animate(type, data)` API on top of the infrastructure remaining after Phase 85's theatre erasure. The current codebase has the animation event buffer (`_animationEvents`, `_animationEventSeq`), the `pendingAnimationEvents` getter, and `acknowledgeAnimationEvents()` (stripped to buffer-only clearing). What is missing is the `animate()` method itself and command stack integration.

The core work is: (1) add a new `ANIMATE` command type to the command system, (2) rebuild `game.animate()` to push an `ANIMATE` command to the command stack AND populate the animation event buffer, (3) implement the optional callback that advances truth without capturing mutations, and (4) define the buffer lifecycle so events persist across flow steps but get replaced when the next batch arrives.

**Primary recommendation:** Add `AnimateCommand` to the `GameCommand` union type, implement `executeAnimate()` in the command executor, and rebuild `game.animate()` as a thin wrapper that calls `this.execute({ type: 'ANIMATE', ... })`. The optional callback runs immediately after the command, as normal game code.

## Standard Stack

No new libraries needed. This phase extends existing engine internals.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| TypeScript | existing | Type-safe command system extension | Command union type ensures exhaustive handling |
| vitest | existing | Test new animate() API and serialization | Matches existing test infrastructure |

**Installation:** None needed.

## Architecture Patterns

### Pattern 1: ANIMATE Command Type

**What:** A new command type `ANIMATE` that carries the event type and data as pure data. When executed, it pushes an entry to the animation event buffer.

**When to use:** Every time `game.animate()` is called.

**Why this pattern:** The success criterion explicitly states "Animation events appear as entries on the command stack and survive serialization round-trips." The command stack (`commandHistory`) is already serialized via `createSnapshot()` and replayed via `replayCommands()`. Making animation events commands gives them serialization for free.

**Current command system structure:**
```
src/engine/command/types.ts    -- GameCommand union type (16 command types)
src/engine/command/executor.ts -- executeCommand() switch statement
src/engine/command/inverse.ts  -- createInverseCommand() for undo
```

The `AnimateCommand` interface:
```typescript
export interface AnimateCommand extends BaseCommand {
  type: 'ANIMATE';
  /** Animation event type (e.g., 'combat', 'score-item') */
  eventType: string;
  /** Event-specific data payload (must be JSON-serializable) */
  data: Record<string, unknown>;
}
```

Add to the `GameCommand` union:
```typescript
export type GameCommand =
  | CreateElementCommand
  | ...existing...
  | AnimateCommand;
```

### Pattern 2: executeAnimate() Handler

**What:** The command executor handles `ANIMATE` by pushing an `AnimationEvent` into the game's buffer.

**How it integrates:**
```typescript
// In executor.ts
case 'ANIMATE':
  return executeAnimate(game, command);

function executeAnimate(game: Game, command: AnimateCommand): CommandResult {
  game.pushAnimationEvent(command.eventType, command.data);
  return { success: true };
}
```

The `pushAnimationEvent` method on Game increments `_animationEventSeq`, creates an `AnimationEvent` object, and pushes it to `_animationEvents`. This method needs to be accessible from the executor (either public or package-internal).

### Pattern 3: game.animate() as Command Wrapper

**What:** The public `animate()` method creates and executes an `ANIMATE` command, then optionally runs a callback.

```typescript
animate(type: string, data: Record<string, unknown>, callback?: () => void): void {
  this.execute({ type: 'ANIMATE', eventType: type, data });
  if (callback) {
    callback();
  }
}
```

Key design points:
- The callback runs AFTER the ANIMATE command is on the stack
- The callback's mutations (e.g., `piece.remove()`) generate their own commands (MOVE, SET_ATTRIBUTE, etc.) that also land on the command stack
- There is NO mutation capture -- the callback is just normal game code
- The callback's commands are NOT associated with the animation event in any way

### Pattern 4: Animation Event Buffer Lifecycle (ENG-04)

**What:** The animation event buffer persists across flow steps and is replaced when the next batch arrives.

The success criterion says: "The animation event buffer persists across flow steps and is replaced when the next batch of events arrives (not accumulated indefinitely)."

This means:
- When `game.animate()` is called, events are added to the buffer
- Between flow steps (when the flow awaits input and then resumes), the buffer persists -- the UI can read events
- When the NEXT set of `animate()` calls happens (next action execution), the previous events are cleared and replaced

Implementation approach: Clear the animation event buffer at the START of each action execution, before any game code runs. This way:
- Events from the previous action persist during the flow step pause (UI reads them)
- When a new action starts, old events are cleared
- New `animate()` calls during that action populate a fresh buffer

Where to hook this: In `FlowEngine.resume()` or `Game.performAction()`, clear `_animationEvents` before executing the action. The simplest and most reliable place is at the top of `performAction()`.

```typescript
performAction(actionName: string, player: P, args: Record<string, unknown>): ActionResult {
  // Clear previous animation events -- new action starts a new batch
  this._animationEvents = [];

  const action = this._actions.get(actionName);
  if (!action) {
    return { success: false, error: `Unknown action: ${actionName}` };
  }
  return this._actionExecutor.executeAction(action, player, args);
}
```

### Pattern 5: Inverse Command for ANIMATE

**What:** The ANIMATE command is not invertible -- animation events are UI hints, not game state mutations.

```typescript
// In inverse.ts
case 'ANIMATE':
  return null; // Not invertible
```

This is consistent with MESSAGE commands which are also not invertible.

### Recommended Project Structure Changes

```
src/engine/command/types.ts       -- Add AnimateCommand to union
src/engine/command/executor.ts    -- Add executeAnimate case
src/engine/command/inverse.ts     -- Add ANIMATE -> null case
src/engine/element/game.ts        -- Add animate() method, pushAnimationEvent()
```

### Anti-Patterns to Avoid

- **Separate storage from commands:** Do NOT store animation events only in the buffer without also recording on the command stack. The command stack is the authoritative record; the buffer is a derived convenience.
- **Capturing callback mutations:** The callback's mutations are normal game code. Do NOT try to associate them with the animation event. The old system's mutation capture was explicitly removed.
- **Accumulating events indefinitely:** The buffer MUST be cleared between batches. If events accumulate across multiple actions, the UI will replay stale events.
- **Making animate() affect game state:** The ANIMATE command itself should not modify any game element state. It only pushes to the event buffer. The callback (if any) modifies state via its own commands.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Serialization of animation events | Custom serialization format | Command stack serialization | Commands already survive `createSnapshot()` / `replayCommands()` round-trips |
| Event ordering / unique IDs | Custom ID generator | Existing `_animationEventSeq` counter | Already implemented, monotonically increasing |
| Buffer lifecycle management | Complex event sourcing | Clear-on-new-action pattern | Simple, predictable, matches flow step semantics |

**Key insight:** The command stack already handles serialization, replay, and ordering. By making animation events commands, all of these come for free. The `_animationEvents` buffer is then just a runtime cache that can be rebuilt by replaying commands.

## Common Pitfalls

### Pitfall 1: ANIMATE Commands Breaking MCTS/AI

**What goes wrong:** MCTS uses `undoLastCommand()` and `replayCommands()`. ANIMATE commands in the command history could confuse the bot or slow down simulation.
**Why it happens:** MCTS clones game state and replays/undoes commands thousands of times per turn.
**How to avoid:** ANIMATE commands are not invertible (inverse returns null), which means MCTS cannot undo past an ANIMATE command. However, this should be acceptable because:
  1. ANIMATE is typically emitted alongside actual state-mutating commands (from the callback)
  2. MCTS already handles non-invertible commands (SHUFFLE, CREATE, MESSAGE) by falling back to full state restore
  3. The executeAnimate handler should be cheap (just a buffer push)
**Warning signs:** MCTS test failures, slow AI turns.
**Recommendation:** Verify that `executeAnimate` during replay simply pushes to the buffer without side effects. During MCTS, animation events in the buffer are harmless dead data.

### Pitfall 2: Buffer Not Cleared Between Actions

**What goes wrong:** UI receives accumulated events from multiple actions, replaying stale animations.
**Why it happens:** If the buffer is never cleared, events from action N are still present when action N+1 completes.
**How to avoid:** Clear `_animationEvents` at the start of `performAction()`. This ensures each action's events are a fresh batch.
**Warning signs:** UI replaying the same animation events repeatedly, growing event count.

### Pitfall 3: Buffer Cleared During Flow Execute Blocks

**What goes wrong:** An `execute()` flow node calls `game.animate()` (outside an action). If the buffer is only cleared in `performAction()`, execute-block animations accumulate.
**Why it happens:** `execute` flow nodes run between actions, not inside them.
**How to avoid:** Two options:
  1. Only allow `animate()` inside action execute blocks (enforce with runtime warning)
  2. Also clear the buffer before execute flow nodes

**Recommendation:** Allow `animate()` anywhere (it is just a command), but document that the buffer lifecycle is tied to action boundaries. Events emitted in execute blocks will persist until the next action clears them. This is actually fine -- execute blocks run synchronously during flow processing, and their events will be included in the same state broadcast as the preceding action.

### Pitfall 4: Replay Rebuilds Buffer Incorrectly

**What goes wrong:** When replaying commands via `replayCommands()`, every ANIMATE command pushes to the buffer, rebuilding ALL historical events.
**Why it happens:** `replayCommands()` calls `executeCommand()` for each command, which includes ANIMATE handlers.
**How to avoid:** After replay, the buffer will contain all animation events from the entire history. This is actually consistent with the current behavior where `restoreGame()` explicitly restores animation events from JSON. However, the buffer should only contain events from the CURRENT batch (latest action).
**Recommendation:** After `replayCommands()`, clear the animation event buffer. The buffer is ephemeral and only relevant for the current state broadcast. Alternatively, have `executeAnimate` be a no-op during replay (check a replay flag). The simplest approach: the buffer is cleared at the start of each `performAction()`, so after replay + flow resume, only the latest action's events remain.

**Actually:** Looking at the current code more carefully, `replayCommands()` replays low-level commands, then `start()` + `continueFlow()` replay actions at the flow level. Each `continueFlow()` calls `performAction()` which would clear the buffer. So the final buffer state after full restore will only contain events from the last action. This is correct behavior with no special handling needed.

### Pitfall 5: Missing Exhaustive Switch Warning

**What goes wrong:** Adding `AnimateCommand` to the `GameCommand` union without updating all switch statements causes a TypeScript error.
**Why it happens:** The command system has 3 files with switch statements: `executor.ts`, `inverse.ts`, and potentially test files.
**How to avoid:** Update ALL three files when adding the new command type. TypeScript's exhaustive checking (the `default` case) will flag any misses.

### Pitfall 6: Callback Errors Swallowed

**What goes wrong:** If the optional callback throws, the ANIMATE command is already on the stack but the callback's effects are incomplete.
**Why it happens:** The callback runs after the command is recorded.
**How to avoid:** Let exceptions propagate naturally. The ANIMATE command on the stack is fine -- it is a UI hint. If the callback fails, the action itself should fail, and the flow engine handles that. Do NOT wrap the callback in try/catch.

## Code Examples

### AnimateCommand Type Definition

```typescript
// src/engine/command/types.ts
export interface AnimateCommand extends BaseCommand {
  type: 'ANIMATE';
  /** Animation event type (e.g., 'combat', 'score-item') */
  eventType: string;
  /** Event-specific data payload (must be JSON-serializable) */
  data: Record<string, unknown>;
}

// Add to GameCommand union:
export type GameCommand =
  | CreateElementCommand
  | CreateManyCommand
  | MoveCommand
  | RemoveCommand
  | ShuffleCommand
  | SetAttributeCommand
  | SetVisibilityCommand
  | AddVisibleToCommand
  | SetCurrentPlayerCommand
  | MessageCommand
  | StartGameCommand
  | EndGameCommand
  | SetOrderCommand
  | ReorderChildCommand
  | TrackAddCommand
  | TrackRemoveLastCommand
  | AnimateCommand;
```

### executeAnimate Handler

```typescript
// src/engine/command/executor.ts
function executeAnimate(game: Game, command: AnimateCommand): CommandResult {
  game.pushAnimationEvent(command.eventType, command.data);
  return { success: true };
}

// In the switch statement:
case 'ANIMATE':
  return executeAnimate(game, command);
```

### game.animate() Method

```typescript
// src/engine/element/game.ts

/**
 * Emit an animation event for UI playback.
 *
 * Animation events are pure data signals -- they do NOT capture mutations
 * or affect game state. The UI layer registers handlers to play them back.
 *
 * @param type - Event type identifier (e.g., 'combat', 'score-item')
 * @param data - Event-specific data payload (must be JSON-serializable)
 * @param callback - Optional callback to advance truth (convenience).
 *   The callback runs immediately as normal game code. Its mutations
 *   are NOT captured as event metadata.
 *
 * @example
 * ```typescript
 * // Pure data event
 * game.animate('score', { player: player.name, points: 15 });
 *
 * // With truth-advancing callback
 * game.animate('combat', { attacker: a.id, defender: d.id, damage: 5 }, () => {
 *   defender.hp -= 5;
 *   if (defender.hp <= 0) defender.remove();
 * });
 * ```
 */
animate(type: string, data: Record<string, unknown>, callback?: () => void): void {
  this.execute({ type: 'ANIMATE', eventType: type, data });
  if (callback) {
    callback();
  }
}
```

### pushAnimationEvent Internal Method

```typescript
// src/engine/element/game.ts (called by executor)

/**
 * Push an animation event to the buffer.
 * @internal Called by command executor, not directly by game code.
 */
pushAnimationEvent(eventType: string, data: Record<string, unknown>): void {
  this._animationEventSeq++;
  this._animationEvents.push({
    id: this._animationEventSeq,
    type: eventType,
    data,
    timestamp: Date.now(),
  });
}
```

### Buffer Clearing in performAction

```typescript
// src/engine/element/game.ts

performAction(
  actionName: string,
  player: P,
  args: Record<string, unknown>
): ActionResult {
  // Clear previous animation events -- new action starts a new batch
  this._animationEvents = [];

  const action = this._actions.get(actionName);
  if (!action) {
    return { success: false, error: `Unknown action: ${actionName}` };
  }

  return this._actionExecutor.executeAction(action, player, args);
}
```

### Inverse Command (Not Invertible)

```typescript
// src/engine/command/inverse.ts
case 'ANIMATE':
  // Animation events are UI hints, not invertible
  return null;
```

### Test Example: Basic animate()

```typescript
// src/engine/element/animation-events.test.ts
import { describe, it, expect } from 'vitest';
// ... test game setup helper ...

describe('animate', () => {
  it('emits a pure data event', () => {
    const game = createTestGame();
    game.animate('combat', { attacker: 1, defender: 2, damage: 5 });

    const events = game.pendingAnimationEvents;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('combat');
    expect(events[0].data).toEqual({ attacker: 1, defender: 2, damage: 5 });
    expect(events[0].id).toBe(1);
  });

  it('runs optional callback that advances truth', () => {
    const game = createTestGame();
    let callbackRan = false;

    game.animate('combat', { damage: 5 }, () => {
      callbackRan = true;
    });

    expect(callbackRan).toBe(true);
  });

  it('callback mutations are NOT captured in event data', () => {
    const game = createTestGame();
    game.animate('combat', { damage: 5 }, () => {
      // Some state change via callback
      game.settings.lastDamage = 5;
    });

    const events = game.pendingAnimationEvents;
    // Event only has the data we passed, no mutation metadata
    expect(events[0].data).toEqual({ damage: 5 });
    expect(events[0]).not.toHaveProperty('mutations');
  });
});

describe('command stack integration', () => {
  it('ANIMATE command appears in commandHistory', () => {
    const game = createTestGame();
    game.animate('score', { points: 10 });

    const animateCommands = game.commandHistory.filter(c => c.type === 'ANIMATE');
    expect(animateCommands).toHaveLength(1);
    expect((animateCommands[0] as any).eventType).toBe('score');
  });

  it('survives serialization round-trip', () => {
    const game = createTestGame();
    game.animate('score', { points: 10 });

    // Serialize
    const json = game.toJSON();

    // Restore
    const restored = Game.restoreGame(json, TestGame, game._ctx.classRegistry);

    // Replay commands to rebuild state
    restored.replayCommands(game.commandHistory);

    const events = restored.pendingAnimationEvents;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('score');
    expect(events[0].data).toEqual({ points: 10 });
  });
});
```

## Detailed File Inventory

### Files to MODIFY

| File | Changes | Scope |
|------|---------|-------|
| `src/engine/command/types.ts` | Add `AnimateCommand` interface, add to `GameCommand` union | ~10 lines added |
| `src/engine/command/executor.ts` | Add `executeAnimate` handler, add import for `AnimateCommand` | ~15 lines added |
| `src/engine/command/inverse.ts` | Add `ANIMATE` case returning `null` | ~3 lines added |
| `src/engine/element/game.ts` | Add `animate()` method, add `pushAnimationEvent()`, modify `performAction()` to clear buffer | ~40 lines added, ~1 line modified |
| `src/engine/element/index.ts` | No changes needed (AnimationEvent already exported) | None |
| `src/engine/index.ts` | No changes needed (AnimateCommand not exported -- internal) | None |

### Files to CREATE

| File | Content | Purpose |
|------|---------|---------|
| `src/engine/element/animation-events.test.ts` | Tests for animate(), buffer lifecycle, command stack, serialization | ~150-200 lines |

### Files NOT to Touch (Phase 87-90 scope)

| File | Why Not Now |
|------|------------|
| `src/session/utils.ts` | Phase 87 handles session broadcasting changes |
| `src/session/types.ts` | Phase 87 handles PlayerGameState changes |
| `src/ui/composables/useAnimationEvents.ts` | Phase 88-89 handles UI changes |
| `src/ui/components/GameShell.vue` | Phase 89 handles UI wiring |
| `src/client/types.ts` | Phase 87 handles client type changes |

## Interaction with Existing Infrastructure

### What Already Exists (from Phase 85 leftovers)

| Component | Location | Status | Phase 86 Action |
|-----------|----------|--------|-----------------|
| `AnimationEvent` interface | game.ts L149-160 | Working | Keep as-is |
| `_animationEvents` buffer | game.ts L328 | Working | Keep, add clearing logic |
| `_animationEventSeq` counter | game.ts L331 | Working | Keep as-is |
| `pendingAnimationEvents` getter | game.ts L2345-2347 | Working | Keep as-is |
| `acknowledgeAnimationEvents()` | game.ts L2369-2371 | Working (buffer-only) | Keep as-is |
| Animation event serialization in `toJSON()` | game.ts L2395-2398 | Working | Keep as-is |
| Animation event restoration in `restoreGame()` | game.ts L2563-2567 | Working | Keep as-is |
| `AnimationEvent` export | engine/index.ts L41 | Working | Keep as-is |

### What Phase 86 Adds

| Component | Location | Purpose |
|-----------|----------|---------|
| `AnimateCommand` type | command/types.ts | New command for the command stack |
| `executeAnimate()` | command/executor.ts | Pushes event to buffer |
| `ANIMATE` inverse (null) | command/inverse.ts | Not invertible |
| `game.animate()` | game.ts | Public API for game developers |
| `game.pushAnimationEvent()` | game.ts | Internal, called by executor |
| Buffer clearing in `performAction()` | game.ts | ENG-04 lifecycle |
| animation-events.test.ts | engine/element/ | Comprehensive tests |

## State of the Art

| Old Approach (v2.9) | New Approach (v3.0, this phase) | Impact |
|---------------------|--------------------------------|--------|
| `animate()` captured mutations via diffing | `animate()` emits pure data, callback runs as normal code | Simpler, no mutation capture overhead |
| Events stored in buffer only, separate from commands | Events are ANIMATE commands on the command stack | Survive serialization/replay automatically |
| Buffer never auto-cleared | Buffer cleared at action boundaries | Prevents stale event accumulation |
| 3-arg signature: `(type, data, callback)` with mutation capture | 3-arg signature: `(type, data, callback?)` with callback as convenience | Same API shape, different semantics |

## Open Questions

1. **Should `pushAnimationEvent` be public or have a different access pattern?**
   - What we know: The command executor needs to call it, but it lives in a different file. The executor already accesses many Game internals (e.g., `game.phase`, `game.pile`, `getElementById`).
   - Recommendation: Make it a public method (like other internal APIs accessed by the executor). TypeScript has no `internal` access modifier, and the existing pattern is public methods called by the executor.

2. **Should `_animationEvents` also be cleared for execute flow blocks?**
   - What we know: Execute blocks run synchronously during flow progression, not during action execution. They CAN call `game.animate()`.
   - What's unclear: Whether execute-block events should replace or append to the current buffer.
   - Recommendation: Do NOT clear the buffer for execute blocks. Only clear at action boundaries (in `performAction()`). Execute blocks that call animate() will have their events included in the same batch as the surrounding action context. Document this behavior.

3. **Should animation events on the command stack affect snapshot/replay behavior?**
   - What we know: `createSnapshot()` includes `commandHistory`. During replay via `fromSnapshot()`, all commands (including ANIMATE) are replayed. Each ANIMATE command pushes to the buffer.
   - Recommendation: This is fine. After full replay, `performAction()` clears the buffer at each action boundary, so only the latest action's events remain. No special handling needed.

## Sources

### Primary (HIGH confidence)
- `src/engine/command/types.ts` -- Full read, 251 lines. All 16 existing command types documented.
- `src/engine/command/executor.ts` -- Full read, 327 lines. Switch-based command execution pattern.
- `src/engine/command/inverse.ts` -- Full read, 311 lines. Inverse generation pattern.
- `src/engine/element/game.ts` -- Key sections read: AnimationEvent interface (L149-160), buffer properties (L328-331), performAction (L1030-1041), pendingAnimationEvents (L2345-2347), acknowledgeAnimationEvents (L2369-2371), toJSON (L2380-2400), restoreGame (L2537-2586).
- `src/engine/flow/engine.ts` -- First 220 lines read. Flow start/resume lifecycle.
- `src/runtime/runner.ts` -- Full read, 280 lines. GameRunner.performAction and replay.
- `src/session/utils.ts` -- Animation event inclusion in buildPlayerState (L445-450).
- `src/session/game-session.ts` -- Broadcast pattern (L1423-1447).
- `src/engine/utils/snapshot.ts` -- Full read, 127 lines. GameStateSnapshot includes commandHistory.
- `.planning/milestones/v3.0-ROADMAP.md` -- Full read. Phase 86-90 scope boundaries.
- `.planning/REQUIREMENTS.md` -- ENG-01 through ENG-04 requirement definitions.
- `~/BoardSmithGames/cribbage/src/rules/game.ts` -- Real-world animate() usage (L607-738).
- `~/BoardSmithGames/demo-animation/src/rules/actions.ts` -- Demo animate() usage (L337-345).

### Secondary (MEDIUM confidence)
- Phase 85 RESEARCH.md and SUMMARYs -- Confirms what was removed and what remains.

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, extension of existing command system
- Architecture: HIGH -- follows established command pattern in the codebase
- Pitfalls: HIGH -- identified via direct code analysis of command/replay/MCTS paths
- Buffer lifecycle: HIGH -- requirement ENG-04 is clear, implementation follows from performAction analysis

**Test baseline:** 509 tests passing (19 test files) after Phase 85
**Research date:** 2026-02-07
**Valid until:** Indefinite (codebase-specific, not library-version-dependent)
