import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useDeckWorkbench } from './useDeckWorkbench.js';
import type { DebugBridge } from './useDebugBridge.js';
import type { CardContainerInfo, DeckInfo } from '../components/debug/debug-view-tree.js';

const CONTAINERS: CardContainerInfo[] = [
  { id: 2, name: 'Draw', className: 'Deck', cardCount: 2 },
  { id: 3, name: 'My Hand', className: 'Hand', cardCount: 1 },
  { id: 4, name: 'Discard', className: 'Deck', cardCount: 0 },
];

const DECK: DeckInfo = {
  id: 2,
  name: 'Draw',
  className: 'Deck',
  fullObject: {},
  cards: [
    { id: 10, name: 'Ace', className: 'Card', fullObject: {} },
    { id: 11, name: 'King', className: 'Card', fullObject: {} },
    { id: 12, name: 'Queen', className: 'Card', fullObject: {} },
  ],
};

function stubBridge(over: Partial<DebugBridge> = {}): DebugBridge {
  return {
    actionTraces: vi.fn(async () => ({ traces: [], flowContext: null })),
    flowState: vi.fn(async () => null),
    history: vi.fn(async () => []),
    logs: vi.fn(async () => []),
    stateAt: vi.fn(async () => null),
    stateDiff: vi.fn(async () => null),
    rewind: vi.fn(async () => {}),
    moveCardToTop: vi.fn(async () => {}),
    reorderCard: vi.fn(async () => {}),
    transferCard: vi.fn(async () => {}),
    shuffleDeck: vi.fn(async () => {}),
    ...over,
  };
}

function setup(over: Partial<DebugBridge> = {}) {
  const bridge = stubBridge(over);
  const cardContainers = ref(CONTAINERS);
  return { bridge, cardContainers, workbench: useDeckWorkbench({ bridge, cardContainers }) };
}

describe('deck edits', () => {
  it('each edit reaches its own op', async () => {
    const { bridge, workbench } = setup();
    await workbench.moveCardToTop(10);
    await workbench.reorderCard(10, 2);
    await workbench.transferCard(10, 3, 'last');
    await workbench.shuffleDeck(2);
    expect(bridge.moveCardToTop).toHaveBeenCalledWith(10);
    expect(bridge.reorderCard).toHaveBeenCalledWith(10, 2);
    expect(bridge.transferCard).toHaveBeenCalledWith(10, 3, 'last');
    expect(bridge.shuffleDeck).toHaveBeenCalledWith(2);
  });

  it('a transfer with no stated end goes to the front', async () => {
    const { bridge, workbench } = setup();
    await workbench.transferCard(10, 3);
    expect(bridge.transferCard).toHaveBeenCalledWith(10, 3, 'first');
  });

  it('surfaces the failure the op described', async () => {
    const { workbench } = setup({
      shuffleDeck: vi.fn(async () => { throw new Error('Failed to shuffle deck'); }),
    });
    await workbench.shuffleDeck(2);
    expect(workbench.deckManipulationError.value).toBe('Failed to shuffle deck');
    expect(workbench.deckManipulationLoading.value).toBe(false);
  });

  it('describes a non-Error rejection rather than showing "undefined"', async () => {
    const { workbench } = setup({ shuffleDeck: vi.fn(async () => { throw 'nope'; }) });
    await workbench.shuffleDeck(2);
    expect(workbench.deckManipulationError.value).toBe('Debug request failed');
  });

  it('clears a previous failure when a later edit succeeds', async () => {
    let fail = true;
    const { workbench } = setup({
      shuffleDeck: vi.fn(async () => { if (fail) throw new Error('busy'); }),
    });
    await workbench.shuffleDeck(2);
    expect(workbench.deckManipulationError.value).toBe('busy');
    fail = false;
    await workbench.shuffleDeck(2);
    expect(workbench.deckManipulationError.value).toBeNull();
  });

  it('reports that an edit is in flight', async () => {
    let release: () => void = () => {};
    const { workbench } = setup({
      shuffleDeck: vi.fn(() => new Promise<void>((r) => { release = r; })),
    });
    const pending = workbench.shuffleDeck(2);
    expect(workbench.deckManipulationLoading.value).toBe(true);
    release();
    await pending;
    expect(workbench.deckManipulationLoading.value).toBe(false);
  });
});

