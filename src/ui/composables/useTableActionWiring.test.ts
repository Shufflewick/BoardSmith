// @vitest-environment jsdom
/**
 * ONE WIRING FOR A TABLE'S ACTIONS, SHARED BY GAMESHELL AND A GAME'S TESTS (#378).
 *
 * #356 replaced `useBoardActionBridge`'s `restoreEpoch` option with
 * `runnerIdentity`, and every game test that wired the controller and the bridge
 * by hand, which is what build/test.md's a11y floor asked for, stopped
 * type-checking. The cause was not the rename: it was that a game had to know
 * which fields of `PlayerGameState` the bridge reads. `useTableActionWiring`
 * reads them itself, off the seat state it is handed, and GameShell calls it
 * too, so a test wired with it is wired the way production is.
 *
 * These drive the live session host (`createHeadlessSession`), as a game's
 * test does: the seat state is `playerState(seat)`, re-read after every move.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ref, type Ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import type { HeadlessSession } from '../../session/headless-session.js';
import type { PlayerGameState } from '../../session/types.js';
import { MoveGame } from '../../session/move-game.test-helper.js';
import { createBoardInteraction, type BoardInteraction } from './useBoardInteraction.js';
import type { TableActionWiring } from './useTableActionWiring.js';
import { mountTableWiring, settle, startTable } from './table-wiring.test-helper.js';

const SEAT = 1;

interface Table {
  session: HeadlessSession<MoveGame>;
  seatState: Ref<PlayerGameState>;
  board: BoardInteraction;
  wiring: TableActionWiring;
  /** Re-reads the seat's state, as a broadcast would deliver it. */
  broadcast: () => void;
  /** Replaces the game, as the dev host's New game does. */
  newGame: (seed: string) => Promise<void>;
  /** The game as it stands now. */
  game: () => MoveGame;
  /** Clicks a room on the board; the move's state broadcast lands in the table's delivery order. */
  moveTo: (room: string) => Promise<void>;
  /** Room ids the board currently offers, sorted. */
  offered: () => number[];
}

/**
 * The order a move's two messages reach the seat. Over a real transport the
 * action's reply and the state broadcast travel separately, so either can land
 * first (#384), and the board must end up the same way both times.
 */
type Delivery = 'reply-first' | 'state-first';

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mountTable(delivery: Delivery = 'reply-first'): Promise<Table> {
  let session = await startTable(MoveGame, 'bs378');
  const seatState = ref(session.playerState(SEAT)) as Ref<PlayerGameState>;
  const board = createBoardInteraction();
  // Exactly the transport build/test.md shows a game. The new state reaches
  // the seat as a separate broadcast: after the action's own reply
  // ('reply-first', see `moveTo`), or before it ('state-first').
  const { wiring, wrapper } = mountTableWiring({
    session: () => session,
    seat: SEAT,
    seatState,
    boardInteraction: board,
    autoEndTurn: true,
    afterPerform: () => {
      if (delivery === 'state-first') seatState.value = session.playerState(SEAT);
    },
  });
  mounted.push(wrapper);

  return {
    get session() { return session; },
    seatState,
    board,
    wiring,
    broadcast: () => { seatState.value = session.playerState(SEAT); },
    newGame: async (seed) => {
      session = await startTable(MoveGame, seed);
      seatState.value = session.playerState(SEAT);
    },
    game: () => session.readGame(),
    moveTo: async (room) => {
      board.triggerElementSelect({ id: session.readGame().roomIds(room)[0] });
      await settle();
      if (delivery === 'reply-first') {
        seatState.value = session.playerState(SEAT);
        await settle();
      }
    },
    offered: () => board.validElements.map((t) => t.id).sort((a, b) => a - b),
  };
}

/** The pawn is back in the bridge, so the open pick offers the other two rooms. */
function expectOfferedFromTheStart(table: Table): void {
  expect(table.game().pawnRoom()).toBe('bridge');
  expect(table.offered()).toEqual(table.game().roomIds('engine', 'hold'));
}

