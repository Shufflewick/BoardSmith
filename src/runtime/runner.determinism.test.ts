/**
 * Byte-for-byte determinism of engine-owned state (#54).
 *
 * The engine's own lint rules forbid game code from reading a clock, because
 * two runs from the same seed must produce the same state. The engine used to
 * break that rule on its own data: `serializeAction` stamped `Date.now()` onto
 * every history entry, and `pushAnimationEvent` stamped it into the animation
 * buffer. Neither fed game logic, but both made `JSON.stringify(snapshot)`
 * differ between runs, which defeats exactly the replay and snapshot-equality
 * checks a seeded engine exists to support.
 *
 * Wall-clock time belongs at the session boundary, which is where GameSession
 * stamps it (see game-session.determinism.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { Game, Space, Piece, Player, Action, defineFlow, loop, eachPlayer, actionStep, type FlowContext } from '../engine/index.js';
import { GameRunner } from './runner.js';

class Token extends Piece<ClockGame, Player> {}
class Tray extends Space<ClockGame, Player> {}

class ClockGame extends Game<ClockGame, Player> {
  tray!: Tray;

  constructor(options: { playerCount: number; seed?: string }) {
    super(options);
    this.registerElements([Token, Tray]);
    this.tray = this.create(Tray, 'tray');
    this.tray.createMany(4, Token, 'token');

    const nudge = Action.create('nudge')
      .prompt('Nudge')
      .execute((_args, ctx) => {
        // An ANIMATE command, so the animation-event buffer is non-empty.
        ctx.game.animate('nudge', { amount: 1 });
        return { success: true };
      });
    this.registerActions(nudge);

    this.setFlow(defineFlow({
      root: loop({
        while: (ctx) => (ctx.get<number>('round') ?? 1) <= 2,
        maxIterations: 10,
        do: eachPlayer({ do: actionStep({ actions: ['nudge'] }) }),
      }),
      setup: (ctx) => ctx.set('round', 1),
    }));
  }
}

function playTwoActions(seed: string): GameRunner<ClockGame> {
  const runner = new GameRunner({
    GameClass: ClockGame,
    gameType: 'clock-game',
    gameOptions: { playerCount: 2, seed },
  });
  runner.start();
  runner.performAction('nudge', 1, {});
  runner.performAction('nudge', 2, {});
  return runner;
}

describe('engine-owned state carries no wall-clock time (#54)', () => {
  it('produces byte-identical snapshots for two runs of the same seed', () => {
    const a = playTwoActions('same-seed');
    const b = playTwoActions('same-seed');
    expect(JSON.stringify(a.getSnapshot())).toBe(JSON.stringify(b.getSnapshot()));
  });

  it('records no timestamp on a history entry — that is the session\'s to add', () => {
    const runner = playTwoActions('history');
    expect(runner.actionHistory).toHaveLength(2);
    for (const entry of runner.actionHistory) {
      expect(entry.timestamp).toBeUndefined();
    }
  });

  it('produces byte-identical history for two runs of the same seed', () => {
    const a = playTwoActions('history-eq');
    const b = playTwoActions('history-eq');
    expect(JSON.stringify(a.actionHistory)).toBe(JSON.stringify(b.actionHistory));
  });

  it('orders animation events by their sequence id, carrying no clock reading', () => {
    const runner = playTwoActions('anim');
    const events = runner.game.pendingAnimationEvents;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).not.toHaveProperty('timestamp');
    }
    // `id` is the ordering key the timestamp was never needed for.
    expect(events.map(e => e.id)).toEqual([...events.map(e => e.id)].sort((x, y) => x - y));
  });
});
