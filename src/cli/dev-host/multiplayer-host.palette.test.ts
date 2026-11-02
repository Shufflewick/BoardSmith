import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike, type GamePreset } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';

/**
 * D16/DEVHOST-04: a game's declared color palette must reach each seat's
 * `color` in the `start` op's gameOptions — not the engine red/blue/green
 * default. This file is separate from multiplayer-host.test.ts (which other
 * 161-plans also touch) to stay file-disjoint (161-01-PLAN.md).
 */

class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    });
  }
}

const def = {
  gameClass: PassGame,
  gameType: 'pass',
  minPlayers: 1,
  maxPlayers: 4,
} satisfies GameDefinitionLike;

describe('MultiplayerHost — declared color palette reaches per-seat color (D16/DEVHOST-04)', () => {
  it('threads an explicit colorPalette into the start op playerOptions[seat].color (characterization: host already threads it)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let startOptions: any = null;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'palette',
      colorPalette: [
        { value: '#123456', label: 'Custom One' },
        { value: '#abcdef', label: 'Custom Two' },
      ],
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') startOptions = gameOptions;
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => sent.push({ clientId, msg }),
    });

    await host.handleMessage('A', { type: 'hello' });

    const playerOptions = startOptions?.playerOptions as Array<{ color?: string }> | undefined;
    expect(playerOptions).toBeDefined();
    expect(playerOptions?.[0].color).toBe('#123456');
  });

  it('adversarial: a non-default hex reaches the per-seat color, proving the engine red/blue/green is not substituted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let startOptions: any = null;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const NON_DEFAULT_HEX = '#654321';
    const host = new MultiplayerHost({
      playerCount: 1,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'palette-adversarial',
      colorPalette: [{ value: NON_DEFAULT_HEX, label: 'Weird' }],
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') startOptions = gameOptions;
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => sent.push({ clientId, msg }),
    });

    await host.handleMessage('A', { type: 'hello' });

    const playerOptions = startOptions?.playerOptions as Array<{ color?: string }> | undefined;
    expect(playerOptions?.[0].color).toBe(NON_DEFAULT_HEX);
    // The engine's DEFAULT_COLOR_PALETTE first entry must NOT have been substituted.
    expect(playerOptions?.[0].color).not.toBe('red');
    expect(playerOptions?.[0].color).not.toBe('#e74c3c');
  });

  it('F-04: the palette reaches the ACTUAL player.color in the broadcast view (not just the wire frame)', async () => {
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'palette-view',
      colorPalette: [
        { value: '#123456', label: 'Custom One' },
        { value: '#abcdef', label: 'Custom Two' },
      ],
      executeOp: (gameOptions, snap, pend, op, hostOptions) =>
        executeOp(def, gameOptions, snap, pend, op, hostOptions),
      send: (clientId, msg) => sent.push({ clientId, msg }),
    });

    await host.handleMessage('A', { type: 'hello' });

    // The first browser is auto-seated on seat 1 and receives a game_state
    // broadcast whose view carries the actual per-seat player.color — this is
    // exactly what GameShell renders. Pre-fix the engine ignored the palette
    // (constructor reads only options.colors) and assigned its red/blue default.
    const gameStates = sent
      .map((s) => s.msg)
      .filter((m): m is Extract<HostOutbound, { type: 'game_state' }> => m.type === 'game_state');
    expect(gameStates.length).toBeGreaterThan(0);

    const view = gameStates[gameStates.length - 1].view as {
      state?: { players?: Array<{ seat: number; color?: string }> };
    };
    const players = view.state?.players ?? [];
    const seat1 = players.find((p) => p.seat === 1);
    const seat2 = players.find((p) => p.seat === 2);
    expect(seat1?.color).toBe('#123456');
    expect(seat2?.color).toBe('#abcdef');
  });
});

describe('MultiplayerHost — each declared player option\'s default reaches every seat (#1304)', () => {
  it('seeds every seat with the defaults beside its colour', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let startOptions: any = null;
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'player-option-defaults',
      colorPalette: [{ value: '#123456', label: 'One' }, { value: '#abcdef', label: 'Two' }],
      playerOptions: {
        handicap: { type: 'number', label: 'Handicap', default: 2 },
        ready: { type: 'boolean', label: 'Ready', default: false },
      },
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') startOptions = gameOptions;
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: () => {},
    });

    await host.handleMessage('A', { type: 'hello' });

    expect(startOptions.playerOptions).toEqual([
      { handicap: 2, ready: false, color: '#123456' },
      { handicap: 2, ready: false, color: '#abcdef' },
    ]);
  });
});

