import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
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
  gameClass: PassGame as new (...args: unknown[]) => unknown,
  gameType: 'pass',
  minPlayers: 1,
  maxPlayers: 4,
};

describe('MultiplayerHost — declared color palette reaches per-seat color (D16/DEVHOST-04)', () => {
  it('threads an explicit colorPalette into the start op playerOptions[seat].color (characterization: host already threads it)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let startOptions: any = null;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
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
});
