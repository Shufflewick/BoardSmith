// @vitest-environment jsdom
/**
 * IN A SIMULTANEOUS STEP, EVERY SEAT THAT STILL HAS TO ACT IS SHOWN AS ACTING,
 * THE VIEWER INCLUDED (#337).
 *
 * Since #321 a simultaneous step reports no `currentPlayer`: the only record of
 * who must act is `flowState.awaitingPlayers`. The shell used to feed the
 * players panel that list with the viewer's own seat filtered out, so the
 * viewer's card said nothing, the opponent's card said "Bob is playing", and
 * the compact header read only "Bob is playing" while the Action Panel offered
 * the viewer a move.
 *
 * Asserted on the REAL GameShell, driven by the `game_state` frame a platform
 * host sends, with the frame shaped the way `buildPlayerState` shapes it in a
 * simultaneous step. Four surfaces must agree on one answer: the player cards,
 * the compact seat strip, the Action Panel, and `useGameContext()` for a custom
 * UI. The screen-reader announcement is asserted in the same mount.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { useGameContext } from '../composables/useGameContext.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

const PLAYERS = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
  { seat: 2, name: 'Carol' },
];

/** A custom UI that draws who the context says must act, the way a game would. */
const DueSeatsBoard = defineComponent({
  name: 'DueSeatsBoard',
  setup() {
    const { dueSeats, isMyTurn, availableActions } = useGameContext();
    return () => h('div', [
      h('span', { 'data-testid': 'board-actions' }, availableActions.value.join(',')),
      h('span', { 'data-testid': 'board-due' }, dueSeats.value.join(',')),
      h('span', { 'data-testid': 'board-my-turn' }, String(isMyTurn.value)),
    ]);
  },
});

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', ...data } }));
}

/**
 * A simultaneous `discard` step as the viewer (seat 0) receives it. `done` names
 * the seats that have already committed; the rest are still deciding.
 */
function simultaneousFrame(done: number[] = []): Record<string, unknown> {
  const awaitingPlayers = PLAYERS.map((p) => ({
    playerIndex: p.seat,
    availableActions: ['discard'],
    completed: done.includes(p.seat),
  }));
  const viewerDue = !done.includes(0);
  return {
    type: 'game_state',
    view: {
      flowState: { awaitingInput: true, complete: false, awaitingPlayers },
      state: {
        view: {},
        players: PLAYERS,
        isMyTurn: viewerDue,
        availableActions: viewerDue ? ['discard'] : [],
        actionMetadata: viewerDue
          ? { discard: { name: 'discard', prompt: 'Discard a card', selections: [] } }
          : {},
      },
    },
    winners: [],
  };
}

/** A turn-based step that is Bob's alone, as the viewer receives it. */
function bobsTurnFrame(): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      flowState: { awaitingInput: true, complete: false, currentPlayer: 1, availableActions: ['play'] },
      state: { view: {}, players: PLAYERS, currentPlayer: 1, isMyTurn: false, availableActions: [] },
    },
    winners: [],
  };
}

/** Every shell a test mounted; unmounted after each test even when it failed, so no listener leaks. */
const mounted: Array<{ unmount(): void }> = [];

async function mountAsAlice() {
  enterIframe();
  const wrapper = mountPlatformShell({ board: DueSeatsBoard });
  mounted.push(wrapper);
  await nextTick();
  post({ type: 'init', seat: 0 });
  await nextTick();
  await nextTick();
  return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountAsAlice>>;

/** The turn-status sentence on each player card, by name. */
function cardStatuses(wrapper: Wrapper): Record<string, string> {
  const out: Record<string, string> = {};
  for (const card of wrapper.findAll('.side-scroll .player-card')) {
    out[card.find('.player-name').text()] = card.find('.turn-status').exists()
      ? card.find('.turn-status').text()
      : '';
  }
  return out;
}

/** Which cards the panel marks as acting (aria-current), by name. */
function currentCards(wrapper: Wrapper): string[] {
  return wrapper.findAll('.side-scroll .player-card')
    .filter((card) => card.attributes('aria-current') === 'true')
    .map((card) => card.find('.player-name').text());
}

const stripStatus = (wrapper: Wrapper) =>
  wrapper.find('.mobile-strip .strip-status').text();

/** Every polite announcement the shell relayed, in order. */
function announcements(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .map(([message]) => message as { source?: string; type?: string; text?: string })
    .filter((m) => m?.source === 'boardsmith-a11y' && m.type === 'announce')
    .map((m) => m.text as string);
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
  leaveIframe();
});

