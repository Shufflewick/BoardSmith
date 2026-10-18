// @vitest-environment jsdom
/**
 * A SEAT CHANGE REACHES THE BOARD TOGETHER WITH THAT SEAT'S VIEW (#1135).
 *
 * The dev host's Follow active seat moves a page to the next seat with `init`
 * and then sends that seat's `game_state`, two messages. The shell applied the
 * seat on `init`, so the board rendered once as the new seat over the OLD
 * seat's view, where the new seat's private data is not there. A board that
 * read it threw, Vue's patch of the shell broke, and the Action Panel stayed
 * drawn as it was mid-submission: "Finishing your last move", every action
 * disabled, the old seat's badge, until a page reload.
 *
 * Driven on the REAL GameShell, controller and transport, in the order the
 * issue recorded: seat 1 checks in, the host re-seats the page as seat 2 and
 * sends its view, and only then answers the check-in.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

/** Seat `seat`'s view of a two-seat simultaneous check-in; only the viewer's own player carries its `hand`. */
function seatFrame(seat: number, checkedIn: number[]): Record<string, unknown> {
  const due = !checkedIn.includes(seat);
  return {
    type: 'game_state',
    view: {
      flowState: {
        awaitingInput: true,
        complete: false,
        awaitingPlayers: [1, 2].map((s) => ({ playerIndex: s, availableActions: ['checkIn', 'pass'], completed: checkedIn.includes(s) })),
      },
      state: {
        view: {},
        players: [1, 2].map((s) => (s === seat ? { seat: s, name: `P${s}`, hand: [`seat ${s} card`] } : { seat: s, name: `P${s}` })),
        isMyTurn: due,
        // Two actions, so the panel waits for the player rather than auto-running a sole one.
        availableActions: due ? ['checkIn', 'pass'] : [],
        actionMetadata: due
          ? { checkIn: { name: 'checkIn', prompt: 'Check in', selections: [] }, pass: { name: 'pass', prompt: 'Pass', selections: [] } }
          : {},
      },
    },
    winners: [],
  };
}

/** What the board was handed on each render: the seat, and whether that seat's own hand was in the view. */
const renders: Array<{ seat: number; ownHand: boolean }> = [];

/** A board that, like a game, reads its own seat's private data. */
const HandBoard = defineComponent({
  name: 'HandBoard',
  props: { playerSeat: { type: Number, required: true }, myPlayer: { type: Object, default: undefined } },
  setup(props) {
    return () => {
      renders.push({ seat: props.playerSeat, ownHand: Array.isArray(props.myPlayer?.hand) });
      return h('div', 'board');
    };
  },
});

const mounted: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  renders.length = 0;
  leaveIframe();
});

