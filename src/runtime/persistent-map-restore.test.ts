import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  PersistentMap,
  type GameStateSnapshot,
} from '../engine/index.js';
import { GameRunner } from './runner.js';

/**
 * Issue #139: the HMR volatile-state warning tells authors to replace a plain
 * `Map` field with `this.persistentMap('name')`. That field is an ordinary own
 * property of the game, so `GameElement.toJSON` swept it into the attribute bag
 * (as `{}`, since a PersistentMap keeps its state in private fields) and
 * `Game.loadSerializedState` re-applied that `{}` over the live PersistentMap.
 * The next `.get()` on the restored game then threw
 * "positionCounts.get is not a function".
 *
 * The data itself always round-tripped: it lives in `game.settings`, which is
 * serialized and restored on its own. Only the field binding was destroyed.
 */
class CounterGame extends Game<CounterGame, Player> {
  /**
   * Only `visibleRound` reaches a seat's view; `hiddenSeed` is withheld, which
   * is what makes every per-seat payload of this game a REDACTED one.
   */
  static override visibleAttributes = ['visibleRound'];

  visibleRound = 1;
  hiddenSeed = 99;

  /** Exactly what the HMR warning recommends. */
  positionCounts = this.persistentMap<string, number>('positionCounts');

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    this.registerActions(
      Action.create('bump').execute((_args, ctx) => {
        const game = ctx.game as CounterGame;
        const key = `pos-${game.positionCounts.size}`;
        game.positionCounts.set(key, (game.positionCounts.get(key) ?? 0) + 1);
        return { success: true };
      }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 20,
          do: eachPlayer({ do: actionStep({ actions: ['bump'], turnScope: 'restart' }) }),
        }),
      }),
    );
  }
}

function startedRunner(): GameRunner<CounterGame> {
  const runner = new GameRunner({
    GameClass: CounterGame,
    gameType: 'counter',
    gameOptions: { playerCount: 1, playerNames: ['Solo'], seed: 'counter' },
  });
  runner.start();
  return runner;
}

describe('persistentMap survives checkpoint/snapshot restore (#139)', () => {
  it('restores the field as a live PersistentMap, not a bare object', () => {
    const runner = startedRunner();
    expect(runner.performAction('bump', 1, {}).success).toBe(true);

    const snapshot: GameStateSnapshot = JSON.parse(
      JSON.stringify(runner.getSnapshot()),
    ) as GameStateSnapshot;

    const restored = GameRunner.fromSnapshot(snapshot, CounterGame);
    const game = restored.game;

    expect(game.positionCounts).toBeInstanceOf(PersistentMap);
    expect(game.positionCounts.size).toBe(1);
    expect([...game.positionCounts.values()]).toEqual([1]);

    // And it must still be usable: this is the call that threw
    // "positionCounts.get is not a function".
    expect(restored.performAction('bump', 1, {}).success).toBe(true);
    expect(game.positionCounts.size).toBe(2);
  });

  it('does not emit the persistentMap field into the serialized attribute bag', () => {
    const runner = startedRunner();
    runner.performAction('bump', 1, {});

    const json = runner.game.toJSON();

    expect(json.attributes).not.toHaveProperty('positionCounts');
    // The data still round-trips, via settings.
    expect(json.settings.positionCounts).toEqual({ 'pos-0': 1 });
  });

  it('is not mistaken for a withheld attribute by a redacted restore', () => {
    // A redacted payload (the MCTS search sandbox, any per-seat view of a game
    // with a `visibleAttributes` whitelist) carries only whitelisted
    // attributes, and every own field the payload does NOT carry is taken for
    // a withheld one and replaced with a throwing accessor. A persistentMap
    // field is now never carried, so it has to count as known.
    const runner = startedRunner();
    runner.performAction('bump', 1, {});

    const seatView = runner.game.toJSONForPlayer(1);
    expect(seatView.redacted).toBe(true);

    const restored = new CounterGame({ playerCount: 1, playerNames: ['Solo'], seed: 'counter' });
    restored.loadSerializedState(seatView);

    expect(restored.positionCounts).toBeInstanceOf(PersistentMap);
    expect(restored.positionCounts.size).toBe(1);
  });

  it('survives a per-action checkpoint restore (rewind)', () => {
    const runner = startedRunner();
    runner.performAction('bump', 1, {});
    runner.performAction('bump', 1, {});
    expect(runner.game.positionCounts.size).toBe(2);

    const snapshot: GameStateSnapshot = JSON.parse(
      JSON.stringify(runner.getSnapshot()),
    ) as GameStateSnapshot;

    // Checkpoint 0 is the pre-first-action state.
    const rewound = GameRunner.fromCheckpoint(snapshot, 0, CounterGame);
    expect(rewound).not.toBeNull();

    const game = rewound!.game;
    expect(game.positionCounts).toBeInstanceOf(PersistentMap);
    expect(game.positionCounts.size).toBe(0);
    expect(rewound!.performAction('bump', 1, {}).success).toBe(true);
    expect(game.positionCounts.size).toBe(1);
  });
});
