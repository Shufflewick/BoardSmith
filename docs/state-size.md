# State size: the multiplier

**Who this is for:** anyone designing a game that will run for more than a few
dozen actions, and anyone wondering why a game that plays fine locally is
refused by its host.

---

## The sentence that matters

> **Every byte on your game tree is multiplied by the total action count of the
> game.**

Not "keep your state small". A multiplier.

A saved game is not the board. It is **one full copy of the element tree per
action taken**, the newest of which is the board itself (#804) — the per-action undo checkpoints that let undo
and time-travel restore any point authoritatively instead of replaying history
(replay cannot reproduce selection-step mutations, so it is not an option; see
[agent-control.md](./agent-control.md)).

So, if every checkpoint were kept:

```
saved size  ≈  tree size  ×  actions in the game
```

The tree never grows; the saved game would grow on every single action. A 9 KB
tree is 9 KB at action 1 and 9 KB at action 1000, and nothing you can observe
while playing suggests a problem, yet keeping every checkpoint makes the
snapshot at action 1000 9 MB.

That is why a hosted table does not keep them all. **By default a game keeps
checkpoints only back to the start of the current turn** — the oldest point any
seat's undo can restore, which is later when an action that cannot be undone
happened since — and drops everything older. So:

```
saved size  ≈  tree size  ×  (undoable actions in the longest turn + 1)  +  history  +  log
```

flat in the length of the game. Measured on the real engine, a 15x15 grid
modelled as 225 elements with one action per keystroke reached 5.19 MB after
190 actions when every checkpoint was kept, which is what the default was
before #504.

`boardsmith dev` keeps every checkpoint (it passes the `fullHistory` host
option), because time travel and rewind read them. Turning debugging on does
not do that by itself: a debug read behind the turn start is refused with the
reason. A game played there grows as the first formula says; that
is a development convenience, not what players' saved games weigh.

Hosts cap how large a saved game may be. **The number is the host's to publish,
not this page's to restate** — ShufflewickPub's is
[`docs/GAME-STATE-BUDGET.md`](https://github.com/Shufflewick/ShufflewickPub/blob/main/docs/GAME-STATE-BUDGET.md).
A second copy of a limit is how this page, and nine games' tests, once came to
state a ceiling that had moved by a factor of four.

## Three costs that are invisible until measured

- **The message log grows for the life of the game.** `game.messages` is stored
  once per snapshot (`GameStateSnapshot.messageLog`), so it is no longer
  multiplied by the checkpoint count — but nothing caps it, and at roughly 90
  bytes per entry a game that narrates every action accumulates that text
  forever. Measured on an 8-seat game with a 6.5 KB model and three narration
  lines per action: 75 KB of log at 325 actions. The same game before the log
  moved out of the tree was 1671 KB, of which the model was under 8% — the log
  was the snapshot.

  Read `measureSnapshotSize().messageLogBytes` rather than inferring the log's
  share from the remainder, and note that `projectSnapshotSize` infers the log's
  growth rate from the actions the measured game actually played — a fixture
  that constructs an end-state must pass `messageLogBytes` explicitly instead.

  **Capping it is `game.pruneMessages()`, not a splice.** Each per-action
  checkpoint records the log's ABSOLUTE length at its boundary — entries ever
  written — and the engine counts how many have been evicted, so a restore
  subtracts the one from the other to find that boundary in the log as it now
  stands. One number for the whole game, which matters here of all places: a
  per-entry identity would have made the fix for a size ceiling cost bytes per
  line. Splicing `game.messages` directly is not equivalent — it moves entries
  past a boundary the checkpoint no longer describes.

  ```typescript
  // At a round boundary, in the game's own upkeep:
  game.pruneMessages({ keepLast: 400 });

  // Or by age, which is still a front eviction:
  game.pruneMessages({ dropWhile: (entry) => (entry.data?.round as number) < currentRound - 2 });
  ```

  Eviction is **front-only**, deliberately. A checkpoint's watermark is a
  position in a chronological log, so removing an entry from the middle moves
  later lines across boundaries recorded before the removal — which is exactly
  the corruption this design exists to prevent. "The most recent N" and
  "everything before round K" are front evictions; "only the interesting lines"
  is not, and there is no way to ask for it.
- **A removed element is still in the saved state.** `remove()` moves an element to
  `game.pile`, and the pile is saved with the game (#655) so a reference to a
  captured piece or a discarded card survives undo and reload. So every
  removed element is copied into every checkpoint, like any element on the
  board. A game that creates elements as it goes (a token per action, a card
  drawn from an endless supply) and removes them later still pays for them on
  every checkpoint; reuse a fixed set of elements instead, putting them back
  into a supply space when they leave play.
- **Named-key objects cost about 6× positional arrays.** `{beastLore: 3, …}` is
  137 bytes where `[3, …]` is 23. Across 8 seats and 325 actions, that single
  stylistic choice is ~579 KB of saved state.

## Packed bulk data: use a typed array

For genuinely bulk data — a terrain map, a fog-of-war mask, a visited-sector
bitmap — store a **typed array** (`Uint8Array` and friends). The engine encodes
it as base64, which is 4 characters per 3 bytes, and restores it as its exact
type:

```ts
class MyGame extends Game {
  terrain = new Uint8Array(4096);   // ~5.5 KB serialized
}
```

The same 4096 values as a `number[]` cost 2–4× that, and as a named-key object
far more again. A 256-sector visited bitmap is 32 bytes of `Uint8Array`, or 44
base64 characters in the snapshot.

Two things the engine will not let you do silently:

- A **bare `ArrayBuffer` or `DataView`** in state throws at serialization time.
  Neither has a serializable form; store a typed array over the buffer instead.
- A typed array is encoded **little-endian regardless of host**, so a snapshot
  written by the executor, the dev host and the browser is byte-identical.

## Retention: what is kept, and `checkpoints`

Most games declare nothing. The default keeps the current turn's checkpoints,
which is exactly what undo needs: undo restores the checkpoint at the start of
the acting seat's turn, and nothing older is ever restored by a player. In a
simultaneous step undo restores the start of the asking seat's last run of
actions, which is never before the step's start, and the window keeps from the
step's start.

Undo never crosses an action marked `.notUndoable()`, or an
`execute({ irreversible: true })` step, so once one happens part way through a
turn or step, the window starts just after it: the checkpoints before it are
ones no seat can restore. A step made only of not-undoable actions (a
deployment of hundreds of placements, say) therefore keeps one checkpoint, not
one per action. A `fullHistory` host keeps them all as before.

The remaining growth is the action history, which is bytes per action rather
than a tree per action, and the message log.

Two settings on the game definition change that:

```ts
export const gameDefinition = {
  gameClass: MyGame,
  gameType: 'my-game',
  minPlayers: 2,
  maxPlayers: 8,
  checkpoints: { max: 20 },
};
```

`max` is a hard cap: never more than 20 checkpoints, whatever the turn. To turn
checkpointing off entirely — no undo, no debug time-travel:

```ts
checkpoints: { enabled: false }
```

### Choosing `max`

**You usually do not need it.** Do not derive one from your game's turn length
to bound the saved size: the default already keeps exactly the current turn.
Reach for `max` only when a single turn can run long enough that the turn alone
threatens the host's budget — a turn of hundreds of small actions over a large
tree — and you would rather give up undo to the start of such a turn than
shrink the tree. An undo that reaches past the retained window is refused with
a message naming the policy:

```
Cannot undo to the start of this turn: action 4 is older than this game's
retained undo window (it keeps 3 checkpoint(s), back to action 6). Raise or
remove `checkpoints: { max }` on the game definition to reach further back.
```

Refused, not approximated. A bounded window trades undo depth for size, and the
trade is stated rather than silently taken.

The player is never offered an undo the window (or `enabled: false`) will
refuse. A seat's `canUndo` comes from the same decision the undo itself takes
(`decideUndo` in `src/session/utils.ts`), so the Undo button and the "Undo last
action" menu item are off whenever the checkpoint the undo needs is missing.
Every state a seat is sent is built after the checkpoint for the op that
produced it is recorded, including the state returned to the seat that just
made a pick, so `canUndo` reads the window as the op left it, not as it was one
step earlier (#385).

## Measuring your own game

Do not infer. Assert it in CI, against the budget your host publishes:

```ts
import { createTestGame, measureSnapshotSize, assertStateBudget } from 'boardsmith/testing';

it('fits the host state budget for a full game', () => {
  const game = createTestGame(MyGame, { playerCount: 8 });

  // Play a representative game to its end: full board, hands dealt, log
  // populated. Snapshot after EVERY action, as a host does, and check each one:
  // the largest saved state is usually mid-turn, not at the end.
  while (!game.isComplete()) {
    game.doAction(seat, 'play', args);
    assertStateBudget(measureSnapshotSize(game.runner.getSnapshot()), hostBudgetBytes);
  }
});
```

`hostBudgetBytes` is read from where your host publishes it, never typed into
the test. `assertStateBudget` takes it as a required argument for that reason,
and its failure names the measured size, the budget, and where the bytes went.

`measureSnapshotSize` splits a snapshot into tree, checkpoints, action history
and message log, and reports `bytesPerCheckpoint` — the multiplier itself.
`projectSnapshotSize` extrapolates to a longer game from a measurement taken at
any point. With no options it projects full history (what `boardsmith dev`
keeps); pass `{ maxCheckpoints }` with your longest turn plus one, or your
`max`, to project what a hosted table keeps.

### Why the snapshot call belongs inside the loop

Checkpoints are captured through the SNAPSHOT funnel, not by `performAction`.
`GameRunner.getSnapshot()` calls `captureCheckpoint()`, and `executeOp` calls
it after every op it runs (every op answers with a fresh snapshot) — which is
why a host has a checkpoint per action. A driver that performs a whole turn of
actions and snapshots once at the end leaves every slot between them
uncaptured. They still count toward the window's length, so
`bytesPerCheckpoint` comes out too small and the budget assertion passes green
while measuring nothing.

`measureSnapshotSize` refuses such a snapshot rather than reporting the wrong
number, naming the uncaptured count and the fix. If you see that error, move
`getSnapshot()` inside the loop.

## What happens if you ignore all this

On ShufflewickPub, the move that would cross the budget is refused before it is
saved, with a message naming the size breakdown and the checkpoint count, and
the game stays exactly where it was. Undo still works above the limit, so a
session can be brought back under.

That guardrail exists because the alternative — which is what happened — was a
session saved into a state too large to act on and too large to shrink, where
every subsequent action failed.
