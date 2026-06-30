# Phase 12 Plan 02: Update Game Implementations Summary

**All game implementations updated to use new Player-in-tree API.**

## Accomplishments

### Task 1: Updated Custom Player Classes
- **PolyPotionsPlayer**: Removed constructor, converted to lazy initialization pattern for tracks and managers:
  - `poisonTrack`, `distillationTracks`, `fulminateTrack`, `abilityManager` now use lazy getter pattern
  - Added `ensureIngredientTracks()` for deferred initialization
  - Fixed `toJSON()` to call `super.toJSON()` and extend rather than replace
- **Other custom Player classes**: No constructor changes needed (already had no constructors or only property defaults)

### Task 2: Updated game.players References
Replaced throughout all games:
- `game.players.get(n)` -> `game.getPlayer(n)`
- `for (const player of game.players)` -> `for (const player of game.all(Player))`
- `game.players.length` -> `game.all(Player).length`
- `game.players.filter(...)` -> `([...game.all(Player)]).filter(...)`
- `game.players.some(...)` -> `([...game.all(Player)]).some(...)`
- `game.players.find(...)` -> `([...game.all(Player)]).find(...)`
- `game.players.map(...)` -> `([...game.all(Player)]).map(...)`

### Task 3: Removed createPlayer Overrides
Replaced `createPlayer()` with `static PlayerClass` pattern:
- Added `static PlayerClass = XxxPlayer` to game classes
- Modified Game constructor to use `(this.constructor as typeof Game).PlayerClass ?? Player`
- Changed `PlayerClass` type from `typeof Player` to `any` to avoid TypeScript generic variance issues

## Files Modified

### Engine
- `packages/engine/src/element/game.ts`
  - Added `static PlayerClass?: any` property
  - Constructor now uses custom PlayerClass when defined
  - Registers custom PlayerClass for serialization

### Games (Rules Files)
- `packages/games/hex/rules/src/game.ts` - Added PlayerClass, removed createPlayer, updated player refs
- `packages/games/checkers/rules/src/game.ts` - Added PlayerClass, removed createPlayer, updated player refs
- `packages/games/checkers/rules/src/ai.ts` - Updated game.players.get to game.getPlayer
- `packages/games/cribbage/rules/src/game.ts` - Added PlayerClass, removed createPlayer, updated player refs
- `packages/games/cribbage/rules/src/flow.ts` - Updated game.players refs
- `packages/games/cribbage/rules/src/actions.ts` - Updated game.players refs
- `packages/games/cribbage/rules/src/ai.ts` - Updated game.players.get to game.getPlayer
- `packages/games/go-fish/rules/src/game.ts` - Added PlayerClass, removed createPlayer, updated player refs
- `packages/games/go-fish/rules/src/ai.ts` - Updated game.players refs
- `packages/games/polyhedral-potions/rules/src/game.ts` - Added PlayerClass, removed createPlayer, updated player refs
- `packages/games/polyhedral-potions/rules/src/elements.ts` - Converted constructor to lazy init, fixed toJSON
- `packages/games/polyhedral-potions/rules/src/flow.ts` - Updated game.players refs
- `packages/games/polyhedral-potions/rules/src/actions.ts` - Updated game.players refs
- `packages/games/floss-bitties/src/rules/game.ts` - Added PlayerClass, removed createPlayer, updated player refs
- `packages/games/demoActionPanel/rules/src/game.ts` - Added PlayerClass, removed createPlayer, updated player refs
- `packages/games/demoActionPanel/rules/src/actions.ts` - Updated game.players refs
- `packages/games/demoActionPanel/rules/src/flow.ts` - Updated game.players refs
- `packages/games/demoComplexUiInteractions/src/rules/game.ts` - Added PlayerClass, removed createPlayer, updated player refs, added hand creation in constructor
- `packages/games/demoComplexUiInteractions/src/rules/actions.ts` - Updated game.players refs

## Migration Patterns Applied

### For Custom Player Classes with Constructors
```typescript
// BEFORE
export class MyPlayer extends Player {
  myTrack: MonotonicTrack;

  constructor(position: number, name: string) {
    super(position, name);
    this.myTrack = createTrack();
  }
}

// AFTER (lazy initialization)
export class MyPlayer extends Player {
  private _myTrack?: MonotonicTrack;
  get myTrack(): MonotonicTrack {
    if (!this._myTrack) {
      this._myTrack = createTrack();
    }
    return this._myTrack;
  }
}
```

### For Game Classes with createPlayer
```typescript
// BEFORE
export class MyGame extends Game<MyGame, MyPlayer> {
  protected override createPlayer(position: number, name: string): MyPlayer {
    return new MyPlayer(position, name);
  }
}

// AFTER
export class MyGame extends Game<MyGame, MyPlayer> {
  static PlayerClass = MyPlayer;
}
```

### For Type Casts
```typescript
// ElementCollection doesn't directly cast to arrays
// Use spread operator to convert to array first:
for (const player of [...this.all(Player)] as MyPlayer[]) { ... }
// or
const players = [...this.all(Player)] as MyPlayer[];
```

## Issues Encountered

1. **TypeScript generic variance**: `static PlayerClass?: typeof Player` caused type errors when subclasses assigned custom Player types. Resolved by using `any` type.

2. **ElementCollection vs Array**: `this.all(Player)` returns `ElementCollection`, not an array. Need `[...this.all(Player)]` to convert before using array methods with type casts.

3. **toJSON override compatibility**: Custom `toJSON()` must call `super.toJSON()` and extend, not replace, since Player now extends GameElement which requires `ElementJSON` format.

4. **player.name is string | undefined**: After Player extends GameElement, `name` is `string | undefined`. Added `!` assertions where name is guaranteed to exist.

## Verification

Build verified for all game packages:
- @boardsmith/hex-rules
- @boardsmith/checkers-rules
- @boardsmith/cribbage-rules
- @boardsmith/gofish-rules
- @boardsmith/polyhedral-potions-rules
- @boardsmith/demo-action-panel-rules
- @mygames/floss-bitties
- @mygames/demoComplexUiInteractions

## Test Files Not Updated

Test files in `packages/games/*/tests/` still use the old `game.players` API. These will need updating in a separate task or when tests are run.

## Next Steps

- Update test files to use new API
- Update infrastructure packages (session, runtime, ai, ai-trainer, testing, ui) which still reference `game.players`
