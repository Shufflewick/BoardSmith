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
 * These drive a real `GameSession`, as a game's test does: the seat state is
 * `buildPlayerState(seat)`, re-read after every move.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computed, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../../engine/index.js';
import { GameSession } from '../../session/game-session.js';
import type { PlayerGameState } from '../../session/types.js';
import { createBoardInteraction, type BoardInteraction } from './useBoardInteraction.js';
import { useTableActionWiring, type TableActionWiring } from './useTableActionWiring.js';

class Pawn extends Piece<MoveGame> {}
class Room extends Space<MoveGame> {}

/** One pawn, three rooms; seat 1 moves it to any room it is not already in. */
class MoveGame extends Game<MoveGame, Player> {
  rooms: Room[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.rooms = ['bridge', 'engine', 'hold'].map((n) => this.create(Room, n));
    this.rooms[0].create(Pawn, 'pawn');

    this.registerAction(
      Action.create('move')
        .chooseElement('destination', {
          elements: (ctx) => {
            const game = ctx.game as MoveGame;
            const pawn = game.first(Pawn)!;
            return game.rooms.filter((r) => r !== pawn.parent);
          },
        })
        .disabled((ctx) => ((ctx.game as MoveGame).tired ? 'The crew is resting' : false))
        .execute((args, ctx) => {
          (ctx.game as MoveGame).first(Pawn)!.putInto(args.destination as Room);
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['move'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 20,
        }),
      }),
    );
  }

  /** Set by a test to make `move` disabled with a reason. */
  tired = false;

  roomIds(...names: string[]): number[] {
    return names.map((n) => this.rooms.find((r) => r.name === n)!.id);
  }
}

const SEAT = 1;

function newSession(seed: string) {
  return GameSession.create<MoveGame>({
    gameType: 'move',
    GameClass: MoveGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed,
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface Table {
  session: GameSession<MoveGame>;
  seatState: Ref<PlayerGameState>;
  board: BoardInteraction;
  wiring: TableActionWiring;
  /** Re-reads the seat's state, as a broadcast would deliver it. */
  broadcast: () => void;
  /** Replaces the game, as the dev host's New game does. */
  newGame: (seed: string) => void;
  /** Room ids the board currently offers, sorted. */
  offered: () => number[];
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function mountTable(): Table {
  let session = newSession('bs378');
  const seatState = ref(session.buildPlayerState(SEAT)) as Ref<PlayerGameState>;
  const board = createBoardInteraction();
  let wiring: TableActionWiring | undefined;

  const Host = defineComponent({
    setup() {
      wiring = useTableActionWiring({
        seatState,
        availableActions: computed(() => seatState.value.availableActions ?? []),
        isMyTurn: computed(() => seatState.value.isMyTurn),
        playerSeat: ref(SEAT),
        boardInteraction: board,
        autoEndTurn: ref(true),
        isViewingHistory: ref(false),
        // Exactly the transport build/test.md shows a game. The new state
        // reaches the seat as a separate broadcast, after the action's own
        // reply, as it does over the wire: see `broadcast`.
        sendAction: (name, args) => session.performAction(name, SEAT, args),
        fetchPickChoices: async (action, pick, player, args) => session.getPickChoices(action, pick, player, args),
      });
      return () => h('div');
    },
  });
  mounted.push(mount(Host));

  return {
    get session() { return session; },
    seatState,
    board,
    wiring: wiring!,
    broadcast: () => { seatState.value = session.buildPlayerState(SEAT); },
    newGame: (seed) => {
      session = newSession(seed);
      seatState.value = session.buildPlayerState(SEAT);
    },
    offered: () => board.validElements.map((t) => t.id).sort((a, b) => a - b),
  };
}

describe('useTableActionWiring drives the board from the seat state alone (#378)', () => {
  it('opens the pick on the board and a board click completes the move', async () => {
    const table = mountTable();
    await settle();

    const game = table.session.runner.game;
    expect(table.wiring.controller.currentAction.value).toBe('move');
    expect(table.offered()).toEqual(game.roomIds('engine', 'hold').sort((a, b) => a - b));

    table.board.triggerElementSelect({ id: game.roomIds('hold')[0] });
    await settle();
    table.broadcast();
    await settle();

    expect(game.first(Pawn)!.parent!.name).toBe('hold');
    // The next move reopens against the new position.
    expect(table.offered()).toEqual(game.roomIds('bridge', 'engine').sort((a, b) => a - b));
  });

  it('re-deals the open pick after an undo, with no restoreEpoch passed by the caller', async () => {
    const table = mountTable();
    await settle();
    const game = () => table.session.runner.game;

    table.board.triggerElementSelect({ id: game().roomIds('engine')[0] });
    await settle();
    table.broadcast();
    await settle();
    expect(table.offered()).toEqual(game().roomIds('bridge', 'hold').sort((a, b) => a - b));

    const undo = await table.session.undoToTurnStart(SEAT);
    expect(undo.success).toBe(true);
    table.broadcast();
    await settle();

    // The pawn is back in the bridge, so the open pick must offer the other two.
    expect(game().first(Pawn)!.parent!.name).toBe('bridge');
    expect(table.offered()).toEqual(game().roomIds('engine', 'hold').sort((a, b) => a - b));
  });

  it('re-deals the open pick after a new game, with no gameInstanceId passed by the caller', async () => {
    const table = mountTable();
    await settle();
    const game = () => table.session.runner.game;

    // Move the pawn so the open pick is computed from a position the new game
    // does not share. Element ids are the same in both games (same setup), so
    // only the position tells them apart.
    table.board.triggerElementSelect({ id: game().roomIds('engine')[0] });
    await settle();
    table.broadcast();
    await settle();
    expect(table.offered()).toEqual(game().roomIds('bridge', 'hold').sort((a, b) => a - b));

    // A new game opens at the same step with the same actions, and the same
    // restoreEpoch (0): only the game's identity moved.
    table.newGame('bs378-second');
    await settle();

    expect(game().first(Pawn)!.parent!.name).toBe('bridge');
    expect(table.offered()).toEqual(game().roomIds('engine', 'hold').sort((a, b) => a - b));
  });

  it('refuses a disabled action on the board, reading the reason from the seat state', async () => {
    const table = mountTable();
    table.session.runner.game.tired = true;
    table.broadcast();
    await settle();

    expect(table.wiring.disabledActions.value).toEqual({ move: 'The crew is resting' });
    expect(table.wiring.controller.currentAction.value).toBeNull();
    expect(table.offered()).toEqual([]);
  });

  it('hands back the action metadata it read, so a panel is fed the same record', async () => {
    const table = mountTable();
    await settle();
    expect(Object.keys(table.wiring.actionMetadata.value)).toEqual(['move']);
    expect(table.wiring.actionMetadata.value).toEqual(table.seatState.value.actionMetadata);
  });
});

describe('GameShell wires its actions through the same function (#378)', () => {
  const shell = readFileSync(join(import.meta.dirname, '../components/GameShell.vue'), 'utf-8');

  it('calls useTableActionWiring', () => {
    expect(shell).toMatch(/\buseTableActionWiring\(\{/);
  });

  it('does not call the controller or the bridge itself, so a test wired with the helper cannot drift from it', () => {
    expect(shell).not.toMatch(/\buseActionController\(/);
    expect(shell).not.toMatch(/\buseBoardActionBridge\(/);
  });
});