describe('nudging a card within its deck', () => {
  it('moves a card one place towards the top', async () => {
    const { bridge, workbench } = setup();
    workbench.moveCardUp(DECK, 11);
    await nextTick();
    expect(bridge.reorderCard).toHaveBeenCalledWith(11, 0);
  });

  it('refuses to move the top card up', async () => {
    const { bridge, workbench } = setup();
    workbench.moveCardUp(DECK, 10);
    await nextTick();
    expect(bridge.reorderCard).not.toHaveBeenCalled();
  });

  it('moves a card one place towards the bottom', async () => {
    const { bridge, workbench } = setup();
    workbench.moveCardDown(DECK, 10);
    await nextTick();
    expect(bridge.reorderCard).toHaveBeenCalledWith(10, 1);
  });

  it('refuses to move the bottom card down', async () => {
    const { bridge, workbench } = setup();
    workbench.moveCardDown(DECK, 12);
    await nextTick();
    expect(bridge.reorderCard).not.toHaveBeenCalled();
  });

  it('does nothing for a card that is not in the deck', async () => {
    const { bridge, workbench } = setup();
    workbench.moveCardUp(DECK, 999);
    workbench.moveCardDown(DECK, 999);
    await nextTick();
    expect(bridge.reorderCard).not.toHaveBeenCalled();
  });
});

describe('the transfer dialog', () => {
  it('opens on a card with a clean destination and the front position', async () => {
    const { workbench } = setup();
    workbench.transferDialogTargetDeckId.value = 99;
    workbench.transferDialogPosition.value = 'last';
    workbench.openTransferDialog(10, 2);
    expect(workbench.transferDialogOpen.value).toBe(true);
    expect(workbench.transferDialogCardId.value).toBe(10);
    expect(workbench.transferDialogSourceDeckId.value).toBe(2);
    expect(workbench.transferDialogTargetDeckId.value).toBeNull();
    expect(workbench.transferDialogPosition.value).toBe('first');
  });

  it('offers nothing until a source is known', async () => {
    const { workbench } = setup();
    expect(workbench.availableTargetContainers.value).toEqual([]);
  });

  it('never offers the container the card is already in', async () => {
    const { workbench } = setup();
    workbench.openTransferDialog(10, 2);
    await nextTick();
    expect(workbench.availableTargetContainers.value.map(c => c.id)).toEqual([3, 4]);
  });

  it('offers hands and discard piles, not only decks', async () => {
    const { workbench } = setup();
    workbench.openTransferDialog(10, 2);
    await nextTick();
    expect(workbench.availableTargetContainers.value.map(c => c.className)).toContain('Hand');
  });

  it('follows the containers as the game state changes', async () => {
    const { cardContainers, workbench } = setup();
    workbench.openTransferDialog(10, 2);
    await nextTick();
    cardContainers.value = [...CONTAINERS, { id: 5, name: 'Box', className: 'Box', cardCount: 1 }];
    await nextTick();
    expect(workbench.availableTargetContainers.value.map(c => c.id)).toEqual([3, 4, 5]);
  });

  it('sends nothing and stays open until a destination is chosen', async () => {
    const { bridge, workbench } = setup();
    workbench.openTransferDialog(10, 2);
    await workbench.confirmTransfer();
    expect(bridge.transferCard).not.toHaveBeenCalled();
    expect(workbench.transferDialogOpen.value).toBe(true);
  });

  it('sends the transfer and closes once a destination is chosen', async () => {
    const { bridge, workbench } = setup();
    workbench.openTransferDialog(10, 2);
    workbench.transferDialogTargetDeckId.value = 3;
    workbench.transferDialogPosition.value = 'last';
    await workbench.confirmTransfer();
    expect(bridge.transferCard).toHaveBeenCalledWith(10, 3, 'last');
    expect(workbench.transferDialogOpen.value).toBe(false);
    expect(workbench.transferDialogCardId.value).toBeNull();
    expect(workbench.transferDialogSourceDeckId.value).toBeNull();
  });

  it('closes on a refused transfer too, leaving the failure on screen', async () => {
    const { workbench } = setup({
      transferCard: vi.fn(async () => { throw new Error('card is face down'); }),
    });
    workbench.openTransferDialog(10, 2);
    workbench.transferDialogTargetDeckId.value = 3;
    await workbench.confirmTransfer();
    expect(workbench.transferDialogOpen.value).toBe(false);
    expect(workbench.deckManipulationError.value).toBe('card is face down');
  });

  it('closing by hand abandons the card without sending anything', async () => {
    const { bridge, workbench } = setup();
    workbench.openTransferDialog(10, 2);
    workbench.closeTransferDialog();
    expect(workbench.transferDialogOpen.value).toBe(false);
    expect(workbench.transferDialogCardId.value).toBeNull();
    expect(bridge.transferCard).not.toHaveBeenCalled();
  });
});
