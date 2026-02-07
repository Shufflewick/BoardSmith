# Phase 84: Clean Break and Migration - Research

**Researched:** 2026-02-07
**Domain:** API removal, game migration, documentation updates
**Confidence:** HIGH

## Summary

This phase removes the deprecated `emitAnimationEvent()` method from the BoardSmith engine, migrates two example games (demo-animation and cribbage) to use the new `game.animate()` API, and updates all documentation. The research covers every reference to the old API across both the library and example games, the exact migration patterns needed, and the documentation that must be updated.

The old API (`emitAnimationEvent`) is fire-and-forget -- it creates an AnimationEvent without mutations. The new API (`game.animate()`) wraps mutations in a callback, capturing them for the theatre view system. The migration is mechanical for most call sites: wrap any state mutations near the `emitAnimationEvent` call inside the `animate()` callback. For Cribbage specifically, the scoring events currently emit data-only events (no mutations), so the migration involves wrapping the score-awarding `addPoints()` calls inside the `animate()` callback.

**Primary recommendation:** Remove `emitAnimationEvent()` from `Game`, remove `EmitAnimationEventOptions` type from all exports, migrate game call sites to `game.animate()`, update tests to only use `game.animate()`, and update documentation to reflect the new API exclusively.

## Standard Stack

No new libraries needed. This phase uses only existing tools:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | existing | Test runner | Already used throughout |
| TypeScript | existing | Type checking | Compile-time verification of removal |

No installation needed.

## Architecture Patterns

### Pattern 1: emitAnimationEvent to animate() Migration

**What:** Converting fire-and-forget animation events to scoped-callback animation events with mutation capture.

**When to use:** Every call site that currently uses `emitAnimationEvent()`.

**Before (old API):**
```typescript
// State changes happen separately from the event
target.health -= damage;
this.emitAnimationEvent('combat', {
  attackerId: attacker.id,
  targetId: target.id,
  damage,
});
if (target.health <= 0) {
  target.putInto(this.graveyard);
}
```

**After (new API):**
```typescript
// State changes happen inside the animate() callback
game.animate('combat', {
  attackerId: attacker.id,
  targetId: target.id,
  damage,
}, () => {
  target.health -= damage;
  if (target.health <= 0) {
    target.putInto(this.graveyard);
  }
});
```

### Pattern 2: Data-Only Events (No Mutations)

**What:** Some events exist purely to signal the UI (no game state changes). These still use `animate()` but with an empty callback.

**Before:**
```typescript
this.emitAnimationEvent('score-hand-complete', {
  source: 'nonDealerHand',
  playerName: nonDealer.name,
  total: nonDealerScore.total,
});
```

**After:**
```typescript
game.animate('score-hand-complete', {
  source: 'nonDealerHand',
  playerName: nonDealer.name,
  total: nonDealerScore.total,
}, () => {
  // No mutations -- this is a UI signal only
});
```

### Pattern 3: Events with Nearby Mutations (Cribbage Scoring)

**What:** Cribbage emits animation events AND calls `addPoints()` near each other. The migration should wrap `addPoints()` inside the final `animate()` callback for that scoring section.

**Before (cribbage scoreRoundAndBuildSummary):**
```typescript
this.emitAnimationEvent('score-hand-complete', {
  source: 'nonDealerHand',
  playerName: nonDealer.name,
  total: nonDealerScore.total,
});

if (nonDealerScore.total > 0) {
  this.addPoints(nonDealer, nonDealerScore.total, 'Hand');
}
```

**After:**
```typescript
game.animate('score-hand-complete', {
  source: 'nonDealerHand',
  playerName: nonDealer.name,
  total: nonDealerScore.total,
}, () => {
  if (nonDealerScore.total > 0) {
    this.addPoints(nonDealer, nonDealerScore.total, 'Hand');
  }
});
```

