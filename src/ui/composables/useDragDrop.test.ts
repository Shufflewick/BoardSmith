// @vitest-environment jsdom
/**
 * useDragDrop drives a custom board by pointer and by tap (#1605).
 *
 * The board below is wired ONLY with drag() and drop(), the way a game author
 * writes one, and mounted for real inside a provider. Drag is pointer events:
 * a press that moves past a few pixels starts the drag, the drop target under
 * the pointer is found by hit-testing (jsdom has no layout, so
 * `elementFromPoint` is stubbed to name the element under the pointer), and the
 * release drops there. A press that does not move is a click, the tap path.
 */
import { vi } from 'vitest';

vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, type PropType } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createBoardInteraction, provideBoardInteraction, type ElementRef } from './useBoardInteraction.js';
import { useDragDrop, type DragOptions, type UseDragDropReturn } from './useDragDrop.js';
import { _clearShownWarnings } from '../../utils/dev.js';

type BoardInteractionInstance = ReturnType<typeof createBoardInteraction>;

const PIECE: ElementRef = { id: 1 };
const ZONE: ElementRef = { id: 5 };

/** A custom board: one draggable piece and one drop zone, wired only with drag() and drop(). */
function mountBoard(bi?: BoardInteractionInstance, options: DragOptions = {}) {
  let api!: UseDragDropReturn;
  const Board = defineComponent({
    props: { options: { type: Object as PropType<DragOptions>, required: true } },
    setup(props) {
      api = useDragDrop();
      return () =>
        h('div', [
          h('div', { class: ['piece', api.drag(PIECE, props.options).classes], ...api.drag(PIECE, props.options).props }, 'piece'),
          h('div', { class: ['zone', api.drop(ZONE).classes], ...api.drop(ZONE).props }, 'zone'),
        ]);
    },
  });
  const Shell = defineComponent({
    setup() {
      if (bi) provideBoardInteraction(bi);
      return () => h(Board, { options });
    },
  });
  const wrapper = mount(Shell, { attachTo: document.body });
  return { wrapper, api, piece: wrapper.find('.piece'), zone: wrapper.find('.zone') };
}

/** Name the element the pointer is over; jsdom does no layout. */
function pointerOver(element: Element | null) {
  document.elementFromPoint = () => element;
}

function pointer(type: string, target: Element, x: number, buttons = type === 'pointerup' ? 0 : 1) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, buttons, clientX: x, clientY: 0 }));
}

/** Press the piece, move the pointer onto the zone, and leave it held there. */
function dragOntoZone(piece: Element, zone: Element) {
  pointer('pointerdown', piece, 0);
  pointerOver(zone);
  pointer('pointermove', piece, 30);
  pointer('pointermove', piece, 40);
}

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.replaceChildren();
});

describe('useDragDrop — a board wired only with drag() and drop() plays by tap', () => {
  it('a tap on the piece and then on the zone completes the action', async () => {
    const bi = createBoardInteraction();
    const chosen: number[] = [];
    bi.setValidElements([{ id: 1, ref: PIECE }], (id) => {
      chosen.push(id);
      bi.setValidElements([{ id: 5, ref: ZONE }], (next) => chosen.push(next));
    });
    const board = mountBoard(bi);
    wrapper = board.wrapper;

    await board.piece.trigger('click');
    await board.zone.trigger('click');

    expect(chosen).toEqual([1, 5]);
  });
});

/** A custom board with a draggable token inside a draggable card inside a drop zone. */
function mountNested(bi: BoardInteractionInstance) {
  const TOKEN: ElementRef = { id: 2 };
  const Board = defineComponent({
    setup() {
      const { drag, drop } = useDragDrop();
      return () =>
        h('div', { class: 'zone', ...drop(ZONE).props }, [
          h('div', { class: 'card', ...drag(PIECE).props }, [h('div', { class: 'token', ...drag(TOKEN).props }, 'token')]),
        ]);
    },
  });
  const Shell = defineComponent({
    setup() {
      provideBoardInteraction(bi);
      return () => h(Board);
    },
  });
  wrapper = mount(Shell, { attachTo: document.body });
  return { token: wrapper.find('.token'), TOKEN };
}

