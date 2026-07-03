// @vitest-environment jsdom
/**
 * useDragDrop direct unit tests (ANIM-02)
 *
 * Two levels of coverage per 128-CONTEXT.md:
 *   1. API-level parity path — drive the shared BoardInteraction contract
 *      (startDrag/setDropTargets/triggerDrop) that both dragProps/dropProps
 *      handlers and the keyboard/drag parity suite consume.
 *   2. Event-level path — call dragProps(ref).onDragstart / dropProps(ref)
 *      .onDragover/.onDrop directly with a hand-built plain object shaped
 *      like the subset of DragEvent the handlers actually read. jsdom has no
 *      DragEvent/DataTransfer constructors (RESEARCH probe), so a real
 *      `new DragEvent(...)` cannot be used here.
 *
 * Also proves the deliberate degrade-gracefully design (RESEARCH Pitfall 4,
 * useDragDrop.ts:93-107): with no <GameShell> provider, handlers devWarn
 * once and do NOT throw. useDragDrop.ts itself is NOT modified by this plan.
 *
 * NOTE: provideBoardInteraction()/tryUseBoardInteraction() are Vue provide()/
 * inject(), which only work inside a real component setup() context — calling
 * them as bare functions warns and silently no-ops. Every test below therefore
 * mounts a minimal component (mirrors drag-keyboard-parity.test.ts) instead of
 * calling provide/useDragDrop directly at module scope.
 */

// jsdom lacks matchMedia/ResizeObserver; modules that read them at import
// time would throw. Stubs MUST be installed before the composable imports
// below, since useBoardInteraction/useDragDrop transitively read matchMedia
// at module load (Pitfall 1).
import { vi } from 'vitest';

vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import {
  createBoardInteraction,
  provideBoardInteraction,
  type ElementRef,
} from './useBoardInteraction.js';
import { useDragDrop, type UseDragDropReturn, type DragProps } from './useDragDrop.js';
import { _clearShownWarnings } from '../../utils/dev.js';

type BoardInteractionInstance = ReturnType<typeof createBoardInteraction>;

/** Build a fake DragEvent-shaped plain object with only the fields the
 * useDragDrop handlers read (dataTransfer.setData/getData/effectAllowed/
 * dropEffect, preventDefault, currentTarget, relatedTarget). */
function makeFakeDragEvent(overrides: Partial<{
  currentTarget: unknown;
  relatedTarget: unknown;
}> = {}) {
  return {
    dataTransfer: {
      setData: vi.fn(),
      getData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
    },
    preventDefault: vi.fn(),
    currentTarget: overrides.currentTarget ?? document.createElement('div'),
    relatedTarget: overrides.relatedTarget ?? null,
  };
}

/** Number of console.warn calls whose message contains `needle` (filters out
 * Vue's own dev "injection not found" warning, which is unrelated noise from
 * the no-provider scenario and not part of useDragDrop's own devWarn contract). */
function warnCallsContaining(warnSpy: ReturnType<typeof vi.spyOn>, needle: string): number {
  return warnSpy.mock.calls.filter((call) => String(call[0]).includes(needle)).length;
}

/**
 * Mount a Parent/Child pair: Parent provides `bi` (if given), Child calls
 * useDragDrop(). Vue's inject() reads from the PARENT instance's provides,
 * not the same instance's own provide() call — so provide+inject must live
 * in different components in the tree (mirrors mountCard() in
 * drag-keyboard-parity.test.ts, where the Wrapper provides and CardRenderer
 * injects).
 */
function mountDragDrop(bi?: BoardInteractionInstance) {
  let exposedApi!: UseDragDropReturn;
  const Child = defineComponent({
    setup() {
      exposedApi = useDragDrop();
      return {};
    },
    render() {
      return h('div');
    },
  });
  const Parent = defineComponent({
    setup() {
      if (bi) provideBoardInteraction(bi);
      return {};
    },
    render() {
      return h(Child);
    },
  });
  const wrapper = mount(Parent);
  return { wrapper, api: exposedApi };
}

// ---------------------------------------------------------------------------
// 1. API-level parity path
// ---------------------------------------------------------------------------

