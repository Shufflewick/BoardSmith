import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from './game.js';
import { Player } from '../player/player.js';

// The Game constructor schedules the volatile-state scan only in dev mode, and
// dev mode has one source: isDevMode() (#694).
const devMode = vi.hoisted(() => ({ value: true }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.value };
});
const scan = vi.hoisted(() => vi.fn());
vi.mock('./volatile-state.js', () => ({ checkForVolatileState: scan }));

class BareGame extends Game<BareGame, Player> {}

describe('volatile-state scan follows isDevMode()', () => {
  beforeEach(() => scan.mockClear());

  it('runs the scan after construction when isDevMode() is true', async () => {
    devMode.value = true;
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    await game.ready();
    expect(scan).toHaveBeenCalledWith(game);
  });

  it('does not run the scan when isDevMode() is false', async () => {
    devMode.value = false;
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    await game.ready();
    expect(scan).not.toHaveBeenCalled();
  });
});
