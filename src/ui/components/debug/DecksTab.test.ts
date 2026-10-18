// @vitest-environment jsdom
/**
 * THE DECKS TAB (#157).
 *
 * These moved here whole from `DebugPanel.characterization.test.ts` when the tab
 * became its own component: the concern moved, so its tests moved with it, and
 * they now mount the ~200 lines they are about instead of the 3000-line panel.
 *
 * The tab reaches the host through the same injected bridge the panel uses, so
 * the mount below provides `platformRequest` exactly as the panel's tests do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import DecksTab from './DecksTab.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

type Op = (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

const VIEW = {
  id: 1,
  className: 'Board',
  children: [
    {
      id: 2,
      className: 'MainDeck',
      name: 'Draw',
      attributes: { $type: 'deck' },
      children: [
        { id: 10, className: 'Card', name: 'Ace', notation: 'AS' },
        { id: 11, className: 'Card', name: 'King' },
      ],
    },
    {
      id: 3,
      className: 'Hand',
      name: 'My Hand',
      children: [{ id: 12, className: 'Card', name: 'Queen' }],
    },
    { id: 4, className: 'Piece', notation: 'a1', attributes: { color: 'red' } },
  ],
};

interface Vm {
  [key: string]: any;
}

/** The host's answer to every op: the unfiltered table for `debug:deck-view` and `debug:deck-view-at`, plain success otherwise. */
const answersWith = (table: unknown): Op => async (op) => (op.startsWith('debug:deck-view') ? { success: true, view: table } : { success: true });

/** The seat's view of VIEW's deck when its cards are face down: stand-ins, not cards. */
const SEAT_VIEW = {
  id: 1,
  className: 'Board',
  children: [
    { id: 2, className: 'MainDeck', name: 'Draw', attributes: { $type: 'deck' }, children: [{ id: -1, className: 'Card' }, { id: -2, className: 'Card' }] },
  ],
};

async function mountDecks(handler?: Op, props: { view?: unknown; historyIndex?: number | null } = {}) {
  const platformRequest = vi.fn<Op>(handler ?? answersWith(VIEW));
  const wrapper = mount(DecksTab, {
    props: { view: VIEW, copy: async () => {}, historyIndex: null, ...props },
    global: { provide: { [GAME_CONTEXT_KEYS.platformRequest as symbol]: platformRequest } },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, platformRequest, vm: wrapper.vm as unknown as Vm };
}

/** Every call the tab made for one op. */
function callsFor(platformRequest: ReturnType<typeof vi.fn>, op: string) {
  return platformRequest.mock.calls.filter((c) => c[0] === op);
}

const mounted: Array<{ unmount: () => void }> = [];
function track<T extends { wrapper: { unmount: () => void } }>(m: T): T {
  mounted.push(m.wrapper);
  return m;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

describe('DecksTab edits', () => {
  it('sends each edit with its own op and payload', async () => {
    const { platformRequest, vm } = track(await mountDecks());
    await vm.moveCardToTop(10);
    await vm.shuffleDeck(2);
    expect(callsFor(platformRequest, 'debug:move-to-top')[0][1]).toEqual({ cardId: 10 });
    expect(callsFor(platformRequest, 'debug:shuffle-deck')[0][1]).toEqual({ deckId: 2 });
  });

  it('defaults a transfer to the first position', async () => {
    const { platformRequest, vm } = track(await mountDecks());
    vm.openTransferDialog(10, 2);
    vm.transferDialogTargetDeckId = 3;
    await vm.confirmTransfer();
    expect(callsFor(platformRequest, 'debug:transfer-card')[0][1]).toMatchObject({ position: 'first' });
  });

  it('uses the per-edit fallback message when the host gives no error', async () => {
    const { vm } = track(await mountDecks(async () => ({ success: false })));
    await vm.moveCardToTop(10);
    expect(vm.deckManipulationError).toBe('Failed to move card');
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).toBe('Failed to shuffle deck');
  });

  it('prefers the host error string over the fallback', async () => {
    const { vm } = track(await mountDecks(async () => ({ success: false, error: 'card is face down' })));
    await vm.moveCardToTop(10);
    expect(vm.deckManipulationError).toBe('card is face down');
  });

  it('turns a thrown edit into a message', async () => {
    const { vm } = track(await mountDecks(async () => { throw new Error('bridge down'); }));
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).toBe('bridge down');
  });

  it('clears the previous error when a later edit succeeds', async () => {
    let fail = true;
    const { vm } = track(await mountDecks(async () => (fail ? { success: false } : { success: true })));
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).not.toBeNull();
    fail = false;
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).toBeNull();
  });

  it('moveCardUp reorders to the preceding index and refuses at the top', async () => {
    const { platformRequest, vm } = track(await mountDecks());
    const deck = vm.discoveredDecks[0];
    vm.moveCardUp(deck, 11);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')[0][1]).toEqual({ cardId: 11, targetIndex: 0 });
    vm.moveCardUp(deck, 10);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')).toHaveLength(1);
  });

  it('moveCardDown reorders to the following index and refuses at the bottom', async () => {
    const { platformRequest, vm } = track(await mountDecks());
    const deck = vm.discoveredDecks[0];
    vm.moveCardDown(deck, 10);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')[0][1]).toEqual({ cardId: 10, targetIndex: 1 });
    vm.moveCardDown(deck, 11);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')).toHaveLength(1);
  });
});

