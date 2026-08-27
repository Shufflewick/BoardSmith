/**
 * The debug panel's deck editing controls (#41).
 *
 * Moving, reordering, transferring and shuffling cards, plus the transfer
 * dialog that picks a destination. All four edits are the same shape — send an
 * op, say something useful if it is refused — and inside `DebugPanel.vue` they
 * shared their loading and error refs with everything else in the file.
 *
 * The bridge and the list of possible destinations are passed in, so a test
 * supplies a stub bridge and a plain array.
 *
 * @module
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { DebugBridge, TransferPosition } from './useDebugBridge.js';
import type { CardContainerInfo, DeckInfo } from '../components/debug/debug-view-tree.js';

export interface DeckWorkbenchOptions {
  /** How the panel talks to the running game. */
  bridge: DebugBridge;
  /** Everything a card could be transferred into, including the source. */
  cardContainers: ComputedRef<CardContainerInfo[]> | Ref<CardContainerInfo[]>;
}

export interface DeckWorkbench {
  /** True while any edit is in flight. */
  deckManipulationLoading: Ref<boolean>;
  /** Why the last edit was refused, or `null` if it was not. */
  deckManipulationError: Ref<string | null>;

  moveCardToTop: (cardId: number) => Promise<void>;
  reorderCard: (cardId: number, targetIndex: number) => Promise<void>;
  transferCard: (cardId: number, targetDeckId: number, position?: TransferPosition) => Promise<void>;
  shuffleDeck: (deckId: number) => Promise<void>;
  /** Move a card one place towards the top. Does nothing at the top. */
  moveCardUp: (deck: DeckInfo, cardId: number) => void;
  /** Move a card one place towards the bottom. Does nothing at the bottom. */
  moveCardDown: (deck: DeckInfo, cardId: number) => void;

  transferDialogOpen: Ref<boolean>;
  transferDialogCardId: Ref<number | null>;
  transferDialogSourceDeckId: Ref<number | null>;
  transferDialogTargetDeckId: Ref<number | null>;
  transferDialogPosition: Ref<TransferPosition>;
  /** Every container the card could go to — the source is never offered. */
  availableTargetContainers: ComputedRef<CardContainerInfo[]>;
  openTransferDialog: (cardId: number, sourceDeckId: number) => void;
  closeTransferDialog: () => void;
  /** Send the transfer. Does nothing until a destination is chosen. */
  confirmTransfer: () => Promise<void>;
}

export function useDeckWorkbench(options: DeckWorkbenchOptions): DeckWorkbench {
  const { bridge, cardContainers } = options;

  const deckManipulationLoading = ref(false);
  const deckManipulationError = ref<string | null>(null);

  /**
   * Run one edit. The host broadcasts the new state, so the view updates
   * without a local refresh — there is nothing to re-fetch here.
   */
  async function runEdit(edit: () => Promise<void>): Promise<void> {
    deckManipulationLoading.value = true;
    deckManipulationError.value = null;
    try {
      await edit();
    } catch (err) {
      deckManipulationError.value = err instanceof Error ? err.message : 'Debug request failed';
    } finally {
      deckManipulationLoading.value = false;
    }
  }

  const moveCardToTop = (cardId: number) => runEdit(() => bridge.moveCardToTop(cardId));
  const reorderCard = (cardId: number, targetIndex: number) =>
    runEdit(() => bridge.reorderCard(cardId, targetIndex));
  const transferCard = (cardId: number, targetDeckId: number, position: TransferPosition = 'first') =>
    runEdit(() => bridge.transferCard(cardId, targetDeckId, position));
  const shuffleDeck = (deckId: number) => runEdit(() => bridge.shuffleDeck(deckId));

  function moveCardUp(deck: DeckInfo, cardId: number): void {
    const currentIndex = deck.cards.findIndex(c => c.id === cardId);
    if (currentIndex > 0) void reorderCard(cardId, currentIndex - 1);
  }

  function moveCardDown(deck: DeckInfo, cardId: number): void {
    const currentIndex = deck.cards.findIndex(c => c.id === cardId);
    if (currentIndex > -1 && currentIndex < deck.cards.length - 1) {
      void reorderCard(cardId, currentIndex + 1);
    }
  }

  const transferDialogOpen = ref(false);
  const transferDialogCardId = ref<number | null>(null);
  const transferDialogSourceDeckId = ref<number | null>(null);
  const transferDialogTargetDeckId = ref<number | null>(null);
  const transferDialogPosition = ref<TransferPosition>('first');

  function openTransferDialog(cardId: number, sourceDeckId: number): void {
    transferDialogCardId.value = cardId;
    transferDialogSourceDeckId.value = sourceDeckId;
    transferDialogTargetDeckId.value = null;
    transferDialogPosition.value = 'first';
    transferDialogOpen.value = true;
  }

  function closeTransferDialog(): void {
    transferDialogOpen.value = false;
    transferDialogCardId.value = null;
    transferDialogSourceDeckId.value = null;
  }

  const availableTargetContainers = computed(() => {
    if (transferDialogSourceDeckId.value === null) return [];
    return cardContainers.value.filter(c => c.id !== transferDialogSourceDeckId.value);
  });

  async function confirmTransfer(): Promise<void> {
    if (transferDialogCardId.value === null || transferDialogTargetDeckId.value === null) return;
    await transferCard(
      transferDialogCardId.value,
      transferDialogTargetDeckId.value,
      transferDialogPosition.value,
    );
    closeTransferDialog();
  }

  return {
    deckManipulationLoading,
    deckManipulationError,
    moveCardToTop,
    reorderCard,
    transferCard,
    shuffleDeck,
    moveCardUp,
    moveCardDown,
    transferDialogOpen,
    transferDialogCardId,
    transferDialogSourceDeckId,
    transferDialogTargetDeckId,
    transferDialogPosition,
    availableTargetContainers,
    openTransferDialog,
    closeTransferDialog,
    confirmTransfer,
  };
}
