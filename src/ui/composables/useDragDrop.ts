/**
 * useDragDrop - Composable for drag-and-drop in custom UIs
 *
 * Call once at setup, returns functions that work with any element.
 *
 * Drag is pointer-event drag (#1605), so it works by mouse, pen and touch, and
 * `drag()` and `drop()` also carry a click handler that chooses the element, so
 * a board wired only with them plays by tap too. Spread `props` and nothing
 * else for the click: a second click handler on the same element chooses twice.
 *
 * Drop targets are wired automatically: GameShell sets up a single shared
 * drag-drop orchestration (see {@link ./useDragDropTargets}) that watches
 * `isDragging` and derives drop targets generically from the action controller's
 * CURRENT pick — for ANY action shape, and identically for the Action Panel and
 * custom UIs (which both read targets through `useBoardInteraction`). You only
 * mark what is draggable (`drag`) and what can receive a drop (`drop`); the
 * orchestration decides which drops are valid based on the in-progress action.
 *
 * Supported action shapes (a drag completes an action by dropping onto a board
 * target):
 *   - element -> element            (drag piece, drop onto a valid target element)
 *   - element -> elements           (drop onto any valid element of a multi-pick)
 *   - element -> choice WITH filterBy    (destinations narrowed by the dragged piece)
 *   - element -> choice WITHOUT filterBy (any choice with board refs)
 * For choice destinations, each choice's `boardRefs` must name an element (role
 * 'target', else its first ref) so the board knows where the choice is dropped.
 *
 * ## Quick Start (Pit of Success API)
 *
 * ```vue
 * <script setup>
 * import { useBoardInteraction, useDragDrop } from 'boardsmith/ui';
 * import 'boardsmith/ui/animation/drag-drop.css';
 *
 * const { drag, drop } = useDragDrop();
 * const board = useBoardInteraction();
 * // Not the open action's name: with none open, a drag can start an action.
 * const canDrag = (id) => board.isSelectableElement({ id }) || board.isDraggableSelectedElement({ id });
 * </script>
 *
 * <template>
 *   <div v-for="card in cards"
 *        v-bind="drag({ id: card.id }, { when: canDrag(card.id) }).props"
 *        :class="drag({ id: card.id }, { when: canDrag(card.id) }).classes">
 *     {{ card.name }}
 *   </div>
 *   <div v-for="zone in zones"
 *        v-bind="drop({ id: zone.id }).props"
 *        :class="drop({ id: zone.id }).classes">
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
 * <div :class="drop({ id: zone.id }).classes">  <!-- includes bs-drop-hover -->
 *
 * // Via function (for custom logic)
 * <div :class="{ 'my-hover-class': isOver({ id: zone.id }) }">
 * ```
 *
 * ## CSS Classes
 *
 * - `.bs-draggable` - Element can be dragged (`when` passes and it is not a disabled candidate)
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
import { anchorAttrs, tryUseBoardInteraction, type ElementRef } from './useBoardInteraction.js';
import { startPointerDrag } from './pointerDrag.js';
import { devWarn } from '../../utils/dev.js';
import { syncReducedMotionClass } from './reducedMotion.js';

/**
 * Warn (once) when a drag/drop handler fires with no `<GameShell>` provider.
 *
 * `useDragDrop` degrades gracefully (handlers no-op) rather than throwing at
 * setup like {@link useBoardInteraction}, so a board rendered outside a
 * provider would otherwise get silently dead drag-and-drop. This surfaces the
 * cause in dev instead.
 */
const warnNoProvider = (): void =>
  devWarn(
    'useDragDrop-no-provider',
    'useDragDrop() drag-and-drop is inactive because there is no <GameShell> ' +
      'board-interaction provider. Render this component inside <GameShell> ' +
      '(or use tryUseBoardInteraction() directly if drag-and-drop is optional here).'
  );

/**
 * What `drag()` spreads onto a draggable element. `onClick` chooses it, the tap
 * path, and is always there; `onPointerdown` and the style that keeps the browser
 * from scrolling under a finger are there only while the element may drag.
 */
export interface DragProps {
  onClick: (e: MouseEvent) => void;
  onPointerdown?: (e: PointerEvent) => void;
  style?: { touchAction: 'none'; userSelect: 'none' };
}

