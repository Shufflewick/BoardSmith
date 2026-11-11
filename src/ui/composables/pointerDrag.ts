/**
 * pointerDrag - drag by pointer events, for mouse, pen and touch alike (#1605).
 *
 * Native HTML5 drag never starts from a touch, so both `useDragDrop` (custom
 * UIs) and the auto-UI element renderers start their drags here. A press that
 * moves past {@link DRAG_THRESHOLD} starts a board drag and a copy of the
 * pressed element follows the pointer; a press that does not stays a click,
 * which is the tap path. The drop target under the pointer is found by
 * hit-testing the `data-bs-el-*` anchors every board element carries, so a drop
 * target needs no handler of its own. A draggable element needs
 * `touch-action: none`, or the browser takes the touch for scrolling.
 */
import { watch } from 'vue';
import { ANCHOR_SELECTOR, anchoredRef, type BoardInteraction, type ElementRef } from './useBoardInteraction.js';

/** How far, in CSS pixels, a press must move before it is a drag rather than a tap. */
export const DRAG_THRESHOLD = 6;

export interface PointerDragHooks {
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/** The innermost anchored element at (x, y) that is a drop target of the drag in progress. */
function dropTargetAt(doc: Document, x: number, y: number, board: BoardInteraction): { node: Element; ref: ElementRef } | null {
  for (let node = doc.elementFromPoint(x, y)?.closest(ANCHOR_SELECTOR); node; node = node.parentElement?.closest(ANCHOR_SELECTOR)) {
    const ref = anchoredRef(node);
    if (board.isDropTarget(ref)) return { node, ref };
  }
  return null;
}

/** The pointerdown a draggable has already claimed: a press on a draggable inside another drags the inner one alone. */
const claimed = new WeakSet<Event>();

/** Whether a draggable claimed this pointerdown, so the board's pan leaves it to the drag. */
export const claimedByDrag = (press: Event): boolean => claimed.has(press);

/**
 * An upright copy of `source`, at its own size and centred on it, that the
 * pointer cannot hit. It carries no id or `data-*` identity, so nothing that
 * looks the board up finds it; Vue's scoped-style `data-v-*` attributes stay,
 * so it keeps the source's look.
 */
function ghostOf(source: HTMLElement): HTMLElement {
  const rect = source.getBoundingClientRect();
  const width = source.offsetWidth || rect.width;
  const height = source.offsetHeight || rect.height;
  const ghost = source.cloneNode(true) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll('*')]) {
    for (const { name } of [...node.attributes]) {
      if (name === 'id' || (name.startsWith('data-') && !name.startsWith('data-v-'))) node.removeAttribute(name);
    }
  }
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${rect.left + (rect.width - width) / 2}px`,
    top: `${rect.top + (rect.height - height) / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    margin: '0',
    boxSizing: 'border-box',
    transform: 'none',
    transition: 'none',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  source.ownerDocument.body.appendChild(ghost);
  return ghost;
}

/**
 * Bind to a draggable element's `pointerdown`: drag `dragged` if the press
 * becomes a drag. `board.startDrag` has the last word, so a candidate disabled
 * since the element rendered starts nothing.
 */
export function startPointerDrag(press: PointerEvent, dragged: ElementRef, board: BoardInteraction, hooks: PointerDragHooks = {}): void {
  if (!press.isPrimary || press.button !== 0 || claimed.has(press)) return;
  claimed.add(press);
  const source = press.currentTarget as HTMLElement;
  const doc = source.ownerDocument;
  const win = doc.defaultView!;
  let ghost: HTMLElement | null = null;
  let over: Element | null = null;
  let at = { x: press.clientX, y: press.clientY };
  let stopWatch = (): void => {};

  const hover = () => {
    const target = dropTargetAt(doc, at.x, at.y, board);
    if ((target?.node ?? null) === over) return;
    over = target?.node ?? null;
    board.setHoveredDropTarget(target?.ref ?? null);
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== press.pointerId) return;
    // No button held: the release happened where this window could not see it.
    if (e.buttons === 0) return finish();
    at = { x: e.clientX, y: e.clientY };
    const dx = at.x - press.clientX;
    const dy = at.y - press.clientY;
    if (!ghost) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!board.startDrag(dragged)) return finish();
      ghost = ghostOf(source);
      // The drop targets are wired after the drag starts: mark the one under a pointer that has stopped moving.
      stopWatch = watch(() => board.dropTargets, hover);
      hooks.onDragStart?.();
    }
    ghost.style.translate = `${dx}px ${dy}px`;
    hover();
  };

  const up = (e: PointerEvent) => {
    if (e.pointerId !== press.pointerId) return;
    if (ghost) {
      const target = dropTargetAt(doc, e.clientX, e.clientY, board);
      if (target) board.triggerDrop(target.ref);
      swallowNextClick(win);
    }
    finish();
  };

  const cancel = (e: PointerEvent) => {
    if (e.pointerId === press.pointerId) finish();
  };

  // A pressed image or link would start a native drag, which cancels the pointer.
  const noNativeDrag = (e: DragEvent) => e.preventDefault();

  function finish(): void {
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', up);
    win.removeEventListener('pointercancel', cancel);
    win.removeEventListener('blur', finish);
    doc.removeEventListener('dragstart', noNativeDrag, true);
    if (!ghost) return;
    stopWatch();
    ghost.remove();
    hooks.onDragEnd?.();
    if (board.isDragging) board.endDrag();
  }

  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', up);
  win.addEventListener('pointercancel', cancel);
  win.addEventListener('blur', finish);
  doc.addEventListener('dragstart', noNativeDrag, true);
}

/** A mouse drag ends in a click on whatever it was released over; that click is the drag's, not a choice. */
function swallowNextClick(win: Window): void {
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  win.addEventListener('click', swallow, { capture: true, once: true });
  // The click, when there is one, is dispatched in the same task as the pointerup.
  win.setTimeout(() => win.removeEventListener('click', swallow, { capture: true }), 0);
}
