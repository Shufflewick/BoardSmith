// @vitest-environment jsdom
/**
 * drag-keyboard-parity: two-path regression guard (A11Y-01 + drag progressive enhancement)
 *
 * Proves that after the keyboard migration both selection paths coexist:
 *   1. Keyboard path: Enter/Space on a mounted renderer triggers selection through
 *      useSelectable → boardInteraction.triggerElementSelect → onElementSelect callback.
 *   2. Drag path: drag-drop onto a valid drop target still triggers its onDrop callback
 *      through boardInteraction.startDrag → setDropTargets → triggerDrop — drag is
 *      preserved as progressive enhancement and was NOT broken by the keyboard migration.
 *
 * Both paths run against the SAME createBoardInteraction() instance to prove they share
 * the same interaction state (parity) rather than maintaining two disconnected systems.
 *
 * Test harness mirrors interaction-integration.test.ts (same real createBoardInteraction,
 * same spy pattern). The drag path mirrors the 'DRAG-TO-SELECT' test in
 * useDragDropTargets.test.ts: no hand-rolled drag simulator is needed because the
 * BoardInteraction API (startDrag / setDropTargets / triggerDrop) is the shared contract
 * that both the ActionPanel and any renderer consume.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import {
  createBoardInteraction,
  provideBoardInteraction,
} from '../../../composables/useBoardInteraction.js';
import CardRenderer from './CardRenderer.vue';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type BoardInteractionInstance = ReturnType<typeof createBoardInteraction>;

/** Minimal card element shape expected by CardRenderer. */
function makeCard(id = 1) {
  return { id, className: 'Card', name: 'ace-of-spades', attributes: {} };
}

/**
 * Mount CardRenderer inside a wrapper that provides the given boardInteraction.
 * Mirrors the `mountWithInteraction` helper in CardRenderer.a11y.test.ts.
 */
function mountCard(bi: BoardInteractionInstance, cardId = 1) {
  const Wrapper = defineComponent({
    setup() {
      provideBoardInteraction(bi);
    },
    render() {
      return h(CardRenderer, { element: makeCard(cardId), depth: 0 });
    },
  });
  return mount(Wrapper);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('drag-keyboard-parity — A11Y-01 keyboard primary path + drag progressive enhancement', () => {
  let bi: BoardInteractionInstance;
  let onSelectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bi = createBoardInteraction();
    onSelectSpy = vi.fn();
    // Seed: card id=1 is a valid element for the current action pick.
    // The real createBoardInteraction.isSelectableElement checks this list,
    // so the renderer correctly receives tabindex="0" and can be activated.
    bi.setValidElements([{ id: 1, ref: { id: 1 } }], onSelectSpy);
  });

  // ── Keyboard path ──────────────────────────────────────────────────────────

  it('keyboard path: Enter on mounted CardRenderer triggers onElementSelect via useSelectable', async () => {
    // Mount a real renderer inside the board-interaction provider.
    // The keyboard event flows: @keydown → onSelectKey (=onKeydown from useSelectable)
    // → handleActivate → boardInteraction.triggerElementSelect({ id:1 })
    // → onElementSelect callback (our spy).
    const wrapper = mountCard(bi);
    await wrapper.find('.card-container').trigger('keydown', { key: 'Enter' });

    expect(onSelectSpy).toHaveBeenCalledTimes(1);
    expect(onSelectSpy).toHaveBeenCalledWith(1);
  });

  it('keyboard path: Space on mounted CardRenderer triggers onElementSelect via useSelectable', async () => {
    const wrapper = mountCard(bi);
    await wrapper.find('.card-container').trigger('keydown', { key: ' ' });

    expect(onSelectSpy).toHaveBeenCalledTimes(1);
    expect(onSelectSpy).toHaveBeenCalledWith(1);
  });

  it('keyboard path: non-activation keys (Tab, ArrowDown) do NOT trigger selection', async () => {
    const wrapper = mountCard(bi);
    await wrapper.find('.card-container').trigger('keydown', { key: 'Tab' });
    await wrapper.find('.card-container').trigger('keydown', { key: 'ArrowDown' });
    await wrapper.find('.card-container').trigger('keydown', { key: 'Escape' });

    expect(onSelectSpy).not.toHaveBeenCalled();
  });

  // ── Drag path ──────────────────────────────────────────────────────────────

  it('drag path: startDrag + setDropTargets + triggerDrop fires onDrop callback (progressive enhancement)', () => {
    // This mirrors the 'DRAG-TO-SELECT' test in useDragDropTargets.test.ts.
    // The drag path uses the same shared BoardInteraction state as the keyboard
    // path — no separate system. Dropping onto a valid target fires the
    // onDrop callback, proving drag is preserved as progressive enhancement.
    const onDropSpy = vi.fn();
    const dropTarget = { id: 42, ref: { id: 42 } };

    // Drag starts on element 1
    bi.startDrag({ id: 1 });
    expect(bi.isDragging).toBe(true);
    expect(bi.isDraggedElement({ id: 1 })).toBe(true);

    // Wire drop targets (what setupDragDropOrchestration does in GameShell)
    bi.setDropTargets([dropTarget], onDropSpy);
    expect(bi.isDropTarget({ id: 42 })).toBe(true);
    expect(bi.isDropTarget({ id: 999 })).toBe(false);

    // Drop onto the target
    bi.triggerDrop({ id: 42 });

    expect(onDropSpy).toHaveBeenCalledTimes(1);
    expect(onDropSpy).toHaveBeenCalledWith(42);
    // Drag state is cleared after a successful drop
    expect(bi.isDragging).toBe(false);
    expect(bi.dropTargets).toEqual([]);
  });

  it('drag path: dropping onto a non-target does NOT fire the onDrop callback', () => {
    const onDropSpy = vi.fn();
    bi.startDrag({ id: 1 });
    bi.setDropTargets([{ id: 42, ref: { id: 42 } }], onDropSpy);

    // Drop onto an element that is NOT a drop target
    bi.triggerDrop({ id: 999 });

    expect(onDropSpy).not.toHaveBeenCalled();
    // Drag state remains active (drop did not complete)
    expect(bi.isDragging).toBe(true);
  });

  // ── Parity proof ───────────────────────────────────────────────────────────

  it('parity: keyboard and drag paths share the same boardInteraction state without cross-contamination', async () => {
    // Verify both paths coexist on the same bi instance with no interference.
    const keyboardSpy = vi.fn();
    bi.setValidElements([{ id: 1, ref: { id: 1 } }], keyboardSpy);

    // Keyboard activation
    const wrapper = mountCard(bi);
    await wrapper.find('.card-container').trigger('keydown', { key: 'Enter' });
    expect(keyboardSpy).toHaveBeenCalledTimes(1);

    keyboardSpy.mockClear();

    // Drag activation on the same bi — keyboard callback is not re-triggered
    const onDropSpy = vi.fn();
    bi.setDropTargets([{ id: 99, ref: { id: 99 } }], onDropSpy);
    bi.startDrag({ id: 1 });
    bi.triggerDrop({ id: 99 });

    expect(onDropSpy).toHaveBeenCalledTimes(1);
    expect(onDropSpy).toHaveBeenCalledWith(99);
    // Keyboard path was not triggered by the drag operation
    expect(keyboardSpy).not.toHaveBeenCalled();
  });
});
