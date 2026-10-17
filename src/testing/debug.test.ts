/**
 * toDebugString — FLOW-01 integration (Phase 123 Plan 03)
 *
 * Verifies toDebugString(game) embeds the human-readable flow position
 * (phase/step/waiting-on-seat) sourced from Game.getFlowDebugInfo().describe(),
 * per the FLOW-01 locked decision ("integrated into toDebugString() — one
 * source of truth all layers reuse").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  Game,
  Player,
  Space,
  Card,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { toDebugString, diffSnapshots } from './debug.js';

class DebugFixtureGame extends Game<DebugFixtureGame, Player> {
  score = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card]);
    const deck = this.create(Space, 'deck');
    deck.create(Card, 'ace-of-spades');
    deck.create(Space, 'box').create(Card, 'two-of-hearts');

    this.registerAction(
      Action.create<DebugFixtureGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow({
      root: loop({
        while: () => true,
        maxIterations: 1,
        do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    });
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

describe('toDebugString — element tree and current player (#913)', () => {
  const output = () =>
    toDebugString(TestGame.create(DebugFixtureGame, { playerCount: 2, seed: 'debug-913' }).game);

  it('prints each element once, under its parent', () => {
    const lines = output().split('\n').filter(line => line.includes('ace-of-spades'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^    ace-of-spades /);
  });

  it('counts direct children, not every descendant (#1075)', () => {
    expect(output()).toMatch(/^  deck \(id=\d+\): 2 children$/m);
  });

  it('names the current player by seat', () => {
    expect(output()).toMatch(/Current Player: .+ \(seat 1\)/);
  });
});

class MyGame extends Game<MyGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card]);
    const deck = this.create(Space, 'deck');
    for (let i = 0; i < 3; i++) deck.create(Card, `card-${i}`);
    this.create(Space, 'discard').create(Card, 'card-3');
    this.registerAction(Action.create<MyGame>('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ name: 'play', actions: ['pass'] }) });
  }
}

describe('toDebugString JSDoc example (#1075)', () => {
  it('matches what toDebugString prints, ids aside', () => {
    const source = readFileSync(new URL('./debug.ts', import.meta.url), 'utf8');
    const block = source.split('console.log(toDebugString(game, { maxDepth: 1 }));\n')[1].split(' * ```')[0];
    const documented = block.trimEnd().split('\n').map(line => line.replace(/^ \* \/\/ ?/, ''));
    const game = TestGame.create(MyGame, { playerCount: 2, seed: 'debug-1075' }).game;
    const maskIds = (text: string) => text.replace(/id=\d+/g, 'id=#');
    expect(maskIds(documented.join('\n'))).toBe(maskIds(toDebugString(game, { maxDepth: 1 })));
  });
});

describe('diffSnapshots (#913)', () => {
  it('reports a field that goes from an object to null', () => {
    expect(diffSnapshots('{"a":{"b":1}}', '{"a":null}')).toBe('Changes:\n  a: {"b":1} → null');
  });

  it('reports a field that goes from null to an object', () => {
    expect(diffSnapshots('{"a":null}', '{"a":{"b":1}}')).toBe('Changes:\n  a: null → {"b":1}');
  });
});