### Anti-Patterns to Avoid
- **Nesting animate() calls:** The engine throws if `animate()` is called inside another `animate()` callback. Each scoring section (non-dealer hand, dealer hand, crib) must be separate `animate()` calls, not nested.
- **Leaving emitAnimationEvent references in comments/docs:** The clean break should be thorough -- no references to the old method name in code or documentation.

## Complete Reference: All emitAnimationEvent Call Sites

### Library Source (BoardSmith)

| File | Line(s) | Context | Migration Action |
|------|---------|---------|------------------|
| `src/engine/element/game.ts` | 2387-2401 | Method definition | DELETE method entirely |
| `src/engine/element/game.ts` | 162 | JSDoc comment referencing emitAnimationEvent | Update comment |
| `src/engine/element/game.ts` | 2374-2385 | JSDoc examples | DELETE (part of deleted method) |
| `src/engine/element/game.ts` | 169-172 | `EmitAnimationEventOptions` interface | DELETE interface |
| `src/engine/element/index.ts` | 25 | Export of `EmitAnimationEventOptions` | Remove from export |
| `src/engine/index.ts` | 42 | Export of `EmitAnimationEventOptions` | Remove from export |
| `src/ui/index.ts` | 295 | Re-export of `EmitAnimationEventOptions` | Remove from export |

### Library Tests (BoardSmith)

| File | # Refs | Migration Action |
|------|--------|------------------|
| `src/engine/element/animation-events.test.ts` | ~30 refs | Rewrite ALL tests to use `game.animate()` |
| `src/engine/element/mutation-capture.test.ts` | ~15 refs | Rewrite interleaved/compatibility tests |
| `src/engine/element/theatre-state.test.ts` | ~3 refs | Rewrite compatibility test |
| `src/session/animation-events.test.ts` | ~11 refs | Rewrite ALL tests to use `game.animate()` |

### Example Games (BoardSmithGames)

| File | # Refs | Context | Migration Action |
|------|--------|---------|------------------|
| `~/BoardSmithGames/demo-animation/src/rules/actions.ts` | 1 | `createAnimationEventAction` function | Migrate to `game.animate()` |
| `~/BoardSmithGames/demo-animation/src/ui/components/GameTable.vue` | 2 | Comment + reference table text | Update text references |
| `~/BoardSmithGames/cribbage/src/rules/game.ts` | 9 | `scoreRoundAndBuildSummary()` method | Migrate all 9 calls to `game.animate()` |
| `~/BoardSmithGames/CLAUDE.md` | 2 | Documentation references | Update to `game.animate()` |
| `~/BoardSmithGames/.planning/codebase/ARCHITECTURE.md` | 1 | Architecture doc | Update reference |

### Documentation (BoardSmith)

| File | # Refs | Section | Migration Action |
|------|--------|---------|------------------|
| `docs/ui-components.md` | 5 | "Animation Events > Engine-Side: Emitting Events" | Rewrite to show `game.animate()` |
| `docs/nomenclature.md` | 1 | "Animation Event" definition | Update "In Code" reference |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type checking for removal | Manual search for references | `tsc --noEmit` | TypeScript will find all compile errors after removing the method |
| Migration validation | Manual testing only | `vitest run` after each migration step | Tests already cover the animation event system thoroughly |

**Key insight:** TypeScript's type checker is the primary tool for ensuring completeness of the removal. Once `emitAnimationEvent` is deleted from `game.ts`, `tsc --noEmit` will flag every remaining call site as a compile error.

## Common Pitfalls

### Pitfall 1: Cribbage Scoring Order Matters
**What goes wrong:** The cribbage scoring method `scoreRoundAndBuildSummary()` has a specific order: score non-dealer, check for win, score dealer, check for win, score crib. Moving `addPoints()` inside `animate()` must preserve this win-check ordering.
**Why it happens:** Each `addPoints()` call can trigger `this.cribbagePhase = 'gameOver'`, and the method checks `isFinished()` after each scoring section.
**How to avoid:** Keep the `animate()` calls in the same sequential order. The win checks (`if (this.isFinished()) return`) must happen AFTER the `animate()` call that contains `addPoints()`, not before it. Since `animate()` executes synchronously, this works naturally.
**Warning signs:** Win detection failing in cribbage tests.

