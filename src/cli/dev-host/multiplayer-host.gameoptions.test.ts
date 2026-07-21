import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import type { DevOptionDef } from './config-types.js';

/**
 * D13/DEVHOST-01 (161-02): a selected gameOption/preset must reach the
 * `start` op's gameOptions — replacing the frozen `.default`-only
 * `baseGameOptions`. New file, disjoint from `multiplayer-host.test.ts`
 * (which other 161-plans touch).
 */

// A game whose `difficulty` select option defaults to 'easy' but declares
// 'hard' as a valid choice — proves a selected (non-default) value reaches
// the start op.
class DifficultyGame extends Game<DifficultyGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const def: GameDefinitionLike = {
  gameClass: DifficultyGame as new (...args: unknown[]) => unknown,
  gameType: 'difficulty-game',
  minPlayers: 1,
  maxPlayers: 4,
};

const declaredGameOptions: DevOptionDef[] = [
  {
    id: 'difficulty',
    type: 'select',
    label: 'Difficulty',
    default: 'easy',
    choices: [
      { value: 'easy', label: 'Easy' },
      { value: 'hard', label: 'Hard' },
    ],
  },
  { id: 'rounds', type: 'number', label: 'Rounds', default: 3, min: 1, max: 10 },
];

const presets = [
  {
    name: 'advanced',
    description: 'Advanced setup',
    options: { difficulty: 'hard', rounds: 7 },
    players: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }],
  },
];

function makeHost(overrides: { baseGameOptions?: Record<string, unknown> } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let startOptions: any = null;
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 1,
    makeSeed: () => 'go',
    baseGameOptions: overrides.baseGameOptions ?? Object.fromEntries(declaredGameOptions.map((o) => [o.id, o.default])),
    declaredGameOptions,
    presets,
    executeOp: (gameOptions, snap, pend, op, hostOptions) => {
      if (op.type === 'start') startOptions = gameOptions;
      return executeOp(def, gameOptions, snap, pend, op, hostOptions);
    },
    send: (clientId, msg) => sent.push({ clientId, msg }),
  });
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...sent].reverse().find((e) => e.clientId === clientId && e.msg.type === type)?.msg as
      | HostOutbound
      | undefined;
  return { host, getStartOptions: () => startOptions, lastOfType };
}

describe('MultiplayerHost — gameOption/preset selection reaches the start op (D13/DEVHOST-01)', () => {
  it('the frozen default reaches the start op when nothing is selected (characterization)', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    expect(getStartOptions().difficulty).toBe('easy');
  });

  it('a `configure` selection REPLACES the default in the (re)started op', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // initial auto-start
    await host.handleMessage('A', { type: 'configure', gameOptions: { difficulty: 'hard' } });
    expect(getStartOptions().difficulty).toBe('hard'); // NOT 'easy' (.default)
  });

  it('applying a preset by name sets EVERY option in its bundle', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', preset: 'advanced' });
    expect(getStartOptions().difficulty).toBe('hard');
    expect(getStartOptions().rounds).toBe(7);
  });

  it('rejects an UNDECLARED option key — the start op must not carry the bogus key', async () => {
    const { host, getStartOptions, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: { notARealOption: 'x' } });
    const err = lastOfType('A', 'error');
    expect(err).toBeTruthy();
    expect((err as Extract<HostOutbound, { type: 'error' }>).message).toMatch(/notARealOption/);
    // The bogus key must never have reached the start op.
    expect(getStartOptions().notARealOption).toBeUndefined();
    expect(getStartOptions().difficulty).toBe('easy'); // unchanged, still the original default
  });
});