describe('MultiplayerHost — a player option named like a seat field does not replace it (#1304)', () => {
  it('keeps the host\'s name, isBot and botLevel in playerConfigs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let startOptions: any = null;
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'seat-fields-win',
      botLevel: 'hard',
      playerOptions: {
        name: { type: 'select', label: 'Name', default: 'Option', choices: [{ value: 'Option', label: 'Option' }] },
        isBot: { type: 'boolean', label: 'Bot', default: false },
        botLevel: { type: 'select', label: 'Level', default: 'easy', choices: [{ value: 'easy', label: 'Easy' }] },
      },
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') startOptions = gameOptions;
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: () => {},
    });

    await host.handleMessage('A', { type: 'hello' });

    expect(startOptions.playerConfigs[1]).toMatchObject({ isBot: true, botLevel: 'hard' });
    expect(startOptions.playerConfigs[1].name).not.toBe('Option');
  });
});

describe('MultiplayerHost — a join colour must be one of the palette\'s (#1566)', () => {
  function paletteHost() {
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'join-colour',
      colorPalette: [{ value: '#E74C3C', label: 'Red' }, { value: '#3498DB', label: 'Blue' }],
      executeOp: (gameOptions, snap, pend, op, hostOptions) => executeOp(def, gameOptions, snap, pend, op, hostOptions),
      send: (clientId, msg) => sent.push({ clientId, msg }),
    });
    const lastOfType = <T extends HostOutbound['type']>(clientId: string, type: T) =>
      sent.filter((s) => s.clientId === clientId && s.msg.type === type).at(-1)?.msg as Extract<HostOutbound, { type: T }>;
    return { host, lastOfType };
  }

  it('refuses a colour outside the palette, and leaves the seat open', async () => {
    const { host, lastOfType } = paletteHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, color: '#1abc9c' });
    expect(lastOfType('B', 'error').message).toBe(
      'Seat 2 was not taken: its color "#1abc9c" is not in the game\'s colorPalette (#E74C3C, #3498DB).',
    );
    await host.handleMessage('B', { type: 'getLobby', requestId: 'check' });
    expect(lastOfType('B', 'lobby').seats.find((s) => s.seat === 2)).toMatchObject({ held: false, connected: false });
  });

  it('takes a palette colour written in another case as the palette writes it', async () => {
    const { host, lastOfType } = paletteHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, color: '#3498db' });
    expect(lastOfType('B', 'joined')).toMatchObject({ seat: 2 });
    expect(lastOfType('B', 'lobby').seats.find((s) => s.seat === 2)).toMatchObject({ held: true, color: '#3498DB' });
  });
});