describe('GameShell following the active seat (#1135)', () => {
  it('never shows the board a seat over another seat\'s view, and leaves the next seat free to act', async () => {
    const posted = enterIframe() as Array<{ type?: string; op?: string; requestId?: string }>;
    const wrapper = mountPlatformShell({ board: HandBoard });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(seatFrame(1, []));
    await flushPromises();

    const checkIn = () => wrapper.find('#bs-actionbar .action-panel-root').findAll('button').find((b) => b.text().includes('Check in'));
    await checkIn()!.trigger('click');
    const request = posted.find((m) => m.type === 'server_request' && m.op === 'action');
    expect(request, 'the panel never sent the check-in').toBeDefined();

    // Separate host messages: the shell renders between them.
    fromHost({ type: 'init', seat: 2 });
    await flushPromises();
    fromHost(seatFrame(2, [1]));
    await flushPromises();
    fromHost({ type: 'server_response', requestId: request!.requestId, result: { success: true } });
    await flushPromises();

    expect(renders.filter((r) => r.seat > 0 && !r.ownHand)).toEqual([]);
    expect(renders.at(-1)).toEqual({ seat: 2, ownHand: true });
    const panel = wrapper.find('#bs-actionbar .action-panel-root');
    expect(panel.attributes('data-bs-submitting')).toBeUndefined();
    expect(checkIn()!.attributes('aria-disabled')).toBeUndefined();
    expect(posted.filter((m) => m.type === 'server_request' && m.op === 'action')).toHaveLength(1);
  });

  it('reports a reply that lands after the change under the seat that sent the action (#1150)', async () => {
    const posted = enterIframe() as Array<{ type?: string; op?: string; requestId?: string }>;
    const resolved: Array<{ action: string; seat: number }> = [];
    const listen = (e: Event) => resolved.push((e as CustomEvent).detail);
    window.addEventListener('boardsmith:action-resolved', listen);
    try {
      const wrapper = mountPlatformShell({ board: HandBoard });
      mounted.push(wrapper);
      await nextTick();
      fromHost({ type: 'init', seat: 1 });
      fromHost(seatFrame(1, []));
      await flushPromises();

      const checkIn = wrapper.find('#bs-actionbar .action-panel-root').findAll('button').find((b) => b.text().includes('Check in'));
      await checkIn!.trigger('click');
      const request = posted.find((m) => m.type === 'server_request' && m.op === 'action');

      fromHost({ type: 'init', seat: 2 });
      await flushPromises();
      fromHost(seatFrame(2, [1]));
      await flushPromises();
      fromHost({ type: 'server_response', requestId: request!.requestId, result: { success: true } });
      await flushPromises();
    } finally {
      window.removeEventListener('boardsmith:action-resolved', listen);
    }

    expect(resolved).toEqual([{ action: 'checkIn', success: true, seat: 1 }]);
  });

  it('lets the new seat act while the old seat\'s action is still out, and lands that reply under the old seat (#1155)', async () => {
    const posted = enterIframe() as Array<{ type?: string; op?: string; requestId?: string; seat?: number }>;
    const resolved: Array<{ action: string; seat: number }> = [];
    const listen = (e: Event) => resolved.push((e as CustomEvent).detail);
    window.addEventListener('boardsmith:action-resolved', listen);
    try {
      const wrapper = mountPlatformShell({ board: HandBoard });
      mounted.push(wrapper);
      await nextTick();
      fromHost({ type: 'init', seat: 1 });
      fromHost(seatFrame(1, []));
      await flushPromises();

      const panel = () => wrapper.find('#bs-actionbar .action-panel-root');
      const checkIn = () => panel().findAll('button').find((b) => b.text().includes('Check in'));
      const actions = () => posted.filter((m) => m.type === 'server_request' && m.op === 'action');
      await checkIn()!.trigger('click');
      expect(panel().attributes('data-bs-submitting')).toBeDefined();

      fromHost({ type: 'init', seat: 2 });
      await flushPromises();
      fromHost(seatFrame(2, [1]));
      await flushPromises();

      // Seat 1's reply is still out: seat 2 is not shown as submitting and can act.
      expect(panel().attributes('data-bs-submitting')).toBeUndefined();
      expect(checkIn()!.attributes('aria-disabled')).toBeUndefined();
      await checkIn()!.trigger('click');
      expect(actions()).toHaveLength(2);
      expect(panel().attributes('data-bs-submitting')).toBeDefined();

      fromHost({ type: 'server_response', requestId: actions()[0].requestId, result: { success: true } });
      await flushPromises();
      expect(resolved).toEqual([{ action: 'checkIn', success: true, seat: 1 }]);
      // Seat 2's own request is untouched by seat 1's reply.
      expect(panel().attributes('data-bs-submitting')).toBeDefined();

      fromHost({ type: 'server_response', requestId: actions()[1].requestId, result: { success: true } });
      await flushPromises();
      expect(resolved).toEqual([{ action: 'checkIn', success: true, seat: 1 }, { action: 'checkIn', success: true, seat: 2 }]);
      expect(panel().attributes('data-bs-submitting')).toBeUndefined();
    } finally {
      window.removeEventListener('boardsmith:action-resolved', listen);
    }
  });

  it('shows the old seat busy again on switching back while its action is still out (#1155)', async () => {
    const posted = enterIframe() as Array<{ type?: string; op?: string; requestId?: string }>;
    const wrapper = mountPlatformShell({ board: HandBoard });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(seatFrame(1, []));
    await flushPromises();

    const panel = () => wrapper.find('#bs-actionbar .action-panel-root');
    await panel().findAll('button').find((b) => b.text().includes('Check in'))!.trigger('click');
    fromHost({ type: 'init', seat: 2 });
    await flushPromises();
    fromHost(seatFrame(2, [1]));
    await flushPromises();
    expect(panel().attributes('data-bs-submitting')).toBeUndefined();

    fromHost({ type: 'init', seat: 1 });
    await flushPromises();
    fromHost(seatFrame(1, []));
    await flushPromises();
    expect(panel().attributes('data-bs-submitting')).toBeDefined();

    const request = posted.find((m) => m.type === 'server_request' && m.op === 'action');
    fromHost({ type: 'server_response', requestId: request!.requestId, result: { success: true } });
    await flushPromises();
    expect(panel().attributes('data-bs-submitting')).toBeUndefined();
  });
});
