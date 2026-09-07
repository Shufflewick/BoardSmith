# State size: the multiplier

**Who this is for:** anyone designing a game that will run for more than a few
dozen actions, and anyone wondering why a game that plays fine locally is
refused by its host.

---

## The sentence that matters

> **Every byte on your game tree is multiplied by the total action count of the
> game.**

Not "keep your state small". A multiplier.

A saved game is not the board. It is the board **plus one full copy of the
element tree per action taken** — the per-action undo checkpoints that let undo
and time-travel restore any point authoritatively instead of replaying history
(replay cannot reproduce selection-step mutations, so it is not an option; see
[agent-control.md](./agent-control.md)).

So:

```
saved size  ≈  tree size  ×  actions in the game
```

The tree never grows. The saved game grows on every single action, forever.

That asymmetry is why this is easy to miss. A 9 KB tree is 9 KB at action 1 and
9 KB at action 1000 — nothing you can observe while playing suggests a problem.
The snapshot at action 1000 is 9 MB.

| Tree size | Actions until ~7 MB |
|---|---|
| 2 KB | ~3,600 |
| 4 KB | ~1,800 |
| 10 KB | ~720 |
| 30 KB | ~240 |

Hosts cap how large a saved game may be. **The number is the host's to publish,
not this page's to restate** — ShufflewickPub's is
[`docs/GAME-STATE-BUDGET.md`](https://github.com/Shufflewick/ShufflewickPub/blob/main/docs/GAME-STATE-BUDGET.md),
which as of this writing budgets 7,274,496 bytes for the snapshot and derives it
from what is left of the executor's request after the bundle and the envelope
reserve. The table above is scaled to that figure; check the host's document for
the current one rather than trusting a second copy here, because a second copy
of a limit is how this page previously came to state a ceiling that had moved by
a factor of four.

A game with a high action count — 18xx, campaign and legacy games, worker
placement with many small actions, anything async and multi-round — reaches that
cap on ordinary play. **The lever is `checkpoints: { max: N }`**, described
below: measured on the real engine, a 15x15 grid modelled as 225 elements with
one action per keystroke reaches 5.19 MB after 190 actions under the default
unbounded retention, and 117 KB at `checkpoints: { max: 3 }`. If your game's
realistic action count runs into the hundreds, reach for it while you are
designing rather than after a host refuses a session.

## Two costs that are invisible until measured

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

## Bounding it: `checkpoints`

Declare a retention policy on the game definition:

```ts
export const gameDefinition = {
  gameClass: MyGame,
  gameType: 'my-game',
  minPlayers: 2,
  maxPlayers: 8,
  checkpoints: { max: 20 },
};
```

The 20 most recent checkpoints are kept; older ones are dropped oldest-first,
and the saved game stops growing with the tree. The remaining growth is the
action history, which is bytes per action rather than a tree per action.

To turn checkpointing off entirely — no undo, no debug time-travel, saved size
independent of action count:

```ts
checkpoints: { enabled: false }
```

### Choosing `max`

**`max` must exceed the most actions one seat takes in a single turn.** Undo
restores the checkpoint at that seat's turn-start action count; a `max` smaller
than a long turn means a player cannot undo their own move. An undo that reaches
past the retained window is refused with a message naming the policy:

```
Cannot undo to the start of this turn: action 4 is older than this game's
retained undo window (it keeps 3 checkpoint(s), back to action 6). Raise or
remove `checkpoints: { max }` on the game definition to reach further back.
```

Refused, not approximated. A bounded window trades undo depth for size, and the
trade is stated rather than silently taken.

The default is unbounded — every checkpoint retained, forever. That is the right
default for the ordinary game, which never comes near the ceiling, and it is a
cliff for a high-action-count one: the 15x15 grid above is 44x smaller at
`max: 3` than at the default. Reach for `max` when a realistic game runs to
hundreds of actions, or when `projectSnapshotSize` (below) puts your projected
size within a factor of two of the host's budget.

## Measuring your own game

Do not infer. Assert it in CI:

```ts
import { createTestGame, measureSnapshotSize, projectSnapshotSize } from 'boardsmith/testing';

const EXPECTED_ACTIONS_PER_GAME = 325;   // your longest realistic game
const HOST_BUDGET_BYTES = 7_000_000;  // read your host's published budget; ShufflewickPub's is 7,274,496

it('fits the host state budget for a full game', () => {
  const game = createTestGame(MyGame, {
    playerCount: 8,
    // The policy the game actually ships. Without it the test measures the
    // unbounded default and says nothing about what players will run.
    checkpoints: { max: 20 },
  });

  // Play a representative position: full board, hands dealt, log populated.
  // Snapshot after EVERY action — that is what captures the checkpoints.
  while (!game.isComplete()) {
    game.doAction(seat, 'play', args);
    game.runner.getSnapshot();
  }

  const size = measureSnapshotSize(game.runner.getSnapshot());
  expect(projectSnapshotSize(size, EXPECTED_ACTIONS_PER_GAME, { maxCheckpoints: 20 }))
    .toBeLessThan(HOST_BUDGET_BYTES);
});
```

`measureSnapshotSize` splits a snapshot into tree, checkpoints, and action
history, and reports `bytesPerCheckpoint` — the multiplier itself.
`projectSnapshotSize` extrapolates to a full game from a measurement taken at
any point, which is the number to compare against a host limit. Measuring only
what you have played is exactly how the ceiling stays invisible.

Pass `{ maxCheckpoints }` to project under a retention policy; the result goes
flat in the action count, which is the point of setting one.

### Why the snapshot call belongs inside the loop

Checkpoints are captured through the SNAPSHOT funnel, not by `performAction`.
`GameRunner.getSnapshot()` calls `captureCheckpoint()`, and the stateful
`GameSession` calls it from its broadcast funnel — which is why a host has a
checkpoint per action. A driver that performs 300 actions and snapshots once at
the end leaves every slot between them uncaptured. They still count toward the
window's length, so `bytesPerCheckpoint` comes out one to two orders of
magnitude too small (measured at 17x to 219x across six games), and the budget
assertion passes green while measuring nothing.

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