### Pitfall 2: Demo Animation Event Has No Mutations
**What goes wrong:** The demo animation's `createAnimationEventAction` calls `game.emitAnimationEvent('demo', {...})` with NO state mutations -- it's purely a UI signal. Migrating to `animate()` with an empty callback works but produces an event with `mutations: []` instead of `mutations: undefined`.
**Why it happens:** `animate()` always sets `mutations` to an array (possibly empty). The old `emitAnimationEvent()` had `mutations: undefined`.
**How to avoid:** This is fine -- the UI-side handler doesn't inspect mutations. The AnimationEvent type already has `mutations?: CapturedMutation[]` (optional). Empty array is semantically equivalent to undefined for downstream consumers.
**Warning signs:** None expected.

### Pitfall 3: Test Files Have "Compatibility" Tests That Must Be Removed
**What goes wrong:** Several test files have describe blocks specifically for "emitAnimationEvent compatibility" that test interleaving of the old and new APIs. These tests must be entirely removed, not just migrated.
**Why it happens:** These tests were added during the transition period (phases 80-82).
**How to avoid:** Delete the entire `emitAnimationEvent compatibility` describe blocks. The remaining `animate()` tests already provide full coverage.
**Warning signs:** Tests referencing a method that no longer exists.

### Pitfall 4: UI-Side createAnimationEvents Uses gameView.attributes.animationEvents
**What goes wrong:** The demo and cribbage UI components access `props.gameView?.attributes?.animationEvents` but with the theatre view system, animation events may be at `props.gameView?.animationEvents` (top-level, not nested in attributes).
**Why it happens:** The `toJSON()` method puts `animationEvents` at the top level of the game JSON, but when game state is serialized for player views, the structure may differ.
**How to avoid:** Verify the path by checking `buildPlayerState()` output. This is actually an existing issue that may or may not be in scope -- the key insight is that `game.animate()` doesn't change WHERE animation events appear in the player view, only what each event contains (mutations field).
**Warning signs:** Animation events not being received by UI handlers.

### Pitfall 5: BREAKING.md Doesn't Exist Yet
**What goes wrong:** Creating BREAKING.md for the first time without a clear format.
**Why it happens:** No BREAKING.md file exists in the repo.
**How to avoid:** Create it with a clear v2.9 section header, before/after code examples, and a migration checklist.

### Pitfall 6: Theatre View Terminology Missing from Documentation
**What goes wrong:** The documentation currently has NO mention of "theatre view", "currentView", or the new concepts from phases 80-83.
**Why it happens:** Phases 80-83 built the system but deferred documentation to phase 84.
**How to avoid:** The documentation update must add theatre view concepts to both ui-components.md and nomenclature.md, not just update the emitAnimationEvent references.

## Code Examples

### Removing emitAnimationEvent from Game class

The method to delete (at line 2387 of game.ts):
```typescript
// DELETE this entire method:
emitAnimationEvent(
  type: string,
  data: Record<string, unknown>,
  options?: EmitAnimationEventOptions
): AnimationEvent {
  const event: AnimationEvent = {
    id: ++this._animationEventSeq,
    type,
    data: { ...data },
    timestamp: Date.now(),
    ...(options?.group && { group: options.group }),
  };
  this._animationEvents.push(event);
  return event;
}
```

Also delete the interface (at line 169 of game.ts):
```typescript
// DELETE this interface:
export interface EmitAnimationEventOptions {
  group?: string;
}
```

### Cribbage Migration: scoreRoundAndBuildSummary()

The method has 9 `emitAnimationEvent` calls across 3 scoring sections (non-dealer hand, dealer hand, crib). Each section follows the same pattern of 3 events:

1. `score-hand-start` -- pure UI signal (no mutations in callback)
2. `score-item` (in loop) -- pure UI signal (no mutations in callback)
3. `score-hand-complete` -- should include `addPoints()` in callback

