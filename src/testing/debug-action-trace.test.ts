/**
 * `traceAction`, `logAvailableActions` and `diffSnapshots` from
 * `boardsmith/testing` — the three debug helpers a game author reaches for when
 * an action will not show up or a move changed something unexpected.
 * `debug.test.ts` covers the state-dump helpers in the same module.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { traceAction, logAvailableActions, diffSnapshots } from './debug.js';

class Token extends Piece<TraceGame> {
  value!: number;
}

class Bag extends Space<TraceGame> {}

/**
 * `take` is always available; `spend` is gated by a condition that starts
 * false; `pickEmpty` has an element selection with no candidates.
 */
class TraceGame extends Game<TraceGame, Player> {
  score = 0;
  unlocked = false;
  bag!: Bag;

  constructor(options: GameOptions) {
    super(options);
    this.bag = this.create(Bag, 'bag');
    this.bag.create(Token, 'a', { value: 1 });
    this.bag.create(Token, 'b', { value: 2 });
    this.create(Bag, 'empty');

    this.registerAction(
      Action.create<TraceGame>('take')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          ctx.game.score += args.value as number;
          return { success: true };
        }),
    );

    this.registerAction(
      Action.create<TraceGame>('spend')
        .condition({ 'is unlocked': (ctx) => ctx.game.unlocked })
        .execute(() => ({ success: true })),
    );

    this.registerAction(
      Action.create<TraceGame>('pickEmpty')
        .chooseElement('token', {
          elementClass: Token,
          filter: (element) => (element as Token).value > 99,
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx) => ctx.game.score < 6,
          maxIterations: 100,
          do: eachPlayer({ do: actionStep({ actions: ['take', 'spend', 'pickEmpty'] }) }),
        }),
      }),
    );
  }
}

const newGame = () => TestGame.create(TraceGame, { playerCount: 2 });

describe('traceAction', () => {
  it('finds an action that is registered on the game', () => {
    const trace = traceAction(newGame().game, 'take');
    expect(trace.actionName).toBe('take');
    expect(trace.available).toBe(true);
    expect(trace.reason).toBeTruthy();
  });

  it('reports an unregistered action as unavailable, naming it', () => {
    const trace = traceAction(newGame().game, 'noSuchAction');
    expect(trace.available).toBe(false);
    expect(trace.reason).toContain('noSuchAction');
  });

  it('reports a failing condition as the reason the action is unavailable', () => {
    const trace = traceAction(newGame().game, 'spend');
    expect(trace.available).toBe(false);
    expect(trace.reason.toLowerCase()).toContain('condition');
  });

  it('reports the action as available once its condition passes', () => {
    const testGame = newGame();
    testGame.game.unlocked = true;
    expect(traceAction(testGame.game, 'spend').available).toBe(true);
  });

  it('reports a selection with no valid elements, naming the selection', () => {
    const trace = traceAction(newGame().game, 'pickEmpty');
    expect(trace.available).toBe(false);
    expect(trace.reason).toContain('token');
  });

  it('returns a step-by-step detail trace, not just a verdict', () => {
    const trace = traceAction(newGame().game, 'take');
    expect(trace.details.length).toBeGreaterThan(0);
    for (const detail of trace.details) {
      expect(typeof detail.step).toBe('string');
      expect(typeof detail.passed).toBe('boolean');
      expect(typeof detail.info).toBe('string');
    }
  });

  it('marks the failing step, and only it, as not passed', () => {
    const trace = traceAction(newGame().game, 'spend');
    const failed = trace.details.filter((d) => !d.passed);
    expect(failed.map((d) => d.step)).toEqual(['Condition']);
    expect(trace.details.filter((d) => d.passed).every((d) => d.step !== 'Condition')).toBe(true);
  });

  it('marks every step passed when the action is available', () => {
    const trace = traceAction(newGame().game, 'take');
    expect(trace.details.filter((d) => !d.passed)).toEqual([]);
  });

  it('counts the choices a selection actually offers', () => {
    const trace = traceAction(newGame().game, 'take');
    const selection = trace.details.find((d) => d.step.includes('value'));
    expect(selection?.info).toContain('3');
  });

  it('traces for the player it is given, not only the current one', () => {
    const testGame = newGame();
    const other = testGame.game.players[1];
    expect(traceAction(testGame.game, 'take', other).actionName).toBe('take');
  });

  it('defaults to the current player when none is given', () => {
    const testGame = newGame();
    expect(traceAction(testGame.game, 'take').available)
      .toBe(traceAction(testGame.game, 'take', testGame.game.currentPlayer!).available);
  });

  it('does not change the game it inspects', () => {
    const testGame = newGame();
    const before = JSON.stringify(testGame.game.toJSON());
    traceAction(testGame.game, 'take');
    traceAction(testGame.game, 'spend');
    traceAction(testGame.game, 'pickEmpty');
    expect(JSON.stringify(testGame.game.toJSON())).toBe(before);
  });
});

