/**
 * Pure utility helpers for ActionPanel.
 * No Vue imports, no DOM access — these are testable pure functions.
 */

import type { ChoiceWithRefs } from '../../composables/useActionControllerTypes.js';

/**
 * D-03 anchored-choice filter.
 *
 * When a choice pick has mixed anchors (some choices have board refs, some don't),
 * the anchored choices are actioned directly on the board and must NOT be duplicated
 * in the ActionPanel. Only the unanchored remainder is shown in the panel.
 *
 * Rules:
 * - Only applies when pickType === 'choice'.
 * - If NO choices are anchored: all choices are returned unchanged (panel-only mode).
 * - If SOME choices are anchored: only the unanchored choices are returned.
 * - If ALL choices are anchored: returns empty array (defensive; D-02 footer v-if keeps
 *   the panel absent in this state so this empty result is never rendered).
 *
 * Element picks are never passed to this filter — they are always fully board-anchored
 * and never appear in the ActionPanel's choice list.
 */
export function filterAnchoredChoices(
  choices: ChoiceWithRefs[],
  pickType: string | undefined
): ChoiceWithRefs[] {
  if (pickType !== 'choice') return choices;

  const hasAnyAnchored = choices.some(c => (c.refs ?? []).length > 0);
  if (!hasAnyAnchored) return choices;

  return choices.filter(c => (c.refs ?? []).length === 0);
}