Example migration for non-dealer hand section:
```typescript
// score-hand-start: no mutations
game.animate('score-hand-start', {
  source: 'nonDealerHand',
  playerName: nonDealer.name,
  playerSeat: nonDealer.seat,
  cardIds: nonDealerCards.map(c => c.name!),
  starterCardId: starter?.name ?? null,
}, () => {});

// score-item: no mutations (in loop)
for (const item of nonDealerScore.items) {
  runningTotal += item.points;
  game.animate('score-item', {
    source: 'nonDealerHand',
    category: item.category,
    points: item.points,
    cardIds: item.cards.map(c => c.name!),
    description: item.description,
    runningTotal,
  }, () => {});
  this.message(`  ${item.description} (${runningTotal} total)`);
}

// score-hand-complete: wrap addPoints in callback
game.animate('score-hand-complete', {
  source: 'nonDealerHand',
  playerName: nonDealer.name,
  total: nonDealerScore.total,
}, () => {
  if (nonDealerScore.total > 0) {
    this.addPoints(nonDealer, nonDealerScore.total, 'Hand');
  } else {
    this.message('  No points');
  }
});
```

### Demo Animation Migration

The demo has exactly 1 call site in `createAnimationEventAction`:
```typescript
// Before:
game.emitAnimationEvent('demo', {
  cardId: card.id,
  cardName: card.name,
  message: `Animation event for ${card.rank}${card.suit}`,
  rank: card.rank,
  suit: card.suit,
});

// After:
game.animate('demo', {
  cardId: card.id,
  cardName: card.name,
  message: `Animation event for ${card.rank}${card.suit}`,
  rank: card.rank,
  suit: card.suit,
}, () => {
  // No mutations -- pure UI signal
});
```

### Export Cleanup

Remove from `src/engine/element/index.ts` line 25:
```typescript
// Before:
export type { GameOptions, GamePhase, PlayerViewFunction, AnimationEvent, EmitAnimationEventOptions } from './game.js';
// After:
export type { GameOptions, GamePhase, PlayerViewFunction, AnimationEvent } from './game.js';
```

Remove from `src/engine/index.ts` line 42:
```typescript
// Remove EmitAnimationEventOptions from the import/export
```

Remove from `src/ui/index.ts` line 295:
```typescript
// Before:
export type { AnimationEvent, EmitAnimationEventOptions } from '../engine/index.js';
// After:
export type { AnimationEvent } from '../engine/index.js';
```

### AnimationEvent Type After Removal

The `AnimationEvent` type on the `mutations` field is already optional:
```typescript
export interface AnimationEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  group?: string;
  mutations?: CapturedMutation[];  // Always present with animate(), was absent with emitAnimationEvent
}
```

After removing `emitAnimationEvent`, `mutations` will always be set (as an array, possibly empty). The type can remain optional for backward compatibility of the interface, or be made required. Given "No Backward Compatibility" policy, making it required is cleaner, but it's a type-only change that doesn't affect runtime behavior.

### Documentation: ui-components.md Animation Events Section

The entire "Engine-Side: Emitting Events" section (lines 1090-1150) must be rewritten:

**New content should show:**
```typescript
// Engine-side: wrap mutations in animate() callback
game.animate('combat', {
  attackerId: attacker.id,
  targetId: target.id,
  damage,
}, () => {
  target.health -= damage;
  if (target.health <= 0) {
    target.putInto(this.graveyard);
  }
});
```

The section must also explain:
- Theatre view concept (snapshot frozen until acknowledge)
- Mutations are captured automatically
- Empty callbacks for pure UI signals
- No nesting of animate() calls

### Documentation: nomenclature.md Animation Section

Update the "Animation Event" entry:
```markdown
**In Code:** `AnimationEvent` interface; `game.animate()` method
```

