/**
 * toDebugString — FLOW-01 integration (Phase 123 Plan 03)
 *
 * Verifies toDebugString(game) embeds the human-readable flow position
 * (phase/step/waiting-on-seat) sourced from Game.getFlowDebugInfo().describe(),
 * per the FLOW-01 locked decision ("integrated into toDebugString() — one
 * source of truth all layers reuse").
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { toDebugString } from './debug.js';

class DebugFixtureGame extends Game<DebugFixtureGame, Player> {
  score = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<DebugFixtureGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 1,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      }),
    );
  }
}

describe('toDebugString — flow position (FLOW-01)', () => {
  it('output contains the human-readable flow position', () => {
    const testGame = TestGame.create(DebugFixtureGame, { playerCount: 2, seed: 'debug-flow-position' });
    const output = toDebugString(testGame.game);

    expect(output).toContain('Flow position:');
    // Must equal the game's own getFlowDebugInfo().describe() output — no
    // duplicated recomputation of flow position inside toDebugString.
    expect(output).toContain(testGame.game.getFlowDebugInfo().describe());
  });

  it('degrades gracefully to "no active flow" when the flow has not started', () => {
    const testGame = TestGame.create(DebugFixtureGame, {
      playerCount: 2,
      seed: 'debug-no-flow',
      autoStart: false,
    });
    const output = toDebugString(testGame.game);

    expect(output).toContain('Flow position:');
    expect(output).toContain('no active flow');
  });
});
