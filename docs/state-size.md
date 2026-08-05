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

| Tree size | Actions until ~2 MB |
|---|---|
| 2 KB | ~1,000 |
| 4 KB | ~500 |
| 10 KB | ~200 |
| 30 KB | ~65 |

Hosts cap how large a saved game may be (ShufflewickPub's limit is ~1.87 MB, set
by Cloudflare's per-value Durable Object storage ceiling). A game with a high
action count — 18xx, campaign and legacy games, worker placement with many small
actions, anything async and multi-round — reaches that cap on ordinary play.

## Two costs that are invisible until measured

- **`game.messages` lives inside the serialized tree.** An uncapped message log
  is multiplied by the checkpoint count like everything else. A 100-entry log at
  75 bytes per entry costs roughly 2 MB across a full game — from the log alone.
  Cap it.
- **Named-key objects cost about 6× positional arrays.** `{beastLore: 3, …}` is
  137 bytes where `[3, …]` is 23. Across 8 seats and 325 actions, that single
  stylistic choice is ~579 KB of saved state.

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

The default is unbounded — every checkpoint retained, forever. That is the
behaviour every game has today, and it is the behaviour that eventually hits the
host's ceiling.

## Measuring your own game

Do not infer. Assert it in CI:

```ts
import { createTestGame } from 'boardsmith/testing';
import { measureSnapshotSize, projectSnapshotSize } from 'boardsmith/testing';

const EXPECTED_ACTIONS_PER_GAME = 325;   // your longest realistic game
const HOST_BUDGET_BYTES = 1_800_000;

it('fits the host state budget for a full game', () => {
  const game = createTestGame(MyGame, { playerCount: 8 });
  // ...play a representative position: full board, hands dealt, log populated...

  const size = measureSnapshotSize(game.runner.getSnapshot());
  expect(projectSnapshotSize(size, EXPECTED_ACTIONS_PER_GAME)).toBeLessThan(HOST_BUDGET_BYTES);
});
```

`measureSnapshotSize` splits a snapshot into tree, checkpoints, and action
history, and reports `bytesPerCheckpoint` — the multiplier itself.
`projectSnapshotSize` extrapolates to a full game from a measurement taken at
any point, which is the number to compare against a host limit. Measuring only
what you have played is exactly how the ceiling stays invisible.

Pass `{ maxCheckpoints }` to project under a retention policy; the result goes
flat in the action count, which is the point of setting one.

## What happens if you ignore all this

On ShufflewickPub, the move that would cross the budget is refused before it is
saved, with a message naming the size breakdown and the checkpoint count, and
the game stays exactly where it was. Undo still works above the limit, so a
session can be brought back under.

That guardrail exists because the alternative — which is what happened — was a
session saved into a state too large to act on and too large to shrink, where
every subsequent action failed.
