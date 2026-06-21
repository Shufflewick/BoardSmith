/**
 * Tests for ActionPanel helpers and D-03 anchored-choice filtering.
 *
 * The D-03 filter (filterAnchoredChoices) is extracted as a pure function so it
 * can be tested without mounting the component. This is the "pit of success" design:
 * pure functions are trivially testable.
 *
 * Coverage:
 * - Mixed-anchor choice pick: anchored choices excluded, unanchored choices kept
 * - All-unanchored choice pick: all choices kept (panel-only mode)
 * - All-anchored choice pick: all filtered out (defensive; D-02 footer v-if keeps
 *   panel absent in practice — this is the empty-state fallback)
 * - Non-choice pick type: filter does not apply (element/number/text picks pass through)
 */

import { describe, it, expect } from 'vitest';
import { filterAnchoredChoices } from './action-panel-helpers.js';
import type { ChoiceWithRefs } from '../../composables/useActionControllerTypes.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const unanchored1: ChoiceWithRefs = { value: 'a', display: 'Option A' };
const unanchored2: ChoiceWithRefs = { value: 'b', display: 'Option B', refs: [] };
const anchored1: ChoiceWithRefs = {
  value: 1,
  display: 'Target A',
  refs: [{ ref: { id: 10 }, role: 'target' }],
};
const anchored2: ChoiceWithRefs = {
  value: 2,
  display: 'Target B',
  refs: [{ ref: { id: 11 }, role: 'target' }],
};

// ---------------------------------------------------------------------------
// filterAnchoredChoices (D-03)
// ---------------------------------------------------------------------------

describe('filterAnchoredChoices (D-03)', () => {
  describe('choice pick with mixed anchors', () => {
    it('excludes anchored choices and keeps only unanchored ones', () => {
      const choices = [unanchored1, anchored1, unanchored2, anchored2];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(2);
      expect(result).toContain(unanchored1);
      expect(result).toContain(unanchored2);
      expect(result).not.toContain(anchored1);
      expect(result).not.toContain(anchored2);
    });
  });

  describe('choice pick with no anchored choices (panel-only mode)', () => {
    it('keeps all choices when none are anchored', () => {
      const choices = [unanchored1, unanchored2];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(2);
      expect(result).toContain(unanchored1);
      expect(result).toContain(unanchored2);
    });
  });

  describe('choice pick where all choices are anchored', () => {
    it('returns empty array (defensive — D-02 footer v-if keeps panel absent)', () => {
      const choices = [anchored1, anchored2];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(0);
    });
  });

  describe('non-choice pick types', () => {
    it('does not filter for element picks (element picks are always board-anchored)', () => {
      // element picks never contain ChoiceWithRefs, but the filter must be a no-op regardless
      const choices = [anchored1, anchored2];
      const result = filterAnchoredChoices(choices, 'element');
      expect(result).toEqual(choices);
    });

    it('does not filter for elements picks', () => {
      const choices = [anchored1, unanchored1];
      const result = filterAnchoredChoices(choices, 'elements');
      expect(result).toEqual(choices);
    });

    it('does not filter for number picks', () => {
      const choices = [anchored1];
      const result = filterAnchoredChoices(choices, 'number');
      expect(result).toEqual(choices);
    });

    it('does not filter for text picks', () => {
      const choices = [anchored1];
      const result = filterAnchoredChoices(choices, 'text');
      expect(result).toEqual(choices);
    });

    it('does not filter for undefined pick type', () => {
      const choices = [anchored1, unanchored1];
      const result = filterAnchoredChoices(choices, undefined);
      expect(result).toEqual(choices);
    });
  });

  describe('refs edge cases', () => {
    it('treats a choice with an empty refs array as unanchored', () => {
      const emptyRefs: ChoiceWithRefs = { value: 'x', display: 'X', refs: [] };
      const choices = [emptyRefs, anchored1];
      const result = filterAnchoredChoices(choices, 'choice');
      // anchored1 is filtered out; emptyRefs stays
      expect(result).toHaveLength(1);
      expect(result).toContain(emptyRefs);
    });

    it('treats a choice with no refs property as unanchored', () => {
      const noRefs: ChoiceWithRefs = { value: 'y', display: 'Y' };
      const choices = [noRefs, anchored1];
      const result = filterAnchoredChoices(choices, 'choice');
      expect(result).toHaveLength(1);
      expect(result).toContain(noRefs);
    });
  });
});
