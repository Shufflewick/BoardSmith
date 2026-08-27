import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, type GameOptions } from '../index.js';
import { RedactedAttributeError } from '../errors.js';

// #148: the GAME ROOT is never redacted on restore.
//
// `toJSONForPlayer` applies `static visibleAttributes` to the root the same way
// it applies it to any other element: a non-whitelisted root field is dropped
// and the payload is marked `redacted: true`. But the root is rebuilt by
// `Game.loadSerializedState`, not by `GameElement.fromJSON`, so it never
// reached the `_redactAttributes` path #19 added — a withheld root field kept
// whatever the constructor put there. That is sotf's `mapSeed`, the field #19
// was originally filed about.
//
// The engine's OWN root fields (GAME_ROOT_FIELD_AUDIENCE) are not the game's to
// withhold: they have declared audiences and are narrowed elsewhere, so a
// game's whitelist must pass them through rather than sweep them off the wire.

class RootGame extends Game<RootGame, Player> {
  static override visibleAttributes = ['publicPot'];

  /** Whitelisted: every seat sees it. */
  publicPot = 0;
  /** Withheld: the seed the map was generated from. */
  mapSeed = 'truth';
  /** Withheld, and `0` is a real answer in the reporting game. */
  hiddenRound = 0;

  constructor(options: GameOptions) {
    super(options);
  }
}

function restoreForSeat(game: RootGame, seat: number | null): RootGame {
  const restored = new RootGame({ playerCount: 2 });
  restored.loadSerializedState(game.toJSONForPlayer(seat) as ReturnType<Game['toJSON']>);
  return restored;
}

describe('#148: a withheld game-root attribute restores as unknown', () => {
  let game: RootGame;

  beforeEach(() => {
    game = new RootGame({ playerCount: 2 });
    game.publicPot = 12;
    game.mapSeed = 'the-real-seed';
    game.hiddenRound = 4;
  });

  it('redacts a non-whitelisted root field on the wire', () => {
    const view = game.toJSONForPlayer(1);

    expect(view.redacted).toBe(true);
    expect(view.attributes.mapSeed).toBeUndefined();
    expect(view.attributes.hiddenRound).toBeUndefined();
    expect(view.attributes.publicPot).toBe(12);
  });

  it('does not hand back the constructor value for a withheld root field', () => {
    const restored = restoreForSeat(game, 1);

    expect(restored.isAttributeRedacted('mapSeed')).toBe(true);
    expect(restored.isAttributeRedacted('hiddenRound')).toBe(true);
    expect(() => restored.mapSeed).toThrow(RedactedAttributeError);
    expect(() => restored.hiddenRound).toThrow(RedactedAttributeError);
    expect([...restored.redactedAttributes].sort()).toEqual(['hiddenRound', 'mapSeed']);
  });

  it('leaves the whitelisted root field readable', () => {
    const restored = restoreForSeat(game, 1);

    expect(restored.publicPot).toBe(12);
    expect(restored.isAttributeRedacted('publicPot')).toBe(false);
  });

  it('keeps the restored root a valid game: phase, settings and tree intact', () => {
    game.phase = 'started';
    const restored = restoreForSeat(game, 1);

    expect(restored.phase).toBe('started');
    expect(restored.players.length).toBe(2);
    expect(restored.getPlayer(1)!.seat).toBe(1);
  });

  it('never sweeps an engine-owned root field off the wire with the game\'s whitelist', () => {
    game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' } as never);
    const view = game.toJSONForPlayer(1);

    // tutorialProgress is engine-owned and seat-scoped: the engine narrows it
    // itself, and a game whitelist that dropped it would break the seat's own
    // tutorial state rather than withhold a secret.
    expect(view.attributes.tutorialProgress).toBeDefined();
    expect(restoreForSeat(game, 1).isAttributeRedacted('tutorialProgress')).toBe(false);
  });

  it('withholds from a spectator too', () => {
    expect(() => restoreForSeat(game, null).mapSeed).toThrow(RedactedAttributeError);
  });

  it('survives re-serialization of the already-redacted clone', () => {
    const once = restoreForSeat(game, 1);
    const twice = new RootGame({ playerCount: 2 });
    twice.loadSerializedState(once.toJSON());

    expect(twice.isAttributeRedacted('mapSeed')).toBe(true);
    expect(() => twice.mapSeed).toThrow(RedactedAttributeError);
    expect(twice.publicPot).toBe(12);
  });

  it('lets a determinization sampler supply a root value, which then reads back', () => {
    const restored = restoreForSeat(game, 1);

    restored.mapSeed = 'supposed';
    expect(restored.mapSeed).toBe('supposed');
    expect(restored.isAttributeRedacted('mapSeed')).toBe(false);
    expect(restored.toJSON().attributes.mapSeed).toBe('supposed');
  });

  it('redacts nothing on a game that declares no whitelist', () => {
    class OpenGame extends Game<OpenGame, Player> {
      seedValue = 'open';
    }
    const open = new OpenGame({ playerCount: 2 });
    open.seedValue = 'still-open';
    const restored = new OpenGame({ playerCount: 2 });
    restored.loadSerializedState(open.toJSONForPlayer(1) as ReturnType<Game['toJSON']>);

    expect(restored.seedValue).toBe('still-open');
    expect(restored.redactedAttributes).toEqual([]);
  });
});
