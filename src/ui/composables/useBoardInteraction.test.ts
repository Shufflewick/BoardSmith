import { describe, it, expect, vi } from 'vitest';
import { createBoardInteraction, type ValidElement } from './useBoardInteraction.js';

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