Add new entries for:
- **Theatre View** -- The frozen snapshot of game state shown to players during animation playback
- **Truth View** (currentView) -- The real current game state, available via opt-in for non-animated UI elements
- **Mutation Capture** -- The system that records state changes during `animate()` callbacks

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `game.emitAnimationEvent(type, data)` | `game.animate(type, data, callback)` | v2.9 (phases 80-84) | Enables theatre view system, mutation capture |
| Fire-and-forget events | Scoped callback with mutation capture | v2.9 | Theatre state can advance per-event |
| Truth view as default game state | Theatre view as default, truth opt-in | v2.9 | UI shows animation-consistent state |
| `EmitAnimationEventOptions` type | Removed (no group option on animate) | v2.9 | Simpler API surface |

**Note on group option:** The old `emitAnimationEvent` had an optional `group` parameter. The new `animate()` does NOT have this. Existing cribbage code doesn't use grouping, and the demo doesn't use it. No migration needed for groups.

## Open Questions

1. **Should `mutations` become required on AnimationEvent?**
   - What we know: After removing `emitAnimationEvent`, all events will have `mutations` (as an array). The type currently has `mutations?` (optional).
   - What's unclear: Whether downstream consumers (useAnimationEvents, theatre state) check for undefined vs empty array.
   - Recommendation: Keep optional for now. The theatre state `acknowledgeAnimationEvents` already handles `!event.mutations` gracefully (treats as no-op). Making it required is a follow-up cleanup.

2. **Should the cribbage UI side be updated in this phase?**
   - What we know: The cribbage CribbageBoard.vue uses `createAnimationEvents` with a local acknowledge handler (not connected to session). The demo GameTable.vue also uses local tracking. Both access `props.gameView?.attributes?.animationEvents`.
   - What's unclear: Whether the theatre view system changes where animation events appear in the player state.
   - Recommendation: The UI side should work as-is since `game.animate()` produces events in the same `_animationEvents` buffer. Verify in browser after migration.

3. **Should the `group` option be preserved somehow?**
   - What we know: `emitAnimationEvent` supported `{ group: string }`. `animate()` does not. No games currently use the group option.
   - Recommendation: Let it go. If needed later, it can be added to `animate()`. No backward compat needed.

## Sources

### Primary (HIGH confidence)
- `src/engine/element/game.ts` -- Direct source code inspection of both `emitAnimationEvent()` and `animate()` methods
- `src/engine/element/index.ts` -- Export definitions
- `src/engine/index.ts` -- Re-export definitions
- `src/ui/index.ts` -- UI package re-exports
- `src/engine/element/animation-events.test.ts` -- Test file with all emitAnimationEvent usage
- `src/engine/element/mutation-capture.test.ts` -- Test file with animate() and interleaved tests
- `src/engine/element/theatre-state.test.ts` -- Theatre state tests
- `src/session/animation-events.test.ts` -- Session-level animation tests
- `~/BoardSmithGames/demo-animation/src/rules/actions.ts` -- Demo game call site
- `~/BoardSmithGames/demo-animation/src/ui/components/GameTable.vue` -- Demo UI
- `~/BoardSmithGames/cribbage/src/rules/game.ts` -- Cribbage call sites (9 total)
- `~/BoardSmithGames/cribbage/src/ui/components/CribbageBoard.vue` -- Cribbage UI animation handlers
- `docs/ui-components.md` -- Current animation docs
- `docs/nomenclature.md` -- Current terminology

## Metadata

**Confidence breakdown:**
- API removal scope: HIGH -- exhaustive grep of both repos found all references
- Migration patterns: HIGH -- both APIs are clearly defined, migration is mechanical
- Documentation scope: HIGH -- all doc files identified, content reviewed
- Test migration: HIGH -- all test files identified, patterns understood
- Game migration (demo): HIGH -- single call site, simple pattern
- Game migration (cribbage): HIGH -- 9 call sites, clear pattern, scoring order analyzed

**Research date:** 2026-02-07
**Valid until:** Indefinite (codebase-specific, not library-version-dependent)
