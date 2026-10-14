// @vitest-environment jsdom
/**
 * THE HISTORY TAB's seat badge (#622, #641).
 *
 * A history entry's `player` is the 1-based seat that made the move
 * (`serializeAction` stores `player.seat`). These play real moves through a
 * headless session, feed its `debugHistory` answer and its players to the tab,
 * and check each badge names the seat that moved and wears that player's own
 * colour, the one the player cards show.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import HistoryTab from './HistoryTab.vue';
import { Game, Player, Action, actionStep, loop, eachPlayer, type GameOptions } from '../../../engine/index.js';
import { createHeadlessSession } from '../../../testing/headless-session.js';
import type { GameDefinitionLike } from '../../../session/stateless-ops.js';

// The game's own colours, set in setup as `Player.color` documents: a dark one,
// a light one (which needs dark ink to read), and none for seat 3, the case the
// player cards draw in the accent colour with white ink.
const GAME_COLOURS = ['#123456', '#b3b7bd', undefined];

class TurnsGame extends Game<TurnsGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const player of this.all(Player)) player.color = GAME_COLOURS[player.seat - 1];
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    });
  }
}

const def: GameDefinitionLike = { gameClass: TurnsGame, gameType: 'history-seat-badge', minPlayers: 3, maxPlayers: 3 };

async function historyAfterEachSeatMoves() {
  const session = createHeadlessSession(def, { playerCount: 3, playerNames: ['Alice', 'Bob', 'Cleo'], seed: 'history-seat-badge' });
  await session.start();
  for (const seat of [1, 2, 3]) {
    const moved = await session.send(seat, { type: 'action', actionName: 'pass', player: seat, args: {} });
    if (!moved.success) throw new Error(moved.error);
  }
  const history = await session.send(1, { type: 'debugHistory' });
  if (!history.success) throw new Error(history.error);
  const views = session.broadcasts.at(-1) as Array<{ state: { players: Array<{ seat: number; color?: string }> } }>;
  return { actionHistory: history.actionHistory, players: views[0]!.state.players };
}

function mountHistory({ actionHistory, players }: Awaited<ReturnType<typeof historyAfterEachSeatMoves>>) {
  return mount(HistoryTab, {
    props: {
      actionHistory,
      players,
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

describe('HistoryTab seat badge (#622, #641)', () => {
  it('names the seat that made each move', async () => {
    const wrapper = mountHistory(await historyAfterEachSeatMoves());

    expect(wrapper.findAll('.history-player').map((badge) => badge.text())).toEqual(['P1', 'P2', 'P3']);
  });

  it("fills each badge with the moving player's own colour and inks it as the player cards do", async () => {
    const wrapper = mountHistory(await historyAfterEachSeatMoves());

    const badges = wrapper.findAll('.history-player').map((badge) => {
      const style = (badge.element as HTMLElement).style;
      return { fill: style.getPropertyValue('--badge-seat'), ink: style.color };
    });
    expect(badges).toEqual([
      { fill: '#123456', ink: 'rgb(255, 255, 255)' },
      { fill: '#b3b7bd', ink: 'rgb(0, 0, 0)' },
      // No colour: no fill set, so the stylesheet's accent fallback applies,
      // with the white ink PlayerToken and GameOverCard use for it.
      { fill: '', ink: 'rgb(255, 255, 255)' },
    ]);
  });
});