describe('useDragDrop — API-level parity path (shared BoardInteraction contract)', () => {
  let bi: BoardInteractionInstance;

  beforeEach(() => {
    bi = createBoardInteraction();
  });

  it('startDrag → setDropTargets → triggerDrop fires onDrop and resets drag state', () => {
    const onDropSpy = vi.fn();
    const dropTarget = { id: 42, ref: { id: 42 } };

    bi.startDrag({ id: 1 });
    expect(bi.isDragging).toBe(true);

    bi.setDropTargets([dropTarget], onDropSpy);
    expect(bi.isDropTarget({ id: 42 })).toBe(true);

    bi.triggerDrop({ id: 42 });

    expect(onDropSpy).toHaveBeenCalledTimes(1);
    expect(onDropSpy).toHaveBeenCalledWith(42);
    expect(bi.isDragging).toBe(false);
    expect(bi.dropTargets).toEqual([]);
  });

  it('dragProps(ref).onDragstart calls boardInteraction.startDrag with the ref', () => {
    const { api } = mountDragDrop(bi);
    const ref: ElementRef = { id: 7 };
    const fakeEvent = makeFakeDragEvent();

    (api.dragProps(ref) as DragProps).onDragstart(fakeEvent as unknown as DragEvent);

    expect(bi.isDragging).toBe(true);
    expect(bi.isDraggedElement(ref)).toBe(true);
  });

  it('dropProps(ref).onDrop calls boardInteraction.triggerDrop when a drag is active', () => {
    const onDropSpy = vi.fn();
    bi.startDrag({ id: 1 });
    bi.setDropTargets([{ id: 5, ref: { id: 5 } }], onDropSpy);

    const { api } = mountDragDrop(bi);
    const fakeEvent = makeFakeDragEvent();
    api.dropProps({ id: 5 }).onDrop(fakeEvent as unknown as DragEvent);

    expect(onDropSpy).toHaveBeenCalledTimes(1);
    expect(onDropSpy).toHaveBeenCalledWith(5);
  });
});

// ---------------------------------------------------------------------------
// 2. Event-level path — hand-built drag-event-shaped objects
// ---------------------------------------------------------------------------

