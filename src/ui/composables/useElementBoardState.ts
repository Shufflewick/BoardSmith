/**
 * useElementBoardState — an AutoUI renderer's board state for one element.
 *
 * Every element renderer reads identity, highlighted, selected, selectable and
 * disabled through this one composable, so the renderers cannot drift apart:
 * when each kept its own copy, Hand, Piece and Deck missed the draggable-selected
 * element and Card announced selection from sets nothing filled (#1052, #894).
 */
import { computed } from 'vue';
import { tryUseBoardInteraction } from './useBoardInteraction.js';

/** The fields of an element the board identifies it by. */
interface BoardElement {
  id: number;
  name?: string;
  attributes?: Record<string, unknown>;
}

export function useElementBoardState(element: () => BoardElement) {
  const boardInteraction = tryUseBoardInteraction();

  function identity() {
    const el = element();
    return { id: el.id, name: el.name, notation: el.attributes?.notation as string | undefined };
  }

  const isHighlighted = computed(() => boardInteraction?.isHighlighted(identity()) ?? false);
  const isSelected = computed(() => boardInteraction?.isSelected(identity()) ?? false);
  // An auto-filled first pick stays selectable so the player can drag it on.
  const isActionSelectable = computed(() => {
    if (!boardInteraction || isSelected.value) return false;
    return boardInteraction.isSelectableElement(identity())
      || boardInteraction.isDraggableSelectedElement(identity());
  });
  const isDisabled = computed(() => !!boardInteraction && boardInteraction.isDisabledElement(identity()) !== false);

  return { boardInteraction, identity, isHighlighted, isSelected, isActionSelectable, isDisabled };
}