describe('useDragDrop — nested elements', () => {
  it('a tap chooses the innermost element that is a candidate, and only that one', async () => {
    const bi = createBoardInteraction();
    const chosen: number[] = [];
    bi.setValidElements([{ id: 1, ref: PIECE }, { id: 5, ref: ZONE }], (id) => chosen.push(id));
    const { token } = mountNested(bi);

    await token.trigger('click');

    expect(chosen).toEqual([1]);
  });

  it('a press on a draggable inside a draggable drags the inner one alone', () => {
    const bi = createBoardInteraction();
    const { token, TOKEN } = mountNested(bi);
    const before = document.body.childElementCount;

    pointer('pointerdown', token.element, 0);
    pointerOver(null);
    pointer('pointermove', token.element, 30);

    expect(bi.draggedElement).toEqual(TOKEN);
    expect(document.body.childElementCount).toBe(before + 1);
    pointer('pointerup', token.element, 30);
  });
});

describe('useDragDrop — pointer drag', () => {
  let bi: BoardInteractionInstance;
  let onDrop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bi = createBoardInteraction();
    onDrop = vi.fn();
  });

  /** Mount the board and wire the zone as the drop target once the drag starts, as GameShell's orchestration does. */
  function mountDragging(options: DragOptions = {}) {
    const board = mountBoard(bi, options);
    wrapper = board.wrapper;
    const startDrag = bi.startDrag.bind(bi);
    bi.startDrag = (ref) => {
      const started = startDrag(ref);
      if (started) bi.setDropTargets([{ id: 5, ref: ZONE }], onDrop);
      return started;
    };
    return board;
  }

  it('the piece takes the pointer itself, so the page still scrolls elsewhere', () => {
    const { piece, zone } = mountDragging();
    expect((piece.element as HTMLElement).style.touchAction).toBe('none');
    expect((zone.element as HTMLElement).style.touchAction).toBe('');
  });

  it('dragging the piece onto the zone marks it under the pointer, and releasing drops it there', async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const { piece, zone } = mountDragging({ onDragStart, onDragEnd });

    dragOntoZone(piece.element, zone.element);
    await wrapper!.vm.$nextTick();

    expect(bi.isDraggedElement(PIECE)).toBe(true);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(zone.classes()).toEqual(expect.arrayContaining(['bs-drop-target', 'bs-drop-hover']));
    expect(piece.classes()).toContain('bs-dragging');

    pointer('pointerup', piece.element, 40);

    expect(onDrop).toHaveBeenCalledWith(5);
    expect(bi.isDragging).toBe(false);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('a drag shows a copy of the piece under the pointer, and takes it away on release', () => {
    const { piece, zone } = mountDragging();
    dragOntoZone(piece.element, zone.element);
    const ghost = document.body.lastElementChild as HTMLElement;
    expect(ghost.textContent).toBe('piece');
    expect(ghost.style.pointerEvents).toBe('none');

    pointer('pointerup', piece.element, 40);
    expect(ghost.isConnected).toBe(false);
  });

  it('the click a drag ends in does not also choose what it lands on', async () => {
    const chosen: number[] = [];
    bi.setValidElements([{ id: 5, ref: ZONE }], (id) => chosen.push(id));
    const { piece, zone } = mountDragging();
    dragOntoZone(piece.element, zone.element);
    pointer('pointerup', zone.element, 40);
    await zone.trigger('click');
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(chosen).toEqual([]);
  });

  it('a press that barely moves is a tap: it starts no drag', () => {
    const { piece } = mountDragging();
    pointer('pointerdown', piece.element, 0);
    pointer('pointermove', piece.element, 2);
    pointer('pointerup', piece.element, 2);
    expect(bi.draggedElement).toBeNull();
  });

  it('releasing off every drop target ends the drag and drops nothing', () => {
    const onDragEnd = vi.fn();
    const { piece, zone } = mountDragging({ onDragEnd });
    dragOntoZone(piece.element, zone.element);
    pointerOver(document.body);
    pointer('pointermove', piece.element, 200);
    expect(bi.hoveredDropTarget).toBeNull();
    pointer('pointerup', piece.element, 200);
    expect(onDrop).not.toHaveBeenCalled();
    expect(bi.isDragging).toBe(false);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('a pointer whose release was missed, moving with no button held, ends the drag and drops nothing', () => {
    const { piece, zone } = mountDragging();
    dragOntoZone(piece.element, zone.element);
    pointer('pointermove', piece.element, 40, 0);
    expect(bi.isDragging).toBe(false);
    pointer('pointerup', piece.element, 40);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('the window losing focus mid-drag ends the drag and drops nothing', () => {
    const { piece, zone } = mountDragging();
    dragOntoZone(piece.element, zone.element);
    window.dispatchEvent(new Event('blur'));
    expect(bi.isDragging).toBe(false);
    pointer('pointerup', piece.element, 40);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('a cancelled pointer ends the drag and drops nothing', () => {
    const { piece, zone } = mountDragging();
    dragOntoZone(piece.element, zone.element);
    pointer('pointercancel', piece.element, 40);
    expect(onDrop).not.toHaveBeenCalled();
    expect(bi.isDragging).toBe(false);
  });
});

describe('useDragDrop — what may drag', () => {
  it('a disabled candidate gets no drag handler and no bs-draggable class (#1299)', () => {
    const bi = createBoardInteraction();
    bi.setValidElements([{ id: 1, ref: { id: 1 }, disabled: 'Too expensive' }, { id: 2, ref: { id: 2 } }], () => {});
    const { api, wrapper: mounted } = mountBoard(bi);
    wrapper = mounted;

    expect('onPointerdown' in api.dragProps({ id: 1 })).toBe(false);
    expect(api.drag({ id: 1 }).classes['bs-draggable']).toBe(false);
    expect(api.dragClasses({ id: 1 })['bs-draggable']).toBe(false);
    expect(typeof api.drag({ id: 2 }).props.onPointerdown).toBe('function');
    expect(api.drag({ id: 2 }).classes['bs-draggable']).toBe(true);
  });

  it('a candidate disabled after its props were bound starts no drag and runs no onDragStart', () => {
    const bi = createBoardInteraction();
    bi.setValidElements([{ id: 1, ref: PIECE }], () => {});
    const onDragStart = vi.fn();
    const board = mountBoard(bi, { onDragStart });
    wrapper = board.wrapper;
    bi.setValidElements([{ id: 1, ref: PIECE, disabled: 'Too expensive' }], () => {});

    dragOntoZone(board.piece.element, board.zone.element);

    expect(bi.isDragging).toBe(false);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('`when: false`, as a value or a function asked once, gives no drag handler', () => {
    const bi = createBoardInteraction();
    const { api, wrapper: mounted } = mountBoard(bi);
    wrapper = mounted;
    const when = vi.fn(() => false);

    expect('onPointerdown' in api.dragProps({ id: 1 }, { when: false })).toBe(false);
    expect('onPointerdown' in api.drag({ id: 1 }, { when }).props).toBe(false);
    expect(when).toHaveBeenCalledTimes(1);
    expect(typeof api.dragProps({ id: 1 }, { when: true }).onPointerdown).toBe('function');
  });
});

describe('useDragDrop — no provider warns and never throws', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _clearShownWarnings();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  const warnings = () => warnSpy.mock.calls.filter((call) => String(call[0]).includes('useDragDrop')).length;

  it('a press, a drag and a tap with no provider warn once and do not throw', async () => {
    const board = mountBoard();
    wrapper = board.wrapper;
    warnSpy.mockClear();
    _clearShownWarnings();

    expect(() => dragOntoZone(board.piece.element, board.zone.element)).not.toThrow();
    pointer('pointerup', board.piece.element, 40);
    await board.piece.trigger('click');

    expect(warnings()).toBe(1);
  });
});