describe('DecksTab transfer dialog', () => {
  it('opens with a clean target and first position', async () => {
    const { vm } = track(await mountDecks());
    vm.transferDialogTargetDeckId = 99;
    vm.openTransferDialog(10, 2);
    expect(vm.transferDialogOpen).toBe(true);
    expect(vm.transferDialogTargetDeckId).toBeNull();
    expect(vm.transferDialogPosition).toBe('first');
  });

  it('offers every card container except the source', async () => {
    const { vm } = track(await mountDecks());
    vm.openTransferDialog(10, 2);
    await nextTick();
    const ids = vm.availableTargetContainers.map((c: any) => c.id);
    expect(ids).not.toContain(2);
    expect(ids).toContain(3);
  });

  it('sends nothing and stays open when no target is chosen', async () => {
    const { platformRequest, vm } = track(await mountDecks());
    vm.openTransferDialog(10, 2);
    await vm.confirmTransfer();
    expect(callsFor(platformRequest, 'debug:transfer-card')).toHaveLength(0);
    expect(vm.transferDialogOpen).toBe(true);
  });

  it('sends the transfer and closes once a target is chosen', async () => {
    const { platformRequest, vm } = track(await mountDecks());
    vm.openTransferDialog(10, 2);
    vm.transferDialogTargetDeckId = 3;
    vm.transferDialogPosition = 'last';
    await vm.confirmTransfer();
    expect(callsFor(platformRequest, 'debug:transfer-card')[0][1]).toEqual({
      cardId: 10,
      targetDeckId: 3,
      position: 'last',
    });
    expect(vm.transferDialogOpen).toBe(false);
  });
});

  it('discovers decks by $type or a Deck-ish class name, with their cards', async () => {
    const { vm } = track(await mountDecks());
    expect(vm.discoveredDecks.map((d: any) => d.id)).toEqual([2]);
    expect(vm.discoveredDecks[0].cards.map((c: any) => c.id)).toEqual([10, 11]);
  });

  it('discovers every container that holds card-like children', async () => {
    const { vm } = track(await mountDecks());
    const byId = Object.fromEntries(vm.discoveredCardContainers.map((c: any) => [c.id, c.cardCount]));
    expect(byId[2]).toBe(2);
    expect(byId[3]).toBe(1);
    expect(byId[1]).toBe(3);
  });

  it('matches decks whose cards match, and auto-expands those decks', async () => {
    const { vm } = track(await mountDecks());
    vm.deckSearchQuery = 'Ace';
    await nextTick();
    expect(vm.filteredDecks.map((d: any) => d.id)).toEqual([2]);
    expect(vm.isDeckExpanded(2)).toBe(true);
  });

  it('drops decks that match neither themselves nor any card', async () => {
    const { vm } = track(await mountDecks());
    vm.deckSearchQuery = 'nothing-here';
    await nextTick();
    expect(vm.filteredDecks).toEqual([]);
  });

  it('toggles deck expansion by hand', async () => {
    const { vm } = track(await mountDecks());
    expect(vm.isDeckExpanded(2)).toBe(false);
    vm.toggleDeck(2);
    await nextTick();
    expect(vm.isDeckExpanded(2)).toBe(true);
    vm.toggleDeck(2);
    await nextTick();
    expect(vm.isDeckExpanded(2)).toBe(false);
  });

  it('selects and deselects a card inside a deck', async () => {
    const { vm } = track(await mountDecks());
    vm.selectDeckCard(2, 10);
    await nextTick();
    expect((vm.selectedCard as { id: number }).id).toBe(10);
    vm.selectDeckCard(2, 10);
    await nextTick();
    expect(vm.selectedCard).toBeNull();
  });



