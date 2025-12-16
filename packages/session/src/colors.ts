/**
 * Standard player colors for BoardSmith games
 *
 * These colors are designed to:
 * - Work well on dark backgrounds
 * - Have consistent luminance across all colors
 * - Be visually distinct from each other
 *
 * @example
 * ```typescript
 * import { STANDARD_PLAYER_COLORS, createColorOption } from '@boardsmith/session';
 *
 * export const gameDefinition = {
 *   // ...
 *   playerOptions: {
 *     color: createColorOption(), // Uses standard colors
 *   },
 * };
 * ```
 *
 * @example Custom colors
 * ```typescript
 * import { createColorOption } from '@boardsmith/session';
 *
 * export const gameDefinition = {
 *   // ...
 *   playerOptions: {
 *     color: createColorOption([
 *       { value: '#ff0000', label: 'Red' },
 *       { value: '#00ff00', label: 'Green' },
 *     ]),
 *   },
 * };
 * ```
 */

/**
 * Color choice for player options
 */
export interface ColorChoice {
  value: string;
  label: string;
}

/**
 * Standard player colors - a cohesive palette with consistent luminance
 */
export const STANDARD_PLAYER_COLORS: readonly ColorChoice[] = [
  { value: '#e74c3c', label: 'Red' },
  { value: '#3498db', label: 'Blue' },
  { value: '#27ae60', label: 'Green' },
  { value: '#e67e22', label: 'Orange' },
  { value: '#9b59b6', label: 'Purple' },
  { value: '#f1c40f', label: 'Yellow' },
  { value: '#95a5a6', label: 'Black' },
  { value: '#ecf0f1', label: 'White' },
] as const;

/**
 * Default colors for 2-player games (Red vs Blue)
 */
export const DEFAULT_PLAYER_COLORS = ['#e74c3c', '#3498db'] as const;

/**
 * Player option definition for color picker
 */
export interface ColorOptionDefinition {
  type: 'color';
  label: string;
  choices: ColorChoice[];
}

/**
 * Create a color player option with standard or custom colors
 *
 * @param colors - Custom color choices (optional, defaults to STANDARD_PLAYER_COLORS)
 * @param label - Label for the option (optional, defaults to 'Color')
 * @returns A player option definition for use in gameDefinition.playerOptions
 *
 * @example
 * ```typescript
 * playerOptions: {
 *   color: createColorOption(), // Standard colors
 * }
 * ```
 *
 * @example Custom colors
 * ```typescript
 * playerOptions: {
 *   color: createColorOption([
 *     { value: '#ff0000', label: 'Fire' },
 *     { value: '#0000ff', label: 'Ice' },
 *   ], 'Team Color'),
 * }
 * ```
 */
export function createColorOption(
  colors?: readonly ColorChoice[],
  label = 'Color'
): ColorOptionDefinition {
  return {
    type: 'color' as const,
    label,
    choices: [...(colors ?? STANDARD_PLAYER_COLORS)],
  };
}