describe('logAvailableActions', () => {
  it('names the player it is reporting for', () => {
    const testGame = newGame();
    expect(logAvailableActions(testGame.game))
      .toContain(testGame.game.currentPlayer!.name);
  });

  it('lists every registered action', () => {
    const output = logAvailableActions(newGame().game);
    for (const name of ['take', 'spend', 'pickEmpty']) {
      expect(output).toContain(name);
    }
  });

  it('marks available actions with a tick and unavailable ones with a cross', () => {
    const output = logAvailableActions(newGame().game);
    const lines = output.split('\n');
    expect(lines.find((l) => l.includes('take'))).toContain('✓');
    expect(lines.find((l) => l.includes('spend'))).toContain('✗');
  });

  it('gives a reason on every line', () => {
    for (const line of logAvailableActions(newGame().game).split('\n').slice(1)) {
      expect(line).toMatch(/ - \S/);
    }
  });

  it('reflects a condition becoming satisfied', () => {
    const testGame = newGame();
    expect(logAvailableActions(testGame.game).split('\n').find((l) => l.includes('spend')))
      .toContain('✗');
    testGame.game.unlocked = true;
    expect(logAvailableActions(testGame.game).split('\n').find((l) => l.includes('spend')))
      .toContain('✓');
  });

  it('reports for the player it is given', () => {
    const testGame = newGame();
    const other = testGame.game.players[1];
    expect(logAvailableActions(testGame.game, other)).toContain(other.name);
  });
});

describe('diffSnapshots', () => {
  const diff = (before: unknown, after: unknown) =>
    diffSnapshots(JSON.stringify(before), JSON.stringify(after));

  it('says so plainly when nothing changed', () => {
    expect(diff({ score: 1 }, { score: 1 })).toBe('No changes detected');
  });

  it('shows a changed scalar as before → after', () => {
    expect(diff({ score: 1 }, { score: 2 })).toContain('score: 1 → 2');
  });

  it('walks into nested objects and reports the full path', () => {
    expect(diff({ player: { hand: { count: 5 } } }, { player: { hand: { count: 4 } } }))
      .toContain('player.hand.count: 5 → 4');
  });

  it('reports an added key with its value', () => {
    expect(diff({}, { winner: 2 })).toContain('winner: added (2)');
  });

  it('reports a removed key with what it held', () => {
    expect(diff({ winner: 2 }, {})).toContain('winner: removed (was 2)');
  });

  it('reports a type change rather than a confusing value diff', () => {
    expect(diff({ score: 1 }, { score: 'one' })).toContain('type changed from number to string');
  });

  it('reports an array length change and the changed index', () => {
    const output = diff({ hand: [1, 2] }, { hand: [1, 2, 3] });
    expect(output).toContain('hand: length 2 → 3');
    expect(output).toContain('hand[2]');
  });

  it('reports a changed element inside an array by index', () => {
    expect(diff({ hand: [1, 2] }, { hand: [1, 9] })).toContain('hand[1]: 2 → 9');
  });

  it('collects several changes under one Changes heading', () => {
    const output = diff({ a: 1, b: 1 }, { a: 2, b: 2 });
    expect(output.startsWith('Changes:\n')).toBe(true);
    expect(output).toContain('a: 1 → 2');
    expect(output).toContain('b: 1 → 2');
  });

  it('shows what a real action changed in a game snapshot', () => {
    const testGame = newGame();
    const before = JSON.stringify(testGame.getSnapshot());
    testGame.doAction(1, 'take', { value: 3 });
    const after = JSON.stringify(testGame.getSnapshot());
    const output = diffSnapshots(before, after);
    expect(output).not.toBe('No changes detected');
    expect(output).toContain('score');
  });
});
