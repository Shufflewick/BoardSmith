/**
 * useHoverHighlight - Composable for element hover highlighting
 *
 * Provides a consistent pattern for highlighting board elements when
 * hovering over UI controls (buttons, choices, etc.).
 *
 * Integrates with useBoardInteraction to trigger visual highlighting
 * on the game board.
 *
 * @example
 * ```typescript
 * import { useHoverHighlight } from 'boardsmith/ui';
 * import { useBoardInteraction } from 'boardsmith/ui';
 *
 * const boardInteraction = useBoardInteraction();
 * const { handleHover, handleLeave, highlightedRef } = useHoverHighlight(boardInteraction);
 *
 * // In template:
 * // <button
 * //   @mouseenter="handleHover({ id: element.id, ref: element.ref })"
 * //   @mouseleave="handleLeave"
 * // >
 * ```
 */

import { ref, type Ref } from 'vue';
import type { BoardInteraction, ElementRef } from './useBoardInteraction.js';

/**
 * Item that can be hovered to trigger highlighting.
 */
export interface HoverableItem {
  /** Element ID (for identifying what's highlighted) */
  id: number | string;
  /** Display text */
  display?: string;
  /** Element reference for board highlighting */
  ref?: ElementRef;
  /** Source element reference (for move origin) */
  sourceRef?: ElementRef;
  /** Target element reference (for move destination) */
  targetRef?: ElementRef;
}

/**
 * Options for useHoverHighlight composable.
 */
export interface UseHoverHighlightOptions {
  /** Board interaction instance (optional - if not provided, highlighting is disabled) */
  boardInteraction?: BoardInteraction | null;
}

/**
 * Return type for useHoverHighlight composable.
 */
export interface UseHoverHighlightReturn {
  /**
   * Handle hover enter on an item.
   * Sets the item as the currently hovered choice for board highlighting.
   */
  handleHover: (item: HoverableItem) => void;

  /**
   * Handle hover leave.
   * Clears the currently hovered choice.
   */
  handleLeave: () => void;

  /**
   * Currently highlighted item reference (reactive).
   * Null when nothing is highlighted.
   */
  highlightedRef: Ref<ElementRef | null>;

  /**
   * Currently highlighted item ID (reactive).
   * Null when nothing is highlighted.
   */
  highlightedId: Ref<number | string | null>;
}

/**
 * Composable for element hover highlighting.
 *
 * @param options - Configuration options
 * @returns Hover highlight controls
 */
export function useHoverHighlight(
  options: UseHoverHighlightOptions | BoardInteraction | null = null
): UseHoverHighlightReturn {
  // Accept both options object and direct BoardInteraction
  const boardInteraction: BoardInteraction | null =
    options && 'setHoveredChoice' in options
      ? options
      : (options as UseHoverHighlightOptions | null)?.boardInteraction ?? null;

  const highlightedRef = ref<ElementRef | null>(null);
  const highlightedId = ref<number | string | null>(null);

  /**
   * Handle hover enter on an item
   */
  function handleHover(item: HoverableItem): void {
    // Track locally for components that don't use board interaction
    highlightedId.value = item.id;
    highlightedRef.value = item.ref ?? item.sourceRef ?? null;

    // If we have board interaction, also set the hovered choice there
    if (boardInteraction) {
      const sourceRefs: ElementRef[] = [];
      const targetRefs: ElementRef[] = [];

      if (item.ref) sourceRefs.push(item.ref);
      if (item.sourceRef) sourceRefs.push(item.sourceRef);
      if (item.targetRef) targetRefs.push(item.targetRef);

      boardInteraction.setHoveredChoice({
        value: item.id,
        display: item.display || String(item.id),
        sourceRefs,
        targetRefs,
      });
    }
  }

  /**
   * Handle hover leave
   */
  function handleLeave(): void {
    highlightedId.value = null;
    highlightedRef.value = null;

    if (boardInteraction) {
      boardInteraction.setHoveredChoice(null);
    }
  }

  return {
    handleHover,
    handleLeave,
    highlightedRef,
    highlightedId,
  };
}
