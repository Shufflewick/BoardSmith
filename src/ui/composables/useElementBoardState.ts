/**
 * useElementBoardState — an AutoUI renderer's board state for one element.
 *
 * Every element renderer reads identity, highlighted, selected, selectable,
 * disabled and drag state through this one composable, so the renderers cannot
 * drift apart: when each kept its own copy, they disagreed about the
 * draggable-selected element and Card announced selection from sets nothing
 * filled (#1052, #894).
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
  const isActionSelectable = computed(
    () => !!boardInteraction && !isSelected.value && boardInteraction.isSelectableElement(identity()),
  );
  // The auto-filled first pick of a later choice: only a renderer that can drag it on may offer it.
  const isDraggableSelected = computed(
    () => !!boardInteraction && !isSelected.value && boardInteraction.isDraggableSelectedElement(identity()),
  );
  const isDisabled = computed(() => !!boardInteraction && boardInteraction.isDisabledElement(identity()) !== false);
  const isDropTarget = computed(() => boardInteraction?.isDropTarget(identity()) ?? false);
  const isDragged = computed(() => boardInteraction?.isDraggedElement(identity()) ?? false);

  return {
    boardInteraction,
    identity,
    isHighlighted,
    isSelected,
    isActionSelectable,
    isDraggableSelected,
    isDisabled,
    isDropTarget,
    isDragged,
  };
}
