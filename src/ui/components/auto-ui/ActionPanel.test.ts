/**
 * Tests for ActionPanel helpers and D-03 anchored-choice filtering.
 *
 * The D-03 filter (filterAnchoredChoices) is extracted as a pure function so it
 * can be tested without mounting the component. This is the "pit of success" design:
 * pure functions are trivially testable.
 *
 * Coverage:
 * - Mixed-anchor choice pick (notation refs): notation choices excluded, others kept
 * - Id-only ref choices: KEPT in panel (id refs are highlighting hints, not click targets)
 * - All-unanchored choice pick: all choices kept (panel-only mode)
 * - All notation-anchored: returns empty (board handles all selections; defensive)
 * - Non-choice pick type: filter does not apply (element/number/text picks pass through)
 *
 * D-03 anchor semantics (plan 04 clarification):
 *   NOTATION refs (e.g., { notation: 'a5' }) → anchored → filtered from panel
 *     → board grid makes the cell clickable; user clicks board to choose.
 *   Id-only refs (e.g., { id: 10 }) → NOT anchored → KEPT in panel
 *     → board HIGHLIGHTS the element but it is not a click selection surface;
 *       panel buttons are the selection surface (Go Fish rank pick).
 */

import { describe, it, expect } from 'vitest';
import { filterAnchoredChoices } from './action-panel-helpers.js';
import type { ChoiceWithRefs } from '../../composables/useActionControllerTypes.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Panel-only choices (no refs at all)
const unanchored1: ChoiceWithRefs = { value: 'a', display: 'Option A' };
const unanchored2: ChoiceWithRefs = { value: 'b', display: 'Option B', refs: [] };

// Id-only ref choices (Go Fish style — highlighting, NOT board-clickable)
// These must STAY in the panel (not filtered) because clicking the card
// in the hand does not select the rank; the panel button does.
const idOnlyRef1: ChoiceWithRefs = {
  value: 'A',
  display: 'Aces',
  refs: [{ ref: { id: 10 }, role: 'target' }],
};
const idOnlyRef2: ChoiceWithRefs = {
  value: '7',
  display: 'Sevens',
  refs: [{ ref: { id: 11 }, role: 'target' }],
};

// Notation ref choices (Checkers style — truly board-clickable)
// These ARE filtered from the panel because the board grid can select them directly.
const notationRef1: ChoiceWithRefs = {
  value: { toNotation: 'a5' },
  display: 'a5',
  refs: [{ ref: { notation: 'a5' }, role: 'target' }],
};
const notationRef2: ChoiceWithRefs = {
  value: { toNotation: 'c5' },
  display: 'c5',
  refs: [{ ref: { notation: 'c5' }, role: 'target' }],
};

// ---------------------------------------------------------------------------
// filterAnchoredChoices (D-03)
// ---------------------------------------------------------------------------

describe('filterAnchoredChoices (D-03)', () => {
  describe('choice pick with mixed notation anchors', () => {
    it('filters notation-ref choices and keeps unanchored ones', () => {
      const choices = [unanchored1, notationRef1, unanchored2, notationRef2];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(2);
      expect(result).toContain(unanchored1);
      expect(result).toContain(unanchored2);
      expect(result).not.toContain(notationRef1);
      expect(result).not.toContain(notationRef2);
    });
  });

  describe('id-only ref choices (Go Fish rank / highlight-only)', () => {
    it('keeps id-only ref choices in the panel (not board-anchored)', () => {
      // Go Fish rank choices have id-only refs linking to card elements for visual
      // highlighting. The board cannot "click" these selections (grid matches by notation,
      // not by id). The panel buttons are the selection surface for these choices.
      const choices = [idOnlyRef1, idOnlyRef2];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(2);
      expect(result).toContain(idOnlyRef1);
      expect(result).toContain(idOnlyRef2);
    });

    it('keeps id-only ref choices even when mixed with unanchored choices', () => {
      const choices = [unanchored1, idOnlyRef1, unanchored2, idOnlyRef2];
      const result = filterAnchoredChoices(choices, 'choice');
      // No notation refs → hasAnyAnchored = false → all returned unchanged
      expect(result).toHaveLength(4);
      expect(result).toContain(unanchored1);
      expect(result).toContain(idOnlyRef1);
      expect(result).toContain(unanchored2);
      expect(result).toContain(idOnlyRef2);
    });
  });

  describe('choice pick with no anchored choices (panel-only mode)', () => {
    it('keeps all choices when none are notation-anchored', () => {
      const choices = [unanchored1, unanchored2];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(2);
      expect(result).toContain(unanchored1);
      expect(result).toContain(unanchored2);
    });
  });

  describe('choice pick where all choices are notation-anchored', () => {
    it('returns empty array (defensive — board handles all; D-02 footer v-if keeps panel absent)', () => {
      const choices = [notationRef1, notationRef2];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(0);
    });
  });

  describe('non-choice pick types', () => {
    it('does not filter for element picks (element picks are always board-anchored)', () => {
      // element picks never contain ChoiceWithRefs, but the filter must be a no-op regardless
      const choices = [notationRef1, notationRef2];
      const result = filterAnchoredChoices(choices, 'element');
      expect(result).toEqual(choices);
    });

    it('does not filter for elements picks', () => {
      const choices = [notationRef1, unanchored1];
      const result = filterAnchoredChoices(choices, 'elements');
      expect(result).toEqual(choices);
    });

    it('does not filter for number picks', () => {
      const choices = [notationRef1];
      const result = filterAnchoredChoices(choices, 'number');
      expect(result).toEqual(choices);
    });

    it('does not filter for text picks', () => {
      const choices = [notationRef1];
      const result = filterAnchoredChoices(choices, 'text');
      expect(result).toEqual(choices);
    });

    it('does not filter for undefined pick type', () => {
      const choices = [notationRef1, unanchored1];
      const result = filterAnchoredChoices(choices, undefined);
      expect(result).toEqual(choices);
    });
  });

  describe('refs edge cases', () => {
    it('treats a choice with an empty refs array as unanchored', () => {
      const emptyRefs: ChoiceWithRefs = { value: 'x', display: 'X', refs: [] };
      const choices = [emptyRefs, notationRef1];
      const result = filterAnchoredChoices(choices, 'choice');
      // notationRef1 is filtered; emptyRefs stays
      expect(result).toHaveLength(1);
      expect(result).toContain(emptyRefs);
    });

    it('treats a choice with no refs property as unanchored', () => {
      const noRefs: ChoiceWithRefs = { value: 'y', display: 'Y' };
      const choices = [noRefs, notationRef1];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(1);
      expect(result).toContain(noRefs);
    });

    it('id-only ref is not treated as anchored (stays with unanchored choices)', () => {
      // A mixed set where one choice has an id-only ref and another has no refs.
      // No notation refs present → hasAnyAnchored = false → all returned unchanged.
      const emptyRefs: ChoiceWithRefs = { value: 'x', display: 'X', refs: [] };
      const choices = [emptyRefs, idOnlyRef1];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(2);
      expect(result).toContain(emptyRefs);
      expect(result).toContain(idOnlyRef1);
    });
  });
});
