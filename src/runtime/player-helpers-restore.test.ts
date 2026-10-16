import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  monotonicTrack,
  counterTrack,
  addToTrack,
  incrementCounter,
  trackPoints,
  addAbility,
  spendAbility,
  countUnusedAbilities,
} from '../engine/index.js';
import type { Ability, GameOptions } from '../engine/index.js';
import type { GameStateSnapshot } from '../engine/utils/index.js';
import { GameRunner } from './runner.js';

/**
 * #779: a track or ability list held on a Player has to come back from every
 * restore (snapshot, undo, the bot's search sandbox) still usable. The helper
 * classes came back as bare objects with no methods; plain data plus functions
 * is just data, so the element serializer round-trips it as it does any field.
 */
class SheetPlayer extends Player<SheetGame, SheetPlayer> {
  fulminate = monotonicTrack({ id: 'fulminate', direction: 'increasing', maxEntries: 3, pointsPerEntry: [1, 3, 6], completionBonus: 10 });
  poison = counterTrack({ id: 'poison', maxEntries: 6, pointsPerCount: 2 });
  abilities: Ability<'reroll'>[] = [{ type: 'reroll', used: false, earnedFrom: 'starting' }];

  /** Derived, so it is never saved: a getter is not an own field. */
  get score(): number {
    return trackPoints(this.fulminate) + trackPoints(this.poison);
  }
}

class SheetGame extends Game<SheetGame, SheetPlayer> {
  static PlayerClass = SheetPlayer;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create('mark').execute((_args, ctx) => {
        const player = ctx.player as SheetPlayer;
        addToTrack(player.fulminate, player.fulminate.entries.length + 1);
        incrementCounter(player.poison);
        spendAbility(player.abilities, 'reroll');
        addAbility(player.abilities, 'reroll', 'marked');
        return { success: true };
      }),
    );
    this.setFlow({
      root: loop({ maxIterations: 20, do: eachPlayer({ do: actionStep({ actions: ['mark'] }) }) }),
    });
  }
}

const options = { playerCount: 1, playerNames: ['Solo'], seed: 'sheet', elementIdKey: '00000000000000b7' };

function markedTwice(): GameRunner<SheetGame> {
  const runner = new GameRunner({ GameClass: SheetGame, gameType: 'sheet', gameOptions: options, checkpoints: { history: 'full' } });
  runner.start();
  expect(runner.performAction('mark', 1, {}).success).toBe(true);
  expect(runner.performAction('mark', 1, {}).success).toBe(true);
  return runner;
}

const sheetOf = (player: SheetPlayer) => ({
  fulminate: player.fulminate,
  poison: player.poison,
  abilities: player.abilities,
});

const savedSnapshot = (runner: GameRunner<SheetGame>): GameStateSnapshot =>
  JSON.parse(JSON.stringify(runner.getSnapshot())) as GameStateSnapshot;

describe('tracks and abilities on a Player survive every restore (#779)', () => {
  it('come back from a saved snapshot unchanged and still usable', () => {
    const runner = markedTwice();
    const before = structuredClone(sheetOf(runner.game.getPlayer(1)!));

    const restored = GameRunner.fromSnapshot(savedSnapshot(runner), SheetGame);
    const player = restored.game.getPlayer(1)!;
    expect(sheetOf(player)).toEqual(before);
    expect(player.score).toBe(1 + 3 + 2 * 2);

    expect(restored.performAction('mark', 1, {}).success).toBe(true);
    expect(player.score).toBe(1 + 3 + 6 + 10 + 3 * 2);
    expect(countUnusedAbilities(player.abilities, 'reroll')).toBe(1);
  });

  it('come back from an undo to an earlier checkpoint and still usable', () => {
    const runner = markedTwice();
    const before = structuredClone(sheetOf(runner.game.getPlayer(1)!));
    // The host captures a checkpoint after each action; a bare runner does not.
    runner.captureCheckpoint();
    expect(runner.performAction('mark', 1, {}).success).toBe(true);

    const rewound = GameRunner.fromCheckpoint(savedSnapshot(runner), 2, SheetGame)!;
    const player = rewound.game.getPlayer(1)!;
    expect(sheetOf(player)).toEqual(before);

    expect(rewound.performAction('mark', 1, {}).success).toBe(true);
    expect(player.fulminate.entries.map((e) => e.value)).toEqual([1, 2, 3]);
  });

  it('come back in the bot\'s search sandbox, built from the seat\'s view, and still usable', () => {
    const runner = markedTwice();
    const before = structuredClone(sheetOf(runner.game.getPlayer(1)!));

    const sandbox = new SheetGame(options);
    sandbox.loadSerializedState(runner.game.toJSONForPlayer(1));
    const player = sandbox.getPlayer(1)!;
    expect(sheetOf(player)).toEqual(before);

    expect(addToTrack(player.fulminate, 3)).toBe(6);
    expect(player.score).toBe(1 + 3 + 6 + 10 + 2 * 2);
  });
});
