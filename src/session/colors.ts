/**
 * Player colour option for BoardSmith games. The default list is the engine's
 * `DEFAULT_COLOR_PALETTE` with its names, the one player-colour palette.
 *
 * @example
 * ```typescript
 * import { createColorOption } from 'boardsmith/session';
 *
 * export const gameDefinition = {
 *   // ...
 *   playerOptions: {
 *     color: createColorOption(), // The engine palette
 *   },
 * };
 * ```
 *
 * Custom colours belong in boardsmith.json's `colorPalette`: that is the list the
 * live lobby uses, and `boardsmith dev` refuses a code-declared list that differs (#814).
 */

import { DEFAULT_COLOR_PALETTE, DEFAULT_COLOR_LABELS } from '../engine/element/game.js';

/**
 * Color choice for player options
 */
export interface ColorChoice {
  value: string;
  label: string;
}

/**
 * Player option definition for color picker
 */
export interface ColorOptionDefinition {
  type: 'color';
  label: string;
  choices: ColorChoice[];
}

/**
 * Create a color player option with the engine palette or custom colors
 *
 * @param colors - Custom color choices (optional, defaults to the engine's DEFAULT_COLOR_PALETTE, named)
 * @param label - Label for the option (optional, defaults to 'Color')
 * @returns A player option definition for use in gameDefinition.playerOptions
 *
 * @example
 * ```typescript
 * playerOptions: {
 *   color: createColorOption(), // The engine palette
 * }
 * ```
 *
 * A custom `colors` list must equal boardsmith.json's `colorPalette`, the list the
 * live lobby uses; `boardsmith dev` refuses one that differs (#814).
 */
export function createColorOption(
  colors?: readonly ColorChoice[],
  label = 'Color'
): ColorOptionDefinition {
  return {
    type: 'color' as const,
    label,
    choices: colors
      ? [...colors]
      : DEFAULT_COLOR_PALETTE.map((value) => ({ value, label: DEFAULT_COLOR_LABELS[value]! })),
  };
}
