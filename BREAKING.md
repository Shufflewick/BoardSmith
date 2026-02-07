# Breaking Changes

## v2.9 -- Theatre View

### `emitAnimationEvent()` removed

The fire-and-forget `emitAnimationEvent()` method has been replaced by `game.animate()`, a scoped-callback API that captures mutations for the theatre view system.

With `emitAnimationEvent()`, state changes happened separately from the event -- the event was just a UI hint. With `game.animate()`, state changes happen inside a callback, and the engine automatically records those mutations. This enables the theatre view system: clients see a frozen snapshot of pre-animation state during playback, advancing one event at a time as animations complete.

**Before (v2.8):**

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

**After (v2.9):**

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

### Migration checklist

1. **Find all calls:** Search your game code for `emitAnimationEvent`.
2. **Wrap mutations in callback:** Move any state changes that correspond to the event inside the `game.animate()` callback. The callback executes synchronously -- state is applied immediately, just like before.
3. **Handle pure UI signals:** If the event has no corresponding state changes, use an empty callback (see below).
4. **Remove group option:** If you used `{ group: groupId }`, remove it. Use the event `type` field with a naming convention instead (e.g., `'attack-start'`, `'attack-damage'`, `'attack-end'`).
5. **Run `tsc --noEmit`:** TypeScript will flag any remaining references to the removed method.
6. **Run your tests:** Verify animation events still flow correctly.

### Pure UI signals (no mutations)

Some animation events exist purely to signal the UI -- no game state changes. Use an empty callback:

```typescript
game.animate('score-reveal', {
  playerId: player.id,
  total: 42,
}, () => {
  // Pure UI signal -- no state changes
});
```

### Scoring pattern (mutations in callback)

For games like Cribbage where scoring events and point awards are paired, move the point-awarding call inside the callback:

**Before (v2.8):**

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

**After (v2.9):**

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

### Theatre view (new concept)

`game.animate()` captures mutations made inside its callback. After the callback runs, the game state has already advanced (mutations applied immediately), but the **theatre state** holds a pre-animation snapshot. As clients acknowledge events, the theatre state advances one event at a time, replaying captured mutations. This means UI components never show "the future" while animations play.

- **Theatre view** (default): The frozen snapshot shown to players during animation playback.
- **Current view** (opt-in): The real, up-to-date game state for components that need truth (AI controllers, post-game summaries). Access via `useCurrentView()`.

See [UI Components: Animation Events](docs/ui-components.md#animation-events) for the full API reference.

### What changed in AnimationEvent

The `mutations` field on `AnimationEvent` is now always present (an array, possibly empty) when using `game.animate()`. Previously with `emitAnimationEvent()`, the field was absent (`undefined`).

```typescript
interface AnimationEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  mutations?: CapturedMutation[];  // Always set by animate(), was absent with emitAnimationEvent
}
```

### Removed types

`EmitAnimationEventOptions` has been removed from all exports. This type provided the `{ group?: string }` option for `emitAnimationEvent()`. Since `game.animate()` does not accept a group option, the type is no longer needed.

If you imported `EmitAnimationEventOptions` from `boardsmith` or `boardsmith/ui`, remove the import. If you need to group related events, use a naming convention in the event `type` field (e.g., `'attack-start'`, `'attack-damage'`, `'attack-end'`).