describe('useDragDrop — event-level path (drag-event-shaped plain objects)', () => {
  let bi: BoardInteractionInstance;

  beforeEach(() => {
    bi = createBoardInteraction();
  });

  it('dragProps(ref).onDragstart sets dataTransfer payload + effectAllowed', () => {
    const { api } = mountDragDrop(bi);
    const el = document.createElement('div');
    const fakeEvent = makeFakeDragEvent({ currentTarget: el });

    (api.dragProps({ id: 3 }) as DragProps).onDragstart(fakeEvent as unknown as DragEvent);

    expect(fakeEvent.dataTransfer.setData).toHaveBeenCalledWith(
      'boardsmith/element',
      JSON.stringify({ id: 3 }),
    );
    expect(fakeEvent.dataTransfer.effectAllowed).toBe('move');
  });

  it('dropProps(ref).onDragover calls preventDefault and sets dropEffect when the ref is a valid target', () => {
    bi.startDrag({ id: 1 });
    bi.setDropTargets([{ id: 9, ref: { id: 9 } }], vi.fn());

    const { api } = mountDragDrop(bi);
    const fakeEvent = makeFakeDragEvent();

    api.dropProps({ id: 9 }).onDragover(fakeEvent as unknown as DragEvent);

    expect(fakeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(fakeEvent.dataTransfer.dropEffect).toBe('move');
  });

  it('dropProps(ref).onDragover does NOT preventDefault when no drag is active', () => {
    const { api } = mountDragDrop(bi);
    const fakeEvent = makeFakeDragEvent();

    api.dropProps({ id: 9 }).onDragover(fakeEvent as unknown as DragEvent);

    expect(fakeEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('dropProps(ref).onDrop calls preventDefault and triggers the drop', () => {
    const onDropSpy = vi.fn();
    bi.startDrag({ id: 1 });
    bi.setDropTargets([{ id: 9, ref: { id: 9 } }], onDropSpy);

    const { api } = mountDragDrop(bi);
    const fakeEvent = makeFakeDragEvent();

    api.dropProps({ id: 9 }).onDrop(fakeEvent as unknown as DragEvent);

    expect(fakeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(onDropSpy).toHaveBeenCalledWith(9);
  });
});

// ---------------------------------------------------------------------------
// 3. Degrade-gracefully: no provider warns, never throws (Pitfall 4)
// ---------------------------------------------------------------------------

describe('useDragDrop — no-provider degrade-gracefully path (unchanged design)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _clearShownWarnings();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('dragProps(ref).onDragstart with no provider warns once and does not throw', () => {
    // No `bi` passed to mountDragDrop — simulates a component rendered
    // outside <GameShell> (no board-interaction provider in the tree).
    const { api } = mountDragDrop();
    const fakeEvent = makeFakeDragEvent();

    expect(() =>
      (api.dragProps({ id: 1 }) as DragProps).onDragstart(fakeEvent as unknown as DragEvent),
    ).not.toThrow();

    expect(warnCallsContaining(warnSpy, 'useDragDrop')).toBe(1);
  });

  it('isDragging(ref) with no provider warns and returns false without throwing', () => {
    const { api } = mountDragDrop();

    let result: boolean | undefined;
    expect(() => {
      result = api.isDragging({ id: 1 });
    }).not.toThrow();

    expect(result).toBe(false);
    expect(warnCallsContaining(warnSpy, 'useDragDrop')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. dragProps() honors the documented `when` option (UIX-04, Plan 134-03 Task 3)
//
// Prior behavior: dragProps() always returned { draggable: true, ... } and
// silently ignored options.when — a developer calling
// dragProps(ref, { when: canDrag(card) }) (the documented "Full API" pattern)
// got an element that stayed draggable regardless of `when`. dragProps() now
// reuses the existing evalCondition() helper (already used by dragClasses()/
// drag()) to gate on `when`, returning inert props when it evaluates false.
// ---------------------------------------------------------------------------

describe('useDragDrop — dragProps() honors the `when` option (UIX-04)', () => {
  let bi: BoardInteractionInstance;

  beforeEach(() => {
    bi = createBoardInteraction();
  });

  it('dragProps(ref, { when: false }) returns inert props: not draggable, no onDragstart, onDragend retained (WR-06)', () => {
    const { api } = mountDragDrop(bi);
    const result = api.dragProps({ id: 1 }, { when: false });

    expect(result.draggable).toBe(false);
    // No dragstart — a NEW drag can never begin from an inert element...
    expect('onDragstart' in result).toBe(false);
    // ...but dragend stays attached so a `when` flip mid-drag still cleans up.
    expect(typeof result.onDragend).toBe('function');
  });

  it('dragProps(ref, { when: () => false }) returns inert props (function form evaluated via evalCondition)', () => {
    const { api } = mountDragDrop(bi);
    const whenFn = vi.fn(() => false);
    const result = api.dragProps({ id: 1 }, { when: whenFn });

    expect(result.draggable).toBe(false);
    expect('onDragstart' in result).toBe(false);
    expect(whenFn).toHaveBeenCalledTimes(1);
  });

  it('a `when` flip mid-drag still ends the drag: inert dragProps retain onDragend (WR-06)', () => {
    const { api } = mountDragDrop(bi);

    // Drag starts while `when` is true...
    const active = api.dragProps({ id: 1 }, { when: true }) as DragProps;
    active.onDragstart(makeFakeDragEvent() as unknown as DragEvent);
    expect(bi.isDragging).toBe(true);

    // ...then a broadcast tears down the in-progress action mid-drag, the
    // caller's canDrag computed flips false, and the component re-renders,
    // v-binding the INERT props onto the (still-dragging) source element.
    const inert = api.dragProps({ id: 1 }, { when: false });
    expect((inert as { draggable: boolean }).draggable).toBe(false);
    const onDragend = (inert as { onDragend?: () => void }).onDragend;
    expect(typeof onDragend).toBe('function');

    // When the user releases, dragend fires on the source element — without a
    // retained handler, endDrag() never runs and isDragging/highlights wedge.
    onDragend!();
    expect(bi.isDragging).toBe(false);
  });

  it('a `when` flip mid-drag still ends the drag for drag().props too (WR-06 parity)', () => {
    const { api } = mountDragDrop(bi);

    const active = api.drag({ id: 1 }, { when: true }).props as DragProps;
    active.onDragstart(makeFakeDragEvent() as unknown as DragEvent);
    expect(bi.isDragging).toBe(true);

    const inert = api.drag({ id: 1 }, { when: false }).props;
    const onDragend = (inert as { onDragend?: () => void }).onDragend;
    expect(typeof onDragend).toBe('function');

    onDragend!();
    expect(bi.isDragging).toBe(false);
  });

  it('the inert onDragend is a no-op when no drag is in flight (does not fire user onDragEnd)', () => {
    const { api } = mountDragDrop(bi);
    const onDragEnd = vi.fn();

    const inert = api.dragProps({ id: 1 }, { when: false, onDragEnd });
    const handler = (inert as { onDragend?: () => void }).onDragend;
    expect(typeof handler).toBe('function');

    // No drag in flight — a stray dragend must not run user cleanup or endDrag.
    handler!();
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(bi.isDragging).toBe(false);
  });

  it('dragProps(ref) with no options returns the full draggable props unchanged', () => {
    const { api } = mountDragDrop(bi);
    const result = api.dragProps({ id: 1 }) as DragProps;

    expect(result.draggable).toBe(true);
    expect(typeof result.onDragstart).toBe('function');
    expect(typeof result.onDragend).toBe('function');
  });

  it('dragProps(ref, { when: true }) returns the full draggable props unchanged', () => {
    const { api } = mountDragDrop(bi);
    const result = api.dragProps({ id: 1 }, { when: true }) as DragProps;

    expect(result.draggable).toBe(true);
    expect(typeof result.onDragstart).toBe('function');
    expect(typeof result.onDragend).toBe('function');
  });

  it('dragProps(ref, { when: () => true }) returns the full draggable props unchanged', () => {
    const { api } = mountDragDrop(bi);
    const result = api.dragProps({ id: 1 }, { when: () => true }) as DragProps;

    expect(result.draggable).toBe(true);
    expect(typeof result.onDragstart).toBe('function');
  });
});