describe('MultiplayerHost — seats hold different colours while the palette has enough (#1569)', () => {
  const RED = '#E74C3C';
  const BLUE = '#3498DB';
  const GREEN = '#27AE60';

  function colourHost(playerCount: number, palette: string[], presets?: GamePreset[]) {
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const starts: Array<{ colors?: string[] }> = [];
    const host = new MultiplayerHost({
      playerCount,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'unique-colours',
      colorPalette: palette.map((value) => ({ value, label: value })),
      presets,
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') starts.push(gameOptions as { colors?: string[] });
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => sent.push({ clientId, msg }),
    });
    const lastOfType = <T extends HostOutbound['type']>(clientId: string, type: T) =>
      sent.filter((s) => s.clientId === clientId && s.msg.type === type).at(-1)?.msg as Extract<HostOutbound, { type: T }>;
    const lastColors = () => starts.at(-1)?.colors;
    return { host, lastOfType, lastColors };
  }

  it('refuses a join colour another seat holds, and leaves the seat open', async () => {
    const { host, lastOfType } = colourHost(2, [RED, BLUE]);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, color: RED.toLowerCase() });
    expect(lastOfType('B', 'error').message).toBe(
      `Seat 2 was not taken: seat 1 holds the color ${RED}. Pick a color no other seat holds.`,
    );
    await host.handleMessage('B', { type: 'getLobby', requestId: 'check' });
    expect(lastOfType('B', 'lobby').seats.find((s) => s.seat === 2)).toMatchObject({ held: false });
  });

  it('lets a player keep their own colour when they move to another seat', async () => {
    const { host, lastOfType } = colourHost(2, [RED, BLUE]);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'join', seat: 2, color: RED });
    expect(lastOfType('A', 'joined')).toMatchObject({ seat: 2 });
  });

  it('deals a seat nobody holds the first colour no seat holds, not the colour at its position', async () => {
    const { host, lastColors } = colourHost(2, [RED, BLUE]);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'join', seat: 1, color: BLUE });
    await host.handleMessage('A', { type: 'restart' });
    expect(lastColors()).toEqual([BLUE, RED]);
  });

  it('gives a joining player with no colour the first colour no seat holds', async () => {
    const { host, lastOfType } = colourHost(2, [RED, BLUE]);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'join', seat: 1, color: BLUE });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 });
    expect(lastOfType('B', 'lobby').seats.map((s) => s.color)).toEqual([BLUE, RED]);
  });

  it('lets seats share a colour once the table has more seats than the palette has colours', async () => {
    const { host, lastOfType } = colourHost(3, [RED, BLUE]);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, color: RED });
    expect(lastOfType('B', 'joined')).toMatchObject({ seat: 2 });
  });

  it('re-deals a held colour a preset gives another seat', async () => {
    const presets = [{ name: 'Blue second', options: {}, players: [{}, { color: BLUE }] }];
    const { host, lastColors } = colourHost(2, [RED, BLUE, GREEN], presets);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'join', seat: 1, color: BLUE });
    await host.handleMessage('A', { type: 'configure', preset: 'Blue second' });
    expect(lastColors()).toEqual([RED, BLUE]);
  });

  it('deals a shared colour again once the table shrinks to one the palette covers (#1569 review F1)', async () => {
    const { host, lastOfType, lastColors } = colourHost(3, [RED, BLUE]);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, color: RED });
    await host.handleMessage('A', { type: 'configure', gameOptions: { playerCount: 2 } });
    expect(lastColors()).toEqual([RED, BLUE]);
    expect(lastOfType('B', 'lobby').seats.map((s) => s.color)).toEqual([RED, BLUE]);
  });

  it('keeps the colour of a player a preset moves off a bot seat (#1569 review F2)', async () => {
    const presets = [{ name: 'Bot second', options: {}, players: [{}, { isBot: true }, {}] }];
    const YELLOW = '#F1C40F';
    const { host, lastOfType, lastColors } = colourHost(3, [RED, BLUE, GREEN, YELLOW], presets);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, color: YELLOW });
    await host.handleMessage('A', { type: 'configure', preset: 'Bot second' });
    expect(lastOfType('B', 'joined')).toMatchObject({ seat: 3 });
    expect(lastColors()).toEqual([RED, BLUE, YELLOW]);
  });

  it('gives a player taking an away player\'s seat the seat\'s own colour, not the away player\'s (#1569 review F5)', async () => {
    const presets = [{ name: 'Green second', options: {}, players: [{}, { color: GREEN }] }];
    const { host, lastOfType } = colourHost(2, [RED, BLUE, GREEN], presets);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', preset: 'Green second' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, color: BLUE });
    host.disconnect('B');
    await host.handleMessage('C', { type: 'hello' });
    await host.handleMessage('C', { type: 'join', seat: 2 });
    expect(lastOfType('C', 'lobby').seats.map((s) => s.color)).toEqual([RED, GREEN]);
  });

  it('gives an open seat whose preset colour a player holds the first colour no seat holds', async () => {
    const presets = [{ name: 'Blue second', options: {}, players: [{}, { color: BLUE }] }];
    const { host, lastColors } = colourHost(2, [RED, BLUE, GREEN], presets);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', preset: 'Blue second' });
    await host.handleMessage('A', { type: 'join', seat: 1, color: BLUE });
    await host.handleMessage('A', { type: 'restart' });
    expect(lastColors()).toEqual([BLUE, RED]);
  });
});
