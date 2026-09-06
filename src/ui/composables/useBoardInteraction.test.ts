import { describe, it, expect, vi } from 'vitest';
import { nextTick, watch } from 'vue';
import {
  createBoardInteraction,
  useBoardInteraction,
  tryUseBoardInteraction,
  type ValidElement,
} from './useBoardInteraction.js';

describe('createBoardInteraction', () => {
  it('does not trigger selection for disabled elements', () => {
    const interaction = createBoardInteraction();
    const onSelect = vi.fn();

    const validElements: ValidElement[] = [
      { id: 10, ref: { id: 10 }, disabled: 'Blocked' },
    ];
    interaction.setValidElements(validElements, onSelect);

    interaction.triggerElementSelect({ id: 10 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('matches by id only when the ref carries an id (F22: no name/notation cross-talk)', () => {
    const interaction = createBoardInteraction();
    const onSelect = vi.fn();

    // The valid element's ref carries BOTH a precise id and a colliding name.
    const validElements: ValidElement[] = [
      { id: 5, ref: { id: 5, name: 'Militia' } },
    ];
    interaction.setValidElements(validElements, onSelect);

    // Clicking a DIFFERENT element that shares the name 'Militia' but has a
    // different id must NOT trigger selection of element 5.
    interaction.triggerElementSelect({ id: 8, name: 'Militia' });
    expect(onSelect).not.toHaveBeenCalled();

    // Clicking the element with the matching id selects it.
    interaction.triggerElementSelect({ id: 5, name: 'Militia' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it('falls back to notation then name only when the ref has no id (F22)', () => {
    const interaction = createBoardInteraction();
    const onSelect = vi.fn();

    // Ref without id: notation is the discriminator.
    interaction.setValidElements(
      [{ id: 3, ref: { notation: 'e4', name: 'Pawn' } }],
      onSelect,
    );
    // A different pawn at a different square must not match.
    interaction.triggerElementSelect({ id: 9, notation: 'd4', name: 'Pawn' });
    expect(onSelect).not.toHaveBeenCalled();
    // Matching notation selects it.
    interaction.triggerElementSelect({ id: 3, notation: 'e4', name: 'Pawn' });
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('stores dropped element id and consumes it exactly once', () => {
    const interaction = createBoardInteraction();
    const onDrop = vi.fn();

    interaction.startDrag({ id: 42, name: 'card-42' });
    interaction.setDropTargets([{ id: 7, ref: { id: 7 } }], onDrop);
    interaction.triggerDrop({ id: 7 });

    expect(onDrop).toHaveBeenCalledWith(7);
    expect(interaction.lastDroppedElementId).toBe(42);

    expect(interaction.consumeLastDroppedElementId()).toBe(42);
    expect(interaction.consumeLastDroppedElementId()).toBeNull();
  });
});

describe('board interaction injection (F21)', () => {
  // Outside a Vue component setup / GameShell provider, inject() yields no value.
  it('useBoardInteraction throws an actionable error outside a GameShell', () => {
    expect(() => useBoardInteraction()).toThrow('must be called inside a <GameShell>');
    // Error names the escape hatch so misuse is self-correcting.
    expect(() => useBoardInteraction()).toThrow('tryUseBoardInteraction()');
  });

  it('tryUseBoardInteraction returns undefined (no throw) outside a GameShell', () => {
    expect(tryUseBoardInteraction()).toBeUndefined();
  });
});

/**
 * #172: when the panel yields a large choice to the board, something has to
 * carry FOCUS across that handoff, or the player who pressed the panel's button
 * is left on a control that just unmounted.
 */
describe('requestBoardFocus', () => {
  it('starts at zero', () => {
    expect(createBoardInteraction().boardFocusRequest).toBe(0);
  });

  it('bumps on every request, so a repeat handoff still fires', () => {
    const bi = createBoardInteraction();
    bi.requestBoardFocus();
    expect(bi.boardFocusRequest).toBe(1);
    bi.requestBoardFocus();
    expect(bi.boardFocusRequest).toBe(2);
  });

  it('is reactive so a board can watch it', async () => {
    const bi = createBoardInteraction();
    const seen: number[] = [];
    watch(() => bi.boardFocusRequest, (v) => seen.push(v));
    bi.requestBoardFocus();
    await nextTick();
    expect(seen).toEqual([1]);
  });

  it('clear() does not rewind the counter — a stale watcher must not re-fire', () => {
    const bi = createBoardInteraction();
    bi.requestBoardFocus();
    bi.clear();
    expect(bi.boardFocusRequest).toBe(1);
  });
});
