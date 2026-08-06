// @vitest-environment jsdom
/**
 * GameShell — players-panel ordering (`playerOrder`).
 *
 * Mirrors GameShell.vue's `panelPlayers` computed exactly, in the same harness
 * style as GameShell.action-panel-suppression.test.ts, rather than mounting the
 * full WebSocket-dependent GameShell:
 *
 *   const panelPlayers = computed(() => {
 *     const all = players.value;
 *     if (props.playerOrder === 'seat' || all.length < 2) return all;
 *     const sequence = Array.isArray(props.playerOrder)
 *       ? props.playerOrder
 *       : turnSequence(state.value?.flowState);
 *     if (sequence.length === 0) return all;
 *     ...orderSeatsByTurn(...)
 *   });
 *
 * The behaviour under test is the DEFAULT: a panel that lists seats in the order
 * the flow will take them, without rotating to put the acting player on top.
 * Rows must stay put as the turn advances — that stability is the reason the
 * default is sequence order rather than a rotating queue.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { turnSequence, orderSeatsByTurn, type SeatActivityState } from '../../engine/flow/seat-activity.js';

interface TestPlayer {
  seat: number;
  name: string;
}

const OrderHarness = defineComponent({
  name: 'OrderHarness',
  props: {
    playerOrder: { type: [String, Array] as unknown as () => 'turn' | 'seat' | number[], default: 'turn' },
    players: { type: Array as () => TestPlayer[], default: () => [] },
    flowState: { type: Object as () => SeatActivityState | null, default: null },
  },
  setup(props) {
    const panelPlayers = computed(() => {
      const all = props.players;
      if (props.playerOrder === 'seat' || all.length < 2) return all;

      const sequence = Array.isArray(props.playerOrder)
        ? props.playerOrder
        : turnSequence(props.flowState);
      if (sequence.length === 0) return all;

      const bySeat = new Map(all.map((p) => [p.seat, p]));
      return orderSeatsByTurn([...bySeat.keys()], sequence)
        .map((seat) => bySeat.get(seat))
        .filter((p): p is TestPlayer => p !== undefined);
    });
    return { panelPlayers };
  },
  template: `<ul><li v-for="p in panelPlayers" :key="p.seat" class="row">{{ p.seat }}</li></ul>`,
});

const seats = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.row').map((li) => Number(li.text()));

const PLAYERS: TestPlayer[] = [
  { seat: 1, name: 'Alice' },
  { seat: 2, name: 'Bob' },
  { seat: 3, name: 'Clara' },
];

const flowWith = (eligibleSeats: number[], nextIndex = 0): SeatActivityState => ({
  awaitingInput: true,
  position: { frameData: { __frame_1: { eligibleSeats, nextIndex } } },
});

describe('GameShell playerOrder', () => {
  it('defaults to the order the flow will actually take, not seat order', () => {
    const wrapper = mount(OrderHarness, {
      props: { players: PLAYERS, flowState: flowWith([3, 1, 2]) },
    });
    expect(seats(wrapper)).toEqual([3, 1, 2]);
  });

  it('rows do NOT move as the turn advances — only the position within the round does', async () => {
    // The reason sequence order is the default: the panel is the one stable
    // reference surface in the UI. Advancing the round must not restack it.
    const flowState = ref(flowWith([3, 1, 2], 0));
    const wrapper = mount(OrderHarness, {
      props: { players: PLAYERS, flowState: flowState.value },
    });
    const before = seats(wrapper);

    for (const nextIndex of [1, 2, 3]) {
      await wrapper.setProps({ flowState: flowWith([3, 1, 2], nextIndex) });
      expect(seats(wrapper)).toEqual(before);
    }
  });

  it("'seat' opts out", () => {
    const wrapper = mount(OrderHarness, {
      props: { players: PLAYERS, playerOrder: 'seat', flowState: flowWith([3, 1, 2]) },
    });
    expect(seats(wrapper)).toEqual([1, 2, 3]);
  });

  it('an explicit seat array wins — for turn orders the flow cannot express', () => {
    // The reported case: a co-op whose turn order is each role's printed rank,
    // chosen at setup. No eachPlayer frame describes it, so the game declares it.
    const wrapper = mount(OrderHarness, {
      props: { players: PLAYERS, playerOrder: [2, 3, 1], flowState: flowWith([1, 2, 3]) },
    });
    expect(seats(wrapper)).toEqual([2, 3, 1]);
  });

  it('falls back to seat order on a simultaneous step, where there is no running order', () => {
    const wrapper = mount(OrderHarness, {
      props: {
        players: PLAYERS,
        flowState: {
          awaitingInput: true,
          awaitingPlayers: [
            { playerIndex: 1, availableActions: ['go'], completed: false },
            { playerIndex: 2, availableActions: ['go'], completed: false },
          ],
        },
      },
    });
    expect(seats(wrapper)).toEqual([1, 2, 3]);
  });

  it('falls back to seat order before a flow state exists at all', () => {
    const wrapper = mount(OrderHarness, { props: { players: PLAYERS, flowState: null } });
    expect(seats(wrapper)).toEqual([1, 2, 3]);
  });

  it('never drops a player the round filtered out', () => {
    // Seat 2 sat this round out; they still have a name, a score and a
    // presence dot to render.
    const wrapper = mount(OrderHarness, {
      props: { players: PLAYERS, flowState: flowWith([3, 1]) },
    });
    expect(seats(wrapper)).toEqual([3, 1, 2]);
  });

  it('every ordering is a permutation — no player is ever lost from the panel', () => {
    for (const order of ['turn', 'seat', [3], [2, 2, 9]] as Array<'turn' | 'seat' | number[]>) {
      const wrapper = mount(OrderHarness, {
        props: { players: PLAYERS, playerOrder: order, flowState: flowWith([3, 1, 2]) },
      });
      expect([...seats(wrapper)].sort()).toEqual([1, 2, 3]);
    }
  });
});

// ── Source assertions: the shell really is wired this way ───────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('GameShell.vue source: panel ordering wiring', () => {
  const source = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'),
    'utf-8',
  );

  it("defaults playerOrder to 'turn'", () => {
    expect(source).toMatch(/playerOrder:\s*'turn'/);
  });

  it('feeds BOTH panels the ordered list (sidebar via playersWithConnection, mobile strip directly)', () => {
    expect(source).toMatch(/return panelPlayers\.value/);
    expect(source).toMatch(/:players="panelPlayers"/);
    expect(source).toMatch(/:players="playersWithConnection"/);
  });

  it('leaves the seat-ordered `players` array alone for every other consumer', () => {
    // Turning ordering on must reorder the panel and nothing else.
    expect(source).toMatch(/const players = computed\(\(\) => state\.value\?\.state\.players \|\| \[\]\)/);
  });
});
