/**
 * Pure utility helpers for ActionPanel.
 * No Vue imports, no DOM access — these are testable pure functions.
 */

import type { ChoiceWithRefs } from '../../composables/useActionControllerTypes.js';

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
