/**
 * Pure utility helpers for ActionPanel.
 * No Vue imports, no DOM access — these are testable pure functions.
 */

import type { ChoiceWithRefs, ValidElement } from '../../composables/useActionControllerTypes.js';

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
 * The largest flat candidate set the Action Panel will render as buttons.
 *
 * 24 is where a wrapping row of pills stops being a sentence and becomes an
 * unlabelled grid the player must scan — roughly two full rows in the action bar
 * at a normal window width — and it is past the point where a screen-reader user
 * can hold the list in their head while walking it.
 *
 * It clears the reference games by a wide margin. Measured on 2026-09-05 by
 * running the audit over hex, go-fish, checkers, chess, cribbage, seven and
 * polyhedral-potions, the largest UNANCHORED flat set any of them ever offers is
 * 11 (seven's `discard.card`); the largest anchored one is Hex's 49 empty cells,
 * which is exactly the set that should go to the board rather than the panel.
 * Lacuna's planned hundreds of verbs trip it decisively.
 *
 * The number is a judgement about reading, not a measurement, so it is stated
 * once, here, and read by both the panel and `boardsmith validate`'s
 * choice-cardinality audit.
 */
export const MAX_FLAT_CHOICE_CANDIDATES = 24;

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
