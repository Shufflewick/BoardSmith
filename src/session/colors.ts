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
  /** Always "Color": the lobby builds this option from the palette, and reads no other label (#1304). */
  label: 'Color';
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

/**
 * `colorPalette` entries as choices: a plain hex string, or an object naming its
 * hex as `value`, `hex` or `color` and its label as `label` or `name` (the hex
 * when it has neither). An object naming no hex is left out and returned in `unnamed`.
 */
export function paletteChoices(palette: ReadonlyArray<string | object>): { choices: ColorChoice[]; unnamed: object[] } {
  const choices: ColorChoice[] = [];
  const unnamed: object[] = [];
  for (const item of palette) {
    if (typeof item === 'string') {
      choices.push({ value: item, label: item });
      continue;
    }
    const entry = item as Record<string, unknown>;
    const hex = (entry.value ?? entry.hex ?? entry.color) as string | undefined;
    if (hex === undefined) {
      unnamed.push(item);
      continue;
    }
    choices.push({ value: hex, label: (entry.label ?? entry.name ?? hex) as string });
  }
  return { choices, unnamed };
}

/**
 * Each seat's colour (#1569): the one it chose, else the first `palette` colour
 * no seat chose or was dealt before it. While the palette has a colour for
 * every seat, a colour an earlier seat chose is dealt again, so seats differ;
 * past that they may share, and a seat left none stays undefined.
 */
export function dealSeatColors(chosen: ReadonlyArray<string | undefined>, palette: readonly string[]): Array<string | undefined> {
  const apart = palette.length >= chosen.length;
  const wanted = apart ? chosen.map((color, index) => (chosen.indexOf(color) === index ? color : undefined)) : chosen;
  const taken = new Set(wanted);
  return wanted.map((color) => {
    if (color !== undefined) return color;
    const free = palette.find((c) => !taken.has(c));
    taken.add(free);
    return free;
  });
}

/**
 * The `colors` and `colorLabels` game options that seat a `playerCount` table in
 * boardsmith.json's `colorPalette` as the dev host seats it, or none when it
 * declares no palette, so a game built without a host gets the colours real play gives (#1552).
 */
export function paletteGameOptions(
  colorPalette: unknown,
  playerCount: number,
): { colors?: string[]; colorLabels?: Record<string, string> } {
  if (colorPalette === undefined) return {};
  if (!Array.isArray(colorPalette)) {
    throw new Error(
      'boardsmith.json\'s "colorPalette" must be a list of { "id", "hex", "label" } entries ' +
        '(e.g. { "id": "red", "hex": "#e74c3c", "label": "Red" }), so players cannot be given its colours. Fix the list.',
    );
  }
  const { choices } = paletteChoices(colorPalette);
  // The dev host seats every player in the engine palette when this one cannot colour them all.
  if (choices.length < playerCount) return {};
  return {
    colors: choices.slice(0, playerCount).map((choice) => choice.value),
    colorLabels: Object.fromEntries(choices.map((choice) => [choice.value, choice.label])),
  };
}
