// @vitest-environment jsdom
/**
 * HOW MANY ROUND TRIPS A PICK COSTS (#1615).
 *
 * On a phone each `resolveChoices` is iframe to page to socket to the table to
 * the executor and back, and the executor rebuilds the game for it. A seat's
 * state carries each action's opening element pick answered when every
 * candidate is a card its board already shows, so a state push asks nothing and
 * opening such an action asks nothing. A pick that names a card the seat cannot
 * see is still answered by the server, when the seat opens it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ref, type Ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Piece, Space, Card, Action, actionStep, type GameOptions } from '../../engine/index.js';
import type { PlayerGameState } from '../../session/types.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import { mountTableWiring, settle, startTable } from './table-wiring.test-helper.js';

class Pawn extends Piece<TripGame> {}
class Room extends Space<TripGame> {}
class Secret extends Card<TripGame> {}

class TripGame extends Game<TripGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const rooms = ['bridge', 'engine', 'hold'].map((name) => this.create(Room, name));
    rooms[0]!.create(Pawn, 'pawn');
    const deck = this.create(Space, 'deck');
    deck.contentsHidden();
    deck.create(Secret, 'one');
    deck.create(Secret, 'two');
    const done = () => ({ success: true });

    this.registerAction(Action.create('move').chooseElement('room', { elements: () => rooms.slice(1) }).execute(done));
    this.registerAction(Action.create('rest').chooseElement('room', { elements: () => rooms }).execute(done));
    this.registerAction(Action.create('draw').chooseElement('card', { elements: () => deck.all(Secret) }).execute(done));
    this.setFlow({
      root: actionStep({ actions: ['move', 'rest', 'draw'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 20 }),
    });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mountTable() {
  const session = await startTable(TripGame, 'bs1615');
  const seatState = ref(session.playerState(1)) as Ref<PlayerGameState>;
  const send = vi.spyOn(session, 'send');
  const { wiring, wrapper } = mountTableWiring({
    session: () => session, seat: 1, seatState, boardInteraction: createBoardInteraction(), autoEndTurn: false,
  });
  mounted.push(wrapper);
  await settle();
  const asked = () => send.mock.calls.filter(([, op]) => op.type === 'resolveChoices').map(([, op]) => (op as { actionName: string }).actionName);
  return { session, seatState, wiring, asked };
}

describe('round trips per pick (#1615)', () => {
  it('asks nothing when a state lands, though every action opens with an element pick', async () => {
    const { session, seatState, asked } = await mountTable();
    const rooms = session.readGame().all(Room);
    await session.send(1, { type: 'action', actionName: 'rest', player: 1, args: { room: rooms[1]!.id } });
    seatState.value = session.playerState(1);
    await settle();
    expect(asked()).toEqual([]);
  });

  it('carries an opening pick over cards the seat sees, and leaves one over hidden cards to the server', async () => {
    const { seatState } = await mountTable();
    const first = (action: string) => seatState.value.actionMetadata![action]!.selections[0]!;
    expect(first('move').validElements?.map((e) => e.display)).toEqual(['engine', 'hold']);
    expect(first('rest').validElements).toHaveLength(3);
    expect(first('draw').validElements).toBeUndefined();
  });

  it('opens an action whose opening pick the state carries with no request', async () => {
    const { wiring, asked } = await mountTable();
    await wiring.controller.start('move');
    await settle();
    expect(wiring.controller.validElements.value.map((e) => e.display)).toEqual(['engine', 'hold']);
    expect(asked()).toEqual([]);
  });

  it('asks the server for an opening pick over hidden cards, once, when the action opens', async () => {
    const { wiring, asked } = await mountTable();
    await wiring.controller.start('draw');
    await settle();
    expect(wiring.controller.validElements.value).toHaveLength(2);
    expect(asked()).toEqual(['draw']);
  });

  it('lets the board start an action from the candidates the state carries', async () => {
    const { wiring } = await mountTable();
    expect([...wiring.controller.startCandidates.value.keys()]).toEqual(['move', 'rest']);
  });
});