describe('GameShell in a simultaneous step (#337)', () => {
  it('tells the viewer it is their move, and shows every other deciding seat as playing', async () => {
    const wrapper = await mountAsAlice();
    post(simultaneousFrame());
    await nextTick();

    expect(cardStatuses(wrapper)).toEqual({
      Alice: 'Your move',
      Bob: 'Bob is playing',
      Carol: 'Carol is playing',
    });
    expect(currentCards(wrapper)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(stripStatus(wrapper)).toBe('Your move · Bob and Carol are playing');
  });

  it('gives a custom UI the same seats through useGameContext().dueSeats', async () => {
    const wrapper = await mountAsAlice();
    post(simultaneousFrame());
    await nextTick();

    expect(wrapper.find('[data-testid="board-due"]').text()).toBe('0,1,2');
    expect(wrapper.find('[data-testid="board-my-turn"]').text()).toBe('true');
    // The Action Panel offers the viewer the move the header now says is theirs.
    const panel = wrapper.find('#bs-actionbar .action-panel-root');
    expect(panel.exists()).toBe(true);
    expect(panel.find('.waiting-message').exists()).toBe(false);
  });

  it('once the viewer has committed, shows only the seats still deciding, on every surface', async () => {
    const wrapper = await mountAsAlice();
    post(simultaneousFrame([0]));
    await nextTick();

    expect(cardStatuses(wrapper)).toEqual({ Alice: '', Bob: 'Bob is playing', Carol: 'Carol is playing' });
    expect(currentCards(wrapper)).toEqual(['Bob', 'Carol']);
    expect(stripStatus(wrapper)).toBe('Bob and Carol are playing');
    expect(wrapper.find('[data-testid="board-due"]').text()).toBe('1,2');
    expect(wrapper.find('[data-testid="board-my-turn"]').text()).toBe('false');
    expect(wrapper.find('.waiting-message').text()).toContain('Bob, Carol');
    // A committed seat has nothing left to take (#408).
    expect(wrapper.find('[data-testid="board-actions"]').text()).toBe('');
  });

  it('never names the viewer in its own waiting line, whoever has committed (D27)', async () => {
    // Every combination of which seats have committed. Whenever the waiting
    // line is up, it names exactly the OTHER seats still deciding, in seat order.
    const wrapper = await mountAsAlice();
    for (const done of [[], [0], [1], [2], [0, 1], [0, 2], [1, 2]]) {
      post(simultaneousFrame(done));
      await nextTick();
      const line = wrapper.find('.waiting-message');
      if (!done.includes(0)) {
        expect(line.exists(), `done=${done}`).toBe(false);
        continue;
      }
      const deciding = ['Bob', 'Carol'].filter((_, i) => !done.includes(i + 1));
      expect(line.findAll('.awaiting-seat').map((n) => n.text()), `done=${done}`).toEqual(deciding);
    }
  });

  it('names the one acting seat in a turn-based step, through the same list', async () => {
    const wrapper = await mountAsAlice();
    post(bobsTurnFrame());
    await nextTick();

    expect(cardStatuses(wrapper)).toEqual({ Alice: '', Bob: 'Bob is playing', Carol: '' });
    expect(stripStatus(wrapper)).toBe('Bob is playing');
    expect(wrapper.find('[data-testid="board-due"]').text()).toBe('1');
    // The flow's `play` is Bob's; the viewer is given none of it (#408).
    expect(wrapper.find('[data-testid="board-actions"]').text()).toBe('');
  });

  it('announces "Your move" once when the step opens, not on every frame after', async () => {
    const wrapper = await mountAsAlice();
    post(bobsTurnFrame());
    await nextTick();
    const spy = vi.spyOn(window, 'postMessage');

    post(simultaneousFrame());
    await nextTick();
    // Bob commits, then Carol does: two more frames while the viewer is still due.
    post(simultaneousFrame([1]));
    await nextTick();
    post(simultaneousFrame([1, 2]));
    await nextTick();

    expect(announcements(spy)).toEqual(['Your move']);
  });

  it('announces who is still deciding once after the viewer commits, not on every frame', async () => {
    const wrapper = await mountAsAlice();
    post(simultaneousFrame());
    await nextTick();
    const spy = vi.spyOn(window, 'postMessage');

    post(simultaneousFrame([0]));
    await nextTick();
    // Identical frames re-sent (a reconnect, an unrelated broadcast) say nothing new.
    post(simultaneousFrame([0]));
    await nextTick();
    post(simultaneousFrame([0]));
    await nextTick();

    expect(announcements(spy)).toEqual(['Bob and Carol are playing']);
  });
});
