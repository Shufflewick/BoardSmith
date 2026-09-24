import { describe, it, expect, vi } from 'vitest';
import { computed, nextTick, watch } from 'vue';
import {
  createBoardInteraction,
  useBoardInteraction,
  tryUseBoardInteraction,
  type BoardTarget,
} from './useBoardInteraction.js';

describe('createBoardInteraction', () => {
  it('does not trigger selection for disabled elements', () => {
    const interaction = createBoardInteraction();
    const onSelect = vi.fn();

    const validElements: BoardTarget[] = [
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
    const validElements: BoardTarget[] = [
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

// ---------------------------------------------------------------------------
// #313 — a board of thousands of candidates is asked about each of its spaces
// ---------------------------------------------------------------------------

describe('candidate lookups on a large pick (#313)', () => {
  /** Windup Warfare's placePack: one notation-anchored candidate per space. */
  function spaces(n: number): BoardTarget[] {
    return Array.from({ length: n }, (_, i) => ({
      id: -1 - i,
      ref: { notation: `s${i}` },
      display: `Space ${i}`,
      ...(i % 2 === 1 ? { disabled: 'Too close to the enemy' } : {}),
    }));
  }

  it('answers for every space of a 3,720-candidate pick without rescanning the list per space', () => {
    // A board renders each space and asks whether it is a candidate, whether it is
    // disabled and what it is called. Scanning the whole list for every space is
    // 3,720 x 3,720 comparisons through reactive proxies: over forty seconds
    // measured, on every render of the board.
    //
    // The proof is the work done, not the time taken (#360): every read of a
    // candidate's `ref` is counted. Indexing the list reads each one once; a scan
    // per question would read them millions of times.
    let refReads = 0;
    const counted = spaces(3720).map((candidate) => {
      const { ref, ...rest } = candidate;
      return Object.defineProperty(rest, 'ref', {
        enumerable: true,
        get: () => {
          refReads++;
          return ref;
        },
      }) as BoardTarget;
    });
    const interaction = createBoardInteraction();
    interaction.setValidElements(counted, () => {});

    let selectable = 0;
    let disabled = 0;
    for (let i = 0; i < 3720; i++) {
      const cell = { id: 1000 + i, notation: `s${i}` };
      if (interaction.isSelectableElement(cell)) selectable++;
      if (interaction.isDisabledElement(cell)) disabled++;
      expect(interaction.candidateLabel(cell)).toBe(`Space ${i}`);
    }

    expect(selectable).toBe(3720);
    expect(disabled).toBe(1860);
    expect(refReads).toBe(3720);
  });

  it('keeps the list order when two candidates match one element', () => {
    // matchesRef precedence is per ref; across the list the FIRST match is the
    // candidate, as it was when every lookup was a scan.
    const interaction = createBoardInteraction();
    const onSelect = vi.fn();
    interaction.setValidElements(
      [
        { id: -1, ref: { notation: 'a1' }, display: 'by notation' },
        { id: 7, ref: { id: 7 }, display: 'by id' },
      ],
      onSelect,
    );

    expect(interaction.candidateLabel({ id: 7, notation: 'a1' })).toBe('by notation');
    interaction.triggerElementSelect({ id: 7, notation: 'a1' });
    expect(onSelect).toHaveBeenCalledWith(-1);
    expect(interaction.candidateLabel({ id: 7, notation: 'b2' })).toBe('by id');
  });

  it('matches by name when a ref carries neither id nor notation', () => {
    const interaction = createBoardInteraction();
    interaction.setValidElements([{ id: -1, ref: { name: 'north-gate' } }], () => {});

    expect(interaction.isSelectableElement({ id: 3, name: 'north-gate' })).toBe(true);
    expect(interaction.isSelectableElement({ id: 3, name: 'south-gate' })).toBe(false);
  });

  it('a computed reading a lookup follows a new candidate list', async () => {
    const interaction = createBoardInteraction();
    const isA1 = computed(() => interaction.isSelectableElement({ notation: 'a1' }));
    expect(isA1.value).toBe(false);

    interaction.setValidElements([{ id: -1, ref: { notation: 'a1' } }], () => {});
    await nextTick();
    expect(isA1.value).toBe(true);

    interaction.clear();
    await nextTick();
    expect(isA1.value).toBe(false);
  });
});
