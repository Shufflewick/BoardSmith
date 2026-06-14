import { describe, it, expect, vi } from 'vitest';
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