describe('DecksTab derivations', () => {
  it('re-derives from the table the host sends for the position picked', async () => {
    const DISCARD = {
      id: 90,
      className: 'Board',
      children: [
        { id: 91, className: 'DiscardDeck', name: 'Discard', attributes: { $type: 'deck' }, children: [{ id: 92, className: 'Card' }] },
      ],
    };
    const handler: Op = async (op, payload) => (op === 'debug:deck-view-at'
      ? { success: true, view: payload.actionIndex === 1 ? DISCARD : VIEW }
      : { success: true, view: VIEW });
    const { wrapper, vm } = track(await mountDecks(handler, { historyIndex: 0 }));
    expect(vm.discoveredDecks.map((d: { id: number }) => d.id)).toEqual([2]);

    await wrapper.setProps({ historyIndex: 1 });
    await flushPromises();

    expect(vm.discoveredDecks.map((d: { id: number }) => d.id)).toEqual([91]);
  });
});

describe('DecksTab search and copy', () => {
  it('matches cards by name, notation, class and id, and never on an empty query', async () => {
    const { vm } = track(await mountDecks());
    const card = { id: 10, name: 'Ace', notation: 'AS', className: 'Card' };
    expect(vm.cardMatchesSearch(card, '')).toBe(false);
    expect(vm.cardMatchesSearch(card, 'ace')).toBe(true);
    expect(vm.cardMatchesSearch(card, 'as')).toBe(true);
    expect(vm.cardMatchesSearch(card, 'card')).toBe(true);
    expect(vm.cardMatchesSearch(card, '10')).toBe(true);
    expect(vm.cardMatchesSearch(card, 'zzz')).toBe(false);
  });
  it('copies a deck with its cards flattened into the payload', async () => {
    const copied: unknown[] = [];
    const platformRequest = vi.fn<Op>(answersWith(VIEW));
    const wrapper = mount(DecksTab, {
      props: { view: VIEW, copy: (value: unknown) => { copied.push(value); }, historyIndex: null },
      global: { provide: { [GAME_CONTEXT_KEYS.platformRequest as symbol]: platformRequest } },
    });
    track({ wrapper });
    await flushPromises();
    const vm = wrapper.vm as unknown as Vm;

    // The deck goes to the clipboard with its cards flattened in, so what is
    // pasted is the deck AND its contents rather than a deck full of refs.
    await vm.copyDeckToClipboard(vm.discoveredDecks[0]);
    const written = copied.at(-1) as { id: number; cards: Array<{ id: number }> };
    expect(written.id).toBe(2);
    expect(written.cards.map((c: any) => c.id)).toEqual([10, 11]);
  });
});

describe('DecksTab while viewing history (#899)', () => {
  it('turns off every edit and the transfer dialog, and says why', async () => {
    const { wrapper, vm } = track(await mountDecks());
    await wrapper.setProps({ historyIndex: 0 });
    vm.toggleDeck(2);
    vm.openTransferDialog(10, 2);
    await nextTick();

    const edits = wrapper.findAll('[aria-label="Shuffle deck"], .card-action-btn');
    expect(edits).toHaveLength(9);
    for (const edit of edits) expect(edit.attributes('disabled'), edit.attributes('aria-label')).toBeDefined();
    expect(wrapper.find('.deck-history-notice').text()).toMatch(/viewing history.*face-down cards included.*edits are off/i);
    expect(document.body.textContent).not.toContain('Transfer Card');
  });
});

