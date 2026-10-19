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
 * Custom colours belong only in boardsmith.json's `colorPalette`: that is the list
 * the live lobby uses (#814, #994).
 */

import { DEFAULT_COLOR_PALETTE, DEFAULT_COLOR_LABELS } from '../engine/element/seat-defaults.js';

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
 * Create a color player option with the engine palette. A game's own colours
 * belong in boardsmith.json's `colorPalette`, the one list dev and the live
 * lobby both use (#994).
 *
 * @returns A player option definition for use in gameDefinition.playerOptions
 *
 * @example
 * ```typescript
 * playerOptions: {
 *   color: createColorOption(), // The engine palette
 * }
 * ```
 */
export function createColorOption(): ColorOptionDefinition {
  return {
    type: 'color' as const,
    label: 'Color',
    choices: DEFAULT_COLOR_PALETTE.map((value) => ({ value, label: DEFAULT_COLOR_LABELS[value]! })),
  };
}
