/**
 * #959: a restore refuses a state whose players do not match the player count
 * the game was built with, instead of loading it and leaving the two disagreeing.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, actionStep, type GameOptions } from '../engine/index.js';
import { GameRunner } from './index.js';

class SeatGame extends Game<SeatGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow({ root: actionStep({ actions: [] }) });
  }
}

const isPlayerJson = (child: { className?: string }) => child.className === 'Player';

describe('restoring a state whose players do not match the player count (#959)', () => {
  it('fromSnapshot refuses a state missing a player, naming both counts', () => {
    const live = new GameRunner({ GameClass: SeatGame, gameType: 'seats', gameOptions: { playerCount: 3, seed: 'seats' } });
    live.start();
    const snapshot = live.getSnapshot();
    const lastPlayer = snapshot.state.children!.findLastIndex(isPlayerJson);
    snapshot.state.children!.splice(lastPlayer, 1);

    expect(() => GameRunner.fromSnapshot(snapshot, SeatGame)).toThrow(
      /holds 2 players, but this game was built for 3/,
    );
  });

  it('loadSerializedState refuses a state with more players than the game was built for', () => {
    const wide = new SeatGame({ playerCount: 3, seed: 'seats', elementIdKey: '00000000000000aa' });
    const narrow = new SeatGame({ playerCount: 2, seed: 'seats', elementIdKey: '00000000000000aa' });

    expect(() => narrow.loadSerializedState(wide.toJSON())).toThrow(/holds 3 players, but this game was built for 2/);
  });
});
