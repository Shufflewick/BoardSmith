/**
 * useDragDrop - Composable for drag-and-drop in custom UIs
 *
 * Call once at setup, returns functions that work with any element.
 * ActionPanel's existing watch on isDragging handles orchestration automatically.
 *
 * ## Quick Start (Pit of Success API)
 *
 * ```vue
 * <script setup>
 * import { useDragDrop } from '@boardsmith/ui';
 * import '@boardsmith/ui/animation/drag-drop.css';
 *
 * const { drag, drop } = useDragDrop();
 * const canDrag = (id) => currentAction.value === 'move' && isSelectable(id);
 * </script>
 *
 * <template>
 *   <div v-for="card in cards"
 *        v-bind="drag({ id: card.id }, { when: canDrag(card.id) }).props"
 *        :class="drag({ id: card.id }, { when: canDrag(card.id) }).classes">
 *     {{ card.name }}
 *   </div>
 *   <div v-for="zone in zones"
 *        v-bind="drop({ name: zone.id }).props"
 *        :class="drop({ name: zone.id }).classes">
 *     {{ zone.name }}
 *   </div>
 * </template>
 * ```
 *
 * ## Lifecycle Callbacks
 *
 * ```vue
 * drag({ id: card.id }, {
 *   when: canDrag(card.id),
 *   onDragStart: () => console.log('Started dragging'),
 *   onDragEnd: () => console.log('Finished dragging')
 * })
 * ```
 *
 * ## Hover Detection
 *
 * Use `isOver(ref)` or the `bs-drop-hover` CSS class to detect when a dragged
 * element is hovering over a specific drop target:
 *
 * ```vue
 * const { drop, isOver } = useDragDrop();
 *
 * // Via CSS class (automatic with drop().classes)
 * <div :class="drop({ name: 'zone' }).classes">  <!-- includes bs-drop-hover -->
 *
 * // Via function (for custom logic)
 * <div :class="{ 'my-hover-class': isOver({ name: 'zone' }) }">
 * ```
 *
 * ## CSS Classes
 *
 * - `.bs-draggable` - Element can be dragged (when condition passes)
 * - `.bs-dragging` - Element is currently being dragged
 * - `.bs-drop-target` - Element is a valid drop target for current drag
 * - `.bs-drop-hover` - A dragged element is hovering over this drop target
 *
 * ## Full API (for advanced use)
 *
 * ```vue
 * const { dragProps, dropProps, isDragging, isDropTarget, isOver } = useDragDrop();
 *
 * <div v-bind="dragProps({ id: card.id })"
 *      :class="{ 'is-dragging': isDragging({ id: card.id }) }">
 * ```
 */
import { useBoardInteraction, type ElementRef } from './useBoardInteraction.js';

export interface DragProps {
  draggable: true;
  onDragstart: (e: DragEvent) => void;
  onDragend: () => void;
}