describe('useTableActionWiring drives the board from the seat state alone (#378)', () => {
  it('opens the pick on the board and a board click completes the move', async () => {
    const table = await mountTable();
    await settle();

    expect(table.wiring.controller.currentAction.value).toBe('move');
    expect(table.offered()).toEqual(table.game().roomIds('engine', 'hold'));

    await table.moveTo('hold');

    expect(table.game().pawnRoom()).toBe('hold');
    // The next move reopens against the new position.
    expect(table.offered()).toEqual(table.game().roomIds('bridge', 'engine'));
  });

  for (const delivery of ['reply-first', 'state-first'] as const) {
    it(`reopens the sole action for the next move whichever lands first: ${delivery} (#384)`, async () => {
      const table = await mountTable(delivery);
      await settle();

      await table.moveTo('hold');
      expect(table.game().pawnRoom()).toBe('hold');
      expect(table.wiring.controller.currentAction.value).toBe('move');
      expect(table.offered()).toEqual(table.game().roomIds('bridge', 'engine'));

      // And again, so the reopened pick is itself answerable.
      await table.moveTo('engine');
      expect(table.game().pawnRoom()).toBe('engine');
      expect(table.offered()).toEqual(table.game().roomIds('bridge', 'hold'));
    });
  }

  it('re-deals the open pick after an undo, with no restoreEpoch passed by the caller', async () => {
    const table = await mountTable();
    await settle();
    await table.moveTo('engine');
    expect(table.offered()).toEqual(table.game().roomIds('bridge', 'hold'));

    const undo = await table.session.send(SEAT, { type: 'undo', player: SEAT });
    expect(undo.success).toBe(true);
    table.broadcast();
    await settle();

    expectOfferedFromTheStart(table);
  });

  it('re-deals the open pick after a new game, with no gameInstanceId passed by the caller', async () => {
    const table = await mountTable();
    await settle();
    // Move the pawn so the open pick is computed from a position the new game
    // does not share. Element ids are the same in both games (same setup), so
    // only the position tells them apart.
    await table.moveTo('engine');

    // A new game opens at the same step with the same actions, and the same
    // restoreEpoch (0): only the game's identity moved.
    await table.newGame('bs378-second');
    await settle();

    expectOfferedFromTheStart(table);
  });

  it('refuses a disabled action on the board, reading the reason from the seat state', async () => {
    const table = await mountTable();
    await table.session.arrange((game) => {
      game.tired = true;
    });
    table.broadcast();
    await settle();

    expect(table.wiring.disabledActions.value).toEqual({ move: 'The crew is resting' });
    expect(table.wiring.controller.currentAction.value).toBeNull();
    expect(table.offered()).toEqual([]);
  });

  it('hands back the action metadata it read, so a panel is fed the same record', async () => {
    const table = await mountTable();
    await settle();
    expect(Object.keys(table.wiring.actionMetadata.value)).toEqual(['move']);
    expect(table.wiring.actionMetadata.value).toEqual(table.seatState.value.actionMetadata);
  });
});

describe('GameShell wires its actions through the same function (#378)', () => {
  const shell = readFileSync(join(import.meta.dirname, '../components/GameShell.vue'), 'utf-8');
  const seat = readFileSync(join(import.meta.dirname, 'useTableSeat.ts'), 'utf-8');

  it('calls useTableActionWiring, through useTableSeat (#406)', () => {
    expect(shell).toMatch(/\buseTableSeat\(\{/);
    expect(seat).toMatch(/\buseTableActionWiring\(\{/);
  });

  it('provides its board nothing by hand, so renderAsSeat, which also calls useTableSeat, is given it too (#406)', () => {
    expect(shell).toMatch(/\bprovideTableSeat\(tableSeat\)/);
    expect(shell).not.toMatch(/\bprovide\(/);
    expect(shell).not.toMatch(/\bprovide(BoardInteraction|Announcer|AnimationEvents|GameContext)\(/);
  });

  it('does not call the controller or the bridge itself, so a test wired with the helper cannot drift from it', () => {
    expect(shell).not.toMatch(/\buseActionController\(/);
    expect(shell).not.toMatch(/\buseBoardActionBridge\(/);
  });
});