/**
 * What `drop()` spreads onto a drop target: its anchor attributes, which the
 * drag hit-tests to find the target under the pointer, and a click that chooses
 * it, the tap path.
 */
export interface DropProps {
  onClick: (e: MouseEvent) => void;
  [anchorAttribute: `data-${string}`]: string;
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
 * CSS classes for draggable elements.
 * Apply with :class="drag(...).classes" or :class="dragClasses(...)"
 */
export interface DragClasses {
  /** True when element can be dragged (`when` passes and it is not a disabled candidate) */
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
  /** Props to spread onto the element: no drag handler while it may not drag. */
  props: DragProps;
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
  /**
   * Returns props to make an element draggable. Honors `options.when` (UIX-04)
   * and the board's rule that a disabled candidate drags for nothing (#1299):
   * when either refuses, it returns only the click handler.
   */
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
   * <div v-bind="drop({ id: zone.id }).props"
   *      :class="drop({ id: zone.id }).classes">
   */
  drop: (ref: ElementRef) => DropResult;
  /** Returns just the CSS classes for draggable elements */
  dragClasses: (ref: ElementRef, options?: DragOptions) => DragClasses;
  /** Returns just the CSS classes for drop targets */
  dropClasses: (ref: ElementRef) => DropClasses;
}

export function useDragDrop(): UseDragDropReturn {
  syncReducedMotionClass();
  const boardInteraction = tryUseBoardInteraction();

  const dragProps = (ref: ElementRef, options?: DragOptions): DragProps => propsFor(ref, mayDrag(ref, options), options);

  /** Choose the element, as a click on it would on any board: the tap path. The innermost candidate tapped is the one chosen. */
  const choose = (ref: ElementRef) => (e: MouseEvent) => {
    if (!boardInteraction) return warnNoProvider();
    if (!boardInteraction.isSelectableElement(ref) || boardInteraction.isDisabledElement(ref)) return;
    e.stopPropagation();
    boardInteraction.triggerElementSelect(ref);
  };

  const propsFor = (ref: ElementRef, draggable: boolean, options?: DragOptions): DragProps =>
    draggable
      ? {
          onClick: choose(ref),
          onPointerdown: (e: PointerEvent) => {
            if (!boardInteraction) return warnNoProvider();
            startPointerDrag(e, ref, boardInteraction, options);
          },
          style: { touchAction: 'none', userSelect: 'none' },
        }
      : { onClick: choose(ref) };

  const dropProps = (ref: ElementRef): DropProps => ({ ...anchorAttrs(ref, 'drop-target'), onClick: choose(ref) });

  const isDragging = (ref: ElementRef): boolean => {
    if (!boardInteraction) {
      warnNoProvider();
      return false;
    }
    return boardInteraction.isDraggedElement(ref);
  };

  const isDropTarget = (ref: ElementRef): boolean => {
    if (!boardInteraction) {
      warnNoProvider();
      return false;
    }
    return boardInteraction.isDropTarget(ref);
  };

  const isOver = (ref: ElementRef): boolean => {
    if (!boardInteraction) {
      warnNoProvider();
      return false;
    }
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

  /** The caller's `when`, and the board's own rule that a disabled candidate drags for nothing (#1299). */
  const mayDrag = (ref: ElementRef, options?: DragOptions): boolean =>
    evalCondition(options) && (boardInteraction?.canStartDrag(ref) ?? true);

  /**
   * Get CSS classes for a draggable element.
   */
  const dragClasses = (ref: ElementRef, options?: DragOptions): DragClasses =>
    classesFor(ref, mayDrag(ref, options));

  const classesFor = (ref: ElementRef, draggable: boolean): DragClasses => ({
    'bs-draggable': draggable,
    'bs-dragging': isDragging(ref),
  });

  /**
   * Get CSS classes for a drop target element.
   */
  const dropClasses = (ref: ElementRef): DropClasses => ({
    'bs-drop-target': isDropTarget(ref),
    'bs-drop-hover': isOver(ref),
  });

  /** Combined helper for draggable elements - returns props and classes, asking `when` once. */
  const drag = (ref: ElementRef, options?: DragOptions): DragResult => {
    const draggable = mayDrag(ref, options);
    return { props: propsFor(ref, draggable, options), classes: classesFor(ref, draggable) };
  };

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
