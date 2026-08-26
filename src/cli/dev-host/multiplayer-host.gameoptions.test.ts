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
  // CR-02: a boolean option — a raw string "false" must NOT arrive JS-truthy.
  { id: 'hardMode', type: 'boolean', label: 'Hard mode', default: false },
  // CR-02: a `select` option with NON-STRING declared choice values — a raw
  // CLI-flag string ("4") must still match the numeric choice (4).
  {
    id: 'level',
    type: 'select',
    label: 'Level',
    default: 1,
    choices: [
      { value: 1, label: 'Level 1' },
      { value: 4, label: 'Level 4' },
    ],
  },
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
    maxPlayers: def.maxPlayers,
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

  // F-18/DEVHOST-01: a configure playerCount outside the game's declared range
  // (here maxPlayers=4) must be rejected with an actionable error, not accepted
  // and blown up in the engine on start.
  it('rejects a configure playerCount above the game maxPlayers', async () => {
    const { host, getStartOptions, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    const startBefore = getStartOptions();
    await host.handleMessage('A', { type: 'configure', gameOptions: { playerCount: 6 } });
    const err = lastOfType('A', 'error');
    expect(err).toBeTruthy();
    expect((err as Extract<HostOutbound, { type: 'error' }>).message).toMatch(/out of range/i);
    // No restart with the out-of-range count occurred (start op unchanged).
    expect(getStartOptions()).toBe(startBefore);
  });
});

describe('MultiplayerHost — adversarial: preset bundle, override precedence, restart persistence (Task 3)', () => {
  it('applying a preset sets EVERY option in its bundle AND its declared player count', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', preset: 'advanced' });
    const opts = getStartOptions();
    expect(opts.difficulty).toBe('hard');
    expect(opts.rounds).toBe(7);
    // The preset declares 3 players (`players: [...]` length 3) — its count
    // reaches the start op's `playerCount` field.
    expect(opts.playerCount).toBe(3);
  });

  it('CR-01: a preset-applied player count keeps playerOptions/playerIsBot/playerConfigs SIZED to match — no length mismatch reaches the game constructor', async () => {
    // Host launched with 2 seats (CLI --players 2); the 'advanced' preset
    // declares 3 players. Pre-fix: opts.playerCount === 3 but the per-seat
    // arrays stay length 2 (built from the frozen constructor-time
    // this.opts.playerCount) — the exact CR-01 defect. Post-fix: `configure`
    // resizes the seat map first, so every array agrees with playerCount.
    const { host, getStartOptions, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // auto-seats A -> seat 1, 2-seat host
    await host.handleMessage('A', { type: 'configure', preset: 'advanced' });
    // No rejection — the configure must succeed and actually start the game.
    expect(lastOfType('A', 'error')).toBeUndefined();
    const opts = getStartOptions();
    expect(opts.playerCount).toBe(3);
    expect((opts.playerOptions as unknown[]).length).toBe(3);
    expect((opts.playerIsBot as unknown[]).length).toBe(3);
    expect((opts.playerConfigs as unknown[]).length).toBe(3);
  });

  it('a `--game-option`-equivalent selection OVERRIDES the preset value for the same key', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', {
      type: 'configure',
      preset: 'advanced', // sets difficulty=hard, rounds=7
      gameOptions: { rounds: 2 }, // flag beats preset for the same key
    });
    const opts = getStartOptions();
    expect(opts.difficulty).toBe('hard'); // from the preset, unchanged
    expect(opts.rounds).toBe(2); // flag override wins
  });

  it('a selection PERSISTS across a subsequent restart (does not silently revert to `.default`)', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: { difficulty: 'hard' } });
    expect(getStartOptions().difficulty).toBe('hard');
    await host.handleMessage('A', { type: 'restart' });
    expect(getStartOptions().difficulty).toBe('hard'); // still selected, not reverted to 'easy'
  });
});

describe('MultiplayerHost — CR-02: configure values are coerced to their declared type before reaching the start op', () => {
  it('a `number` option arrives as a real number, not the wire string', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: { rounds: '5' } });
    const opts = getStartOptions();
    expect(opts.rounds).toBe(5);
    expect(typeof opts.rounds).toBe('number');
  });

  it('a `boolean` option string "false" arrives as boolean false, NOT JS-truthy', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: { hardMode: 'false' } });
    const opts = getStartOptions();
    expect(opts.hardMode).toBe(false);
    expect(typeof opts.hardMode).toBe('boolean');
  });

  it('a `boolean` option string "true" arrives as boolean true', async () => {
    const { host, getStartOptions } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: { hardMode: 'true' } });
    expect(getStartOptions().hardMode).toBe(true);
  });

  it('a `select` option with NON-STRING declared choices is reachable from a raw CLI-flag string', async () => {
    const { host, getStartOptions, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: { level: '4' } });
    expect(lastOfType('A', 'error')).toBeUndefined(); // must NOT be rejected as "Invalid value"
    const opts = getStartOptions();
    expect(opts.level).toBe(4);
    expect(typeof opts.level).toBe('number');
  });

  it('an uncoercible `number` value is rejected with an actionable error naming the option + expected type', async () => {
    const { host, getStartOptions, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: { rounds: 'not-a-number' } });
    const err = lastOfType('A', 'error') as Extract<HostOutbound, { type: 'error' }> | undefined;
    expect(err).toBeTruthy();
    expect(err?.message).toMatch(/"rounds"/);
    expect(err?.message).toMatch(/number/);
    expect(getStartOptions().rounds).toBe(3); // unchanged, still the original default
  });
});
