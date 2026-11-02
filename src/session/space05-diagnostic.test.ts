import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Action,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { buildPlayerState } from './utils.js';
import { _clearShownWarnings } from '../utils/dev.js';

// F-10 / SPACE-05 (v4.8): buildPlayerState reconciles the flow's (frozen,
// per-seat) availableActions snapshot against the condition-checked
// actionMetadata by narrowing to the metadata keys. Pre-fix that narrowing was
// SILENT — a flow offering a now-condition-false action (a real game bug) and
// the pathological "every offered action fails its condition" strand both
// vanished with zero diagnostic. This suite proves the narrowing now warns.
//
// The divergence is reachable in a SIMULTANEOUS step: a seat's offered list is
// worked out again when any seat's action settles (#1551), but a change made
// outside any action (with no refreshAwaitingActions()) leaves it stale.

class SimGateGame extends Game<SimGateGame, Player> {
  canPlay = true;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('play')
        .condition({ 'gate is open': (ctx) => (ctx.game as SimGateGame).canPlay })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: simultaneousActionStep({
        name: 'sim-play',
        players: () => this.players,
        actions: ['play'],
      }),
    });
  }
}

function startRunner(): GameRunner<SimGateGame> {
  const runner = new GameRunner<SimGateGame>({
    GameClass: SimGateGame,
    gameType: 'sim-gate',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'gate' },
  });
  runner.start();
  return runner;
}

describe('SPACE-05 silent-narrowing diagnostic (F-10)', () => {
  it('warns loudly (stranded) when an on-turn seat has EVERY offered action narrowed away', () => {
    const runner = startRunner();
    // The gate closes outside any action: seat 2's offered list still has
    // 'play' but its condition is now false.
    runner.game.canPlay = false;

    _clearShownWarnings();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const state = buildPlayerState(runner, ['A', 'B'], 2, { includeActionMetadata: true });

    expect(state.isMyTurn).toBe(true); // seat 2 still awaiting
    expect(state.availableActions).toEqual([]); // narrowed to empty
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stranding'));

    warnSpy.mockRestore();
  });

  it('does NOT warn before the gate closes (negative control)', () => {
    const runner = startRunner();
    _clearShownWarnings();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const state = buildPlayerState(runner, ['A', 'B'], 2, { includeActionMetadata: true });

    expect(state.availableActions).toEqual(['play']);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('stranding'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('condition() returned false'));

    warnSpy.mockRestore();
  });
});