describe('DecksTab unfiltered view (#898)', () => {
  it("lists a face-down deck's real cards from the host, not the seat's stand-ins, and says so", async () => {
    const { wrapper, vm, platformRequest } = track(await mountDecks(answersWith(VIEW), { view: SEAT_VIEW }));
    expect(callsFor(platformRequest, 'debug:deck-view')).toHaveLength(1);
    expect(vm.discoveredDecks[0].cards.map((c: { id: number }) => c.id)).toEqual([10, 11]);
    expect(wrapper.find('.deck-unfiltered-notice').text()).toMatch(/face-down cards included/i);
  });

  it('asks again on every new state, and shows the newest answer when an older one arrives late', async () => {
    const answers: Array<(table: unknown) => void> = [];
    const handler: Op = (op) => (op === 'debug:deck-view'
      ? new Promise((resolve) => answers.push((table) => resolve({ success: true, view: table })))
      : Promise.resolve({ success: true }));
    const { wrapper, vm } = track(await mountDecks(handler, { view: SEAT_VIEW }));
    await wrapper.setProps({ view: { ...SEAT_VIEW } });
    expect(answers).toHaveLength(2);

    answers[1]!({ id: 1, className: 'Board', children: [{ id: 5, className: 'Deck', attributes: { $type: 'deck' }, children: [] }] });
    await flushPromises();
    answers[0]!(VIEW);
    await flushPromises();
    expect(vm.discoveredDecks.map((d: { id: number }) => d.id)).toEqual([5]);
  });

  it('leaves the error empty when an older request fails after the newest succeeded', async () => {
    const answers: Array<{ resolve: (table: unknown) => void; reject: (err: Error) => void }> = [];
    const handler: Op = (op) => (op === 'debug:deck-view'
      ? new Promise((resolve, reject) => answers.push({ resolve: (table) => resolve({ success: true, view: table }), reject }))
      : Promise.resolve({ success: true }));
    const { wrapper } = track(await mountDecks(handler, { view: SEAT_VIEW }));
    await wrapper.setProps({ view: { ...SEAT_VIEW } });
    expect(answers).toHaveLength(2);

    answers[1]!.resolve(VIEW);
    await flushPromises();
    answers[0]!.reject(new Error('older failed'));
    await flushPromises();
    expect(wrapper.find('.deck-error').exists()).toBe(false);
  });

  it('shows why the host refused, rather than an empty list', async () => {
    const { wrapper } = track(await mountDecks(async () => ({ success: false, error: 'Debugging is not turned on' })));
    expect(wrapper.find('.deck-error').text()).toContain('Debugging is not turned on');
    expect(wrapper.find('.no-decks').exists()).toBe(false);
  });

  it("lists a face-down deck's real cards while viewing history, from the host's table at that position (#1071)", async () => {
    const { wrapper, vm, platformRequest } = track(await mountDecks(answersWith(VIEW), { view: SEAT_VIEW, historyIndex: 3 }));
    expect(callsFor(platformRequest, 'debug:deck-view')).toHaveLength(0);
    expect(callsFor(platformRequest, 'debug:deck-view-at')).toEqual([['debug:deck-view-at', { actionIndex: 3 }]]);
    expect(vm.discoveredDecks[0].cards.map((c: { id: number }) => c.id)).toEqual([10, 11]);
    expect(wrapper.find('.deck-history-notice').exists()).toBe(true);
  });

  it('shows why the host refused the past table, rather than an empty deck', async () => {
    const { wrapper } = track(await mountDecks(async () => ({ success: false, error: 'Debugging is not turned on' }), { view: SEAT_VIEW, historyIndex: 0 }));
    expect(wrapper.find('.deck-error').text()).toContain('Debugging is not turned on');
  });
});

describe('DecksTab after an edit (#898)', () => {
  it('asks for the table again, because an edit inside a face-down deck changes no seat view and so pushes nothing', async () => {
    const { platformRequest, vm } = track(await mountDecks());
    expect(callsFor(platformRequest, 'debug:deck-view')).toHaveLength(1);
    await vm.moveCardToTop(11);
    await flushPromises();
    expect(callsFor(platformRequest, 'debug:deck-view')).toHaveLength(2);
  });

  it('does not ask again after a refused edit, which changed nothing', async () => {
    const handler: Op = async (op) => (op === 'debug:deck-view' ? { success: true, view: VIEW } : { success: false, error: 'no' });
    const { platformRequest, vm } = track(await mountDecks(handler));
    await vm.moveCardToTop(11);
    await flushPromises();
    expect(callsFor(platformRequest, 'debug:deck-view')).toHaveLength(1);
  });
});
