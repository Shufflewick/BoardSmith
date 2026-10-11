// @vitest-environment jsdom
/**
 * THE HISTORY TAB's seat badge (#622).
 *
 * A history entry's `player` is the 1-based seat that made the move
 * (`serializeAction` stores `player.seat`). These play real moves through a
 * headless session, feed its `debugHistory` answer to the tab, and check each
 * badge names, and is coloured as, the seat that moved.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import HistoryTab from './HistoryTab.vue';
import { Game, Player, Action, actionStep, loop, eachPlayer, type GameOptions } from '../../../engine/index.js';
import { createHeadlessSession } from '../../../session/headless-session.js';
import type { GameDefinitionLike } from '../../../session/stateless-ops.js';

class TurnsGame extends Game<TurnsGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    });
  }
}

const def: GameDefinitionLike = { gameClass: TurnsGame, gameType: 'history-seat-badge', minPlayers: 2, maxPlayers: 2 };

async function historyAfterEachSeatMoves() {
  const session = createHeadlessSession(def, { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'history-seat-badge' });
  await session.start();
  for (const seat of [1, 2]) {
    const moved = await session.send(seat, { type: 'action', actionName: 'pass', player: seat, args: {} });
    if (!moved.success) throw new Error(moved.error);
  }
  const history = await session.send(1, { type: 'debugHistory' });
  if (!history.success) throw new Error(history.error);
  return history.actionHistory;
}

function mountHistory(actionHistory: Awaited<ReturnType<typeof historyAfterEachSeatMoves>>) {
  return mount(HistoryTab, {
    props: {
      actionHistory,
      historyLoading: false,
      historyError: null,
      selectedActionIndex: null,
      isViewingHistory: false,
      pendingRewindIndex: null,
      pendingRewindDiscardCount: 0,
      rewindLoading: false,
      rewindError: null,
    },
  });
}

describe('HistoryTab seat badge (#622)', () => {
  it('names the seat that made each move', async () => {
    const wrapper = mountHistory(await historyAfterEachSeatMoves());

    expect(wrapper.findAll('.history-player').map((badge) => badge.text())).toEqual(['P1', 'P2']);
  });

  it('colours each badge with the colour of the seat that made the move', async () => {
    const wrapper = mountHistory(await historyAfterEachSeatMoves());

    expect(wrapper.findAll('.history-player').map((badge) => badge.attributes('style'))).toEqual([
      '--badge-seat: var(--bsg-seat-1);',
      '--badge-seat: var(--bsg-seat-2);',
    ]);
  });
});
