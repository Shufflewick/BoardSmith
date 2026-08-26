/**
 * Four reports from the Survival of the Fittest port (#24, #26, #30, #32).
 *
 * Each is a place where the engine knows something a game needs and does not
 * hand it over, or reports a fact it cannot actually support.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  simultaneousActionStep,
  enumerateLegalMoves,
  type GameOptions,
} from './index.js';
import { _clearShownWarnings } from '../utils/dev.js';

class RoundGame extends Game<RoundGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create('bid').prompt('Bid').chooseFrom('amount', { choices: [1, 2, 3] }).execute(() => {}),
      Action.create('pass').prompt('Pass').execute(() => {}),
    );
    this.setFlow(
      defineFlow({ root: simultaneousActionStep({ name: 'round', actions: ['bid', 'pass'] }) })
    );
  }
}

function started(): RoundGame {
  const game = new RoundGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'gap' });
  game.startFlow();
  return game;
}

afterEach(() => {
  _clearShownWarnings();
});

describe('the unreachable-action check counts simultaneousActionStep (#24)', () => {
  it('says nothing about an action only a simultaneous step offers', () => {
    // Every action here IS reachable, through a first-class flow primitive.
    // Warning about all of them made the one warning that would genuinely mean
    // "no human can take this" indistinguishable from noise.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    started();
    const unreachable = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => /registered but referenced by no/.test(message));
    expect(unreachable).toEqual([]);
    warn.mockRestore();
  });

  it('still warns about an action no step offers at all', () => {
    class OrphanGame extends Game<OrphanGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerActions(
          Action.create('used').prompt('Used').execute(() => {}),
          Action.create('orphan').prompt('Orphan').execute(() => {}),
        );
        this.setFlow(defineFlow({ root: actionStep({ actions: ['used'] }) }));
      }
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new OrphanGame({ playerCount: 2, seed: 'gap' }).startFlow();
    const messages = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(messages).toMatch(/'orphan' is registered but referenced by no/);
    expect(messages).not.toMatch(/'used' is registered/);
    warn.mockRestore();
  });
});

describe('enumerateLegalMoves fails loudly on a bad seat (#26)', () => {
  it('enumerates the moves a real seat has', () => {
    const moves = enumerateLegalMoves(started(), 1);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.map((m) => m.action)).toContain('bid');
  });

  it('throws for a seat that does not exist, rather than returning zero moves', () => {
    // "No legal moves" is exactly the answer that stops a bot pump and wedges a
    // simultaneous round, so it must never be the answer to a bad argument.
    expect(() => enumerateLegalMoves(started(), 99)).toThrow(/seat 99/);
    expect(() => enumerateLegalMoves(started(), 0)).toThrow(/1-indexed/);
  });

  it('throws when handed a Player object instead of a seat number', () => {
    const game = started();
    const player = game.getPlayer(1)!;
    expect(() => enumerateLegalMoves(game, player as unknown as number)).toThrow(/seat number/i);
  });

  it('throws when the game has no flow state to enumerate from', () => {
    const notStarted = new RoundGame({ playerCount: 2, seed: 'gap' });
    expect(() => enumerateLegalMoves(notStarted, 1)).toThrow(/flow/i);
  });
});

describe('the root-field audience table is reachable from outside (#32)', () => {
  it('exports the audience of each engine-owned root field', async () => {
    const engine = await import('./index.js');
    expect(engine.GAME_ROOT_FIELD_AUDIENCE).toBeDefined();
    expect(engine.GAME_SELF_SERIALIZED_FIELDS).toBeDefined();
  });

  it('answers the question a game actually asks: is this field mine to redact?', async () => {
    const { isEngineRootField } = await import('./index.js');
    // Engine-owned, so a game's redaction pass must leave it alone.
    expect(isEngineRootField('tutorialProgress')).toBe(true);
    expect(isEngineRootField('messages')).toBe(true);
    expect(isEngineRootField('name')).toBe(true);
    // The game's own field, so the game must classify it.
    expect(isEngineRootField('mapSeed')).toBe(false);
  });

  it('classifies every field the engine actually puts on the root', async () => {
    const { GAME_ROOT_FIELD_AUDIENCE, isEngineRootField } = await import('./index.js');
    for (const key of Object.keys(GAME_ROOT_FIELD_AUDIENCE)) {
      expect(isEngineRootField(key), key).toBe(true);
    }
  });
});

describe('useBoardActionBridge is on the public UI surface (#30)', () => {
  it('is exported from boardsmith/ui alongside the pieces it pairs with', async () => {
    const ui = await import('../ui/index.js');
    expect(ui.useBoardActionBridge).toBeTypeOf('function');
    // The two it is useless without, already public.
    expect(ui.createBoardInteraction).toBeTypeOf('function');
    expect(ui.provideBoardInteraction).toBeTypeOf('function');
  });
});