export interface DropProps {
  onDragover: (e: DragEvent) => void;
  onDragenter: (e: DragEvent) => void;
  onDragleave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * Options for drag binding.
 */
export interface DragOptions {
  /** Condition for enabling drag. Can be a boolean or a function returning boolean. */
  when?: boolean | (() => boolean);
  /** Called when drag starts */
  onDragStart?: () => void;
  /** Called when drag ends (regardless of drop success) */
  onDragEnd?: () => void;
}

/**
 * @deprecated Use DragOptions instead
 */
export type DragDropCondition = DragOptions;

/**
 * CSS classes for draggable elements.
 * Apply with :class="drag(...).classes" or :class="dragClasses(...)"
 */
export interface DragClasses {
  /** True when element can be dragged (condition passes) */
  'bs-draggable': boolean;
  /** True when element is currently being dragged */
  'bs-dragging': boolean;
}

/**
 * CSS classes for drop target elements.
 * Apply with :class="drop(...).classes" or :class="dropClasses(...)"
 */
export interface DropClasses {
  /** True when element is a valid drop target for the current drag */
  'bs-drop-target': boolean;
  /** True when a dragged element is hovering over this drop target */
  'bs-drop-hover': boolean;
}

/**
 * Combined result from drag() helper - includes props and classes.
 */
export interface DragResult {
  /** Props to spread onto the element (empty object if condition is false) */
  props: DragProps | Record<string, never>;
  /** Classes to apply to the element */
  classes: DragClasses;
}

/**
 * Combined result from drop() helper - includes props and classes.
 */
export interface DropResult {
  /** Props to spread onto the element */
  props: DropProps;
  /** Classes to apply to the element */
  classes: DropClasses;
}

export interface UseDragDropReturn {
  /** Returns props to make an element draggable */
  dragProps: (ref: ElementRef, options?: DragOptions) => DragProps;
  /** Returns props to make an element a drop target */
  dropProps: (ref: ElementRef) => DropProps;
  /** Check if an element is currently being dragged */
  isDragging: (ref: ElementRef) => boolean;
  /** Check if an element is a valid drop target */
  isDropTarget: (ref: ElementRef) => boolean;
  /** Check if a dragged element is hovering over this drop target */
  isOver: (ref: ElementRef) => boolean;
  /**
   * PIT OF SUCCESS: Combined props + classes for draggable elements.
   * Returns props (conditional) and CSS classes in one call.
   * @example
   * <div v-bind="drag({ id: card.id }, { when: canDrag }).props"
   *      :class="drag({ id: card.id }, { when: canDrag }).classes">
   */
  drag: (ref: ElementRef, options?: DragOptions) => DragResult;
  /**
   * PIT OF SUCCESS: Combined props + classes for drop targets.
   * Returns props and CSS classes in one call.
   * @example
   * <div v-bind="drop({ name: 'zone' }).props"
   *      :class="drop({ name: 'zone' }).classes">
   */
  drop: (ref: ElementRef) => DropResult;
  /** Returns just the CSS classes for draggable elements */
  dragClasses: (ref: ElementRef, options?: DragOptions) => DragClasses;
  /** Returns just the CSS classes for drop targets */
  dropClasses: (ref: ElementRef) => DropClasses;
}

export function useDragDrop(): UseDragDropReturn {
  const boardInteraction = useBoardInteraction();

  const dragProps = (ref: ElementRef, options?: DragOptions): DragProps => ({
    draggable: true,
    onDragstart: (e: DragEvent) => {
      if (!boardInteraction) return;
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();

      // Check if element has a CSS transform (e.g., translateY from hover state)
      // Transforms cause the drag ghost to be clipped, so we create a clone without it
      const style = window.getComputedStyle(target);
      const transform = style.transform;

      if (transform && transform !== 'none') {
        // Create a clone without the transform for a clean drag image
        const clone = target.cloneNode(true) as HTMLElement;
        clone.style.transform = 'none';
        clone.style.position = 'absolute';
        clone.style.top = '-9999px';
        clone.style.left = '-9999px';
        document.body.appendChild(clone);

        // Use clone for drag image with correct cursor offset
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        e.dataTransfer?.setDragImage(clone, x, y);

        // Clean up clone after browser captures it
        requestAnimationFrame(() => {
          document.body.removeChild(clone);
        });
      } else {
        // No transform - use the element directly
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        e.dataTransfer?.setDragImage(target, x, y);
      }

      e.dataTransfer?.setData('boardsmith/element', JSON.stringify(ref));
      e.dataTransfer!.effectAllowed = 'move';
      boardInteraction.startDrag(ref);
      options?.onDragStart?.();
    },
    onDragend: () => {
      options?.onDragEnd?.();
      if (boardInteraction?.isDragging) {
        boardInteraction.endDrag();
      }
    },
  });

  const dropProps = (ref: ElementRef): DropProps => ({
    onDragover: (e: DragEvent) => {
      if (!boardInteraction?.isDragging) return;
      if (!boardInteraction.isDropTarget(ref)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
    },
    onDragenter: (e: DragEvent) => {
      if (!boardInteraction?.isDragging) return;
      if (!boardInteraction.isDropTarget(ref)) return;
      e.preventDefault();
      boardInteraction.setHoveredDropTarget(ref);
    },
    onDragleave: (e: DragEvent) => {
      if (!boardInteraction?.isDragging) return;
      // Only clear hover if we're actually leaving this element (not entering a child)
      const relatedTarget = e.relatedTarget as Node | null;
      const currentTarget = e.currentTarget as HTMLElement;
      if (relatedTarget && currentTarget.contains(relatedTarget)) return;
      // Only clear if this element is the currently hovered one
      if (boardInteraction.isHoveredDropTarget(ref)) {
        boardInteraction.setHoveredDropTarget(null);
      }
    },
    onDrop: (e: DragEvent) => {
      if (!boardInteraction?.isDragging) return;
      e.preventDefault();
      boardInteraction.triggerDrop(ref);
    },
  });

  const isDragging = (ref: ElementRef): boolean => {
    if (!boardInteraction) return false;
    return boardInteraction.isDraggedElement(ref);
  };

  const isDropTarget = (ref: ElementRef): boolean => {
    if (!boardInteraction) return false;
    return boardInteraction.isDropTarget(ref);
  };

  const isOver = (ref: ElementRef): boolean => {
    if (!boardInteraction) return false;
    return boardInteraction.isHoveredDropTarget(ref);
  };

  // ============================================
  // PIT OF SUCCESS HELPERS
  // ============================================

  /**
   * Evaluate a condition - handles both boolean and function forms.
   */
  const evalCondition = (options?: DragOptions): boolean => {
    if (options?.when === undefined) return true;
    return typeof options.when === 'function' ? options.when() : options.when;
  };

  /**
   * Get CSS classes for a draggable element.
   */
  const dragClasses = (ref: ElementRef, options?: DragOptions): DragClasses => ({
    'bs-draggable': evalCondition(options),
    'bs-dragging': isDragging(ref),
  });

  /**
   * Get CSS classes for a drop target element.
   */
  const dropClasses = (ref: ElementRef): DropClasses => ({
    'bs-drop-target': isDropTarget(ref),
    'bs-drop-hover': isOver(ref),
  });

  /**
   * Combined helper for draggable elements - returns props and classes.
   * Props are conditional (empty object if condition is false).
   */
  const drag = (ref: ElementRef, options?: DragOptions): DragResult => ({
    props: evalCondition(options) ? dragProps(ref, options) : {},
    classes: dragClasses(ref, options),
  });

  /**
   * Combined helper for drop targets - returns props and classes.
   */
  const drop = (ref: ElementRef): DropResult => ({
    props: dropProps(ref),
    classes: dropClasses(ref),
  });

  return {
    // Original API
    dragProps,
    dropProps,
    isDragging,
    isDropTarget,
    isOver,
    // Pit of Success API
    drag,
    drop,
    dragClasses,
    dropClasses,
  };
}
