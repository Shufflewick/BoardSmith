/**
 * Pure utility helpers for ActionPanel.
 * No Vue imports, no DOM access — these are testable pure functions.
 */

import type { ChoiceWithRefs, ValidElement } from '../../composables/useActionControllerTypes.js';
import { MAX_FLAT_CHOICE_CANDIDATES } from '../../../engine/element/action-metadata.js';

/**
 * D-03 anchored-choice splitter.
 *
 * When a choice pick has mixed anchors (some choices have NOTATION board refs,
 * some don't), notation-anchored choices are actioned directly on the board
 * by clicking the matching grid cell. Previously these were filtered out of the
 * ActionPanel, creating a dead-end for keyboard/screen-reader users.
 *
 * This function PARTITIONS instead of filtering — anchored choices are never
 * dropped. The `primary` array goes to the panel's regular choice buttons.
 * The `anchored` array is rendered as a focusable secondary list of <button>
 * elements whose activation calls triggerElementSelect, providing parity.
 *
 * IMPORTANT — Only NOTATION refs count as "anchored":
 *   - Notation ref { ref: { notation: 'a5' } }: the board grid renders and makes
 *     this cell clickable. Clicking it selects the choice. → anchored set.
 *   - Id-only ref { ref: { id: 10 } }: the board highlights the element for
 *     visual emphasis but the element is NOT a board selection surface (the grid
 *     matches by notation, not by id; id refs are highlight hints). → primary set.
 *
 * Examples:
 *   Checkers destination (notation refs): primary empty, all in anchored → secondary list.
 *   Go Fish rank (id-only refs for card highlighting): all in primary → footer is the surface.
 *
 * Rules:
 * - Only applies when pickType === 'choice'. Other pick types: all choices → primary.
 * - If NO choices are notation-anchored: all choices in primary, anchored empty.
 * - If SOME choices are notation-anchored: non-anchored → primary, anchored → anchored.
 * - If ALL choices are notation-anchored: primary empty, all in anchored (secondary list shown).
 */
export function splitAnchoredChoices(
  choices: ChoiceWithRefs[],
  pickType: string | undefined
): { primary: ChoiceWithRefs[]; anchored: ChoiceWithRefs[] } {
  if (pickType !== 'choice') return { primary: choices, anchored: [] };

  // A choice is "anchored" only when it has a ref with a NOTATION value.
  // Id-only refs indicate board highlighting, not a clickable board selection surface.
  const isNotationAnchored = (c: ChoiceWithRefs): boolean =>
    (c.refs ?? []).some(r => r.ref.notation !== undefined);

  const primary: ChoiceWithRefs[] = [];
  const anchored: ChoiceWithRefs[] = [];
  for (const c of choices) {
    if (isNotationAnchored(c)) {
      anchored.push(c);
    } else {
      primary.push(c);
    }
  }
  return { primary, anchored };
}

/**
 * #172 — should the panel hand this element pick to the board?
 *
 * The Action Panel presents choices as a hierarchy a person walks with a few
 * buttons. It has no search box and no typed input, by decision: those are the
 * two things that let a UI quietly diverge from what the engine enumerates.
 * What it must therefore never do is render a candidate set so large that the
 * "list" is really an unlabelled grid — Hex's fifty empty cells are the case
 * this exists for.
 *
 * When every candidate carries a board ref, the board is already drawing all of
 * them, and it is the better surface: the cells are laid out in the geometry the
 * choice actually has. So the panel renders the prompt and ONE control that
 * hands keyboard focus to the board, instead of fifty buttons.
 *
 * Two conditions are strict, and both are about not losing a choice:
 * - Only element / elements picks. A `choice` pick's values are not board
 *   elements; `splitAnchoredChoices` handles those, and it partitions rather
 *   than defers precisely so nothing is dropped.
 * - EVERY candidate must carry a ref. One candidate without one would be
 *   reachable from neither surface, which is the divergence bug this rule
 *   exists to forbid, not a rounding error.
 *
 * This is not a hidden option or a filter: the board offers exactly the same
 * enumeration the panel would have, and the handoff carries focus with it
 * (`requestBoardFocus`), so the keyboard path is continuous.
 */
export function shouldDeferElementPickToBoard(
  pickType: string | undefined,
  validElements: ValidElement[],
  threshold: number = MAX_FLAT_CHOICE_CANDIDATES,
): boolean {
  if (pickType !== 'element' && pickType !== 'elements') return false;
  if (validElements.length <= threshold) return false;
  return validElements.every((e) => (e.refs ?? []).length > 0);
}

/**
 * The length rule of a text pick, as a sentence.
 *
 * #229 reported this rendering as `(?-1000 chars)`: the hint was built by
 * interpolating `minLength ?? '?'` and `maxLength ?? '?'` into a range, and
 * `enterText` always sets a maximum while most fields set no minimum -- so the
 * commonest field in the library showed the player a question mark where a
 * number belongs and never said the one thing it was there to say.
 *
 * A range is only a range when there are two ends. With one end this states the
 * bound it has, and with neither it says nothing at all rather than rendering an
 * empty pair of brackets.
 *
 * It is a function rather than template expressions so the single-line field and
 * the multiline field cannot drift into two different sentences -- which was the
 * second half of the report, since fixing one and leaving the other is how the
 * two representations of one pick start disagreeing.
 *
 * Whole words, not "chars": the hint is bound to the field through
 * `aria-describedby`, so it is read aloud.
 */
export function textLengthHint(rules: {
  minLength?: number;
  maxLength?: number;
}): string | undefined {
  const { minLength, maxLength } = rules;
  if (minLength !== undefined && maxLength !== undefined) {
    return `${minLength} to ${maxLength} characters`;
  }
  if (maxLength !== undefined) return `up to ${maxLength} characters`;
  if (minLength !== undefined) return `at least ${minLength} characters`;
  return undefined;
}

/**
 * The range rule of a number pick, as a sentence.
 *
 * #234 reported the same defect `textLengthHint` was written for, on the pick
 * two lines above it in the panel: the hint interpolated `min ?? '?'` and
 * `max ?? '?'` into a range unconditionally, so `enterNumber('waste', { min: 1,
 * integer: true })` rendered `(1-?, integer)`. A range is only a range when it
 * has two ends; with one end this states the end it has.
 *
 * "whole numbers" rather than "integer": the hint is a sentence a player reads,
 * and it is the only place the `step="1"` on the field is said in words -- so an
 * unbounded integer pick states the rule alone rather than saying nothing, which
 * is what the unconditional range did once both bounds were absent.
 */
export function numberRangeHint(rules: {
  min?: number;
  max?: number;
  integer?: boolean;
}): string | undefined {
  const { min, max, integer } = rules;
  const range =
    min !== undefined && max !== undefined ? `${min} to ${max}`
    : max !== undefined ? `up to ${max}`
    : min !== undefined ? `at least ${min}`
    : undefined;
  if (range === undefined) return integer ? 'whole numbers' : undefined;
  return integer ? `${range}, whole numbers` : range;
}
