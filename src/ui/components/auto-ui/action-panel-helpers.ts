/**
 * Pure utility helpers for ActionPanel.
 * No Vue imports, no DOM access — these are testable pure functions.
 */

import type { ChoiceWithRefs } from '../../composables/useActionControllerTypes.js';

/**
 * D-03 anchored-choice filter.
 *
 * When a choice pick has mixed anchors (some choices have NOTATION board refs,
 * some don't), the notation-anchored choices are actioned directly on the board
 * by clicking the matching grid cell — they must NOT be duplicated in the
 * ActionPanel. Only the unanchored remainder is shown in the panel.
 *
 * IMPORTANT — Only NOTATION refs count as "anchored":
 *   - Notation ref { ref: { notation: 'a5' } }: the board grid renders and makes
 *     this cell clickable. Clicking it selects the choice. → FILTER from panel.
 *   - Id-only ref { ref: { id: 10 } }: the board highlights the element for
 *     visual emphasis but the element is NOT a board selection surface (the grid
 *     matches by notation, not by id; id refs are highlight hints). → KEEP in panel.
 *
 * Examples:
 *   Checkers destination (notation refs): all filtered → board is the surface.
 *   Go Fish rank (id-only refs for card highlighting): kept → footer is the surface.
 *
 * Rules:
 * - Only applies when pickType === 'choice'.
 * - If NO choices are notation-anchored: all choices returned unchanged (panel-only mode).
 * - If SOME choices are notation-anchored: only the non-notation-anchored returned.
 * - If ALL choices are notation-anchored: returns empty array (defensive; D-02 footer
 *   v-if keeps panel absent in this state so this empty result is never rendered).
 *
 * Element picks are never passed to this filter — they are always fully board-anchored
 * and never appear in the ActionPanel's choice list.
 */
export function filterAnchoredChoices(
  choices: ChoiceWithRefs[],
  pickType: string | undefined
): ChoiceWithRefs[] {
  if (pickType !== 'choice') return choices;

  // A choice is "anchored" only when it has a ref with a NOTATION value.
  // Id-only refs indicate board highlighting, not a clickable board selection surface.
  const isNotationAnchored = (c: ChoiceWithRefs): boolean =>
    (c.refs ?? []).some(r => r.ref.notation !== undefined);

  const hasAnyAnchored = choices.some(isNotationAnchored);
  if (!hasAnyAnchored) return choices;

  return choices.filter(c => !isNotationAnchored(c));
}
