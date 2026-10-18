import { isDeepStrictEqual } from 'node:util';
import type { PlayerOptionDefinition } from '../../session/types.js';

/** A player option in boardsmith.json's list form, where its key is a field. */
export interface ConfigOptionDefinition {
  id?: string;
  name?: string;
  type: string;
  label: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * A game's player options: the ones its gameDefinition declares and the ones
 * boardsmith.json declares, by key (#992). `boardsmith dev` and the published
 * manifest both read this, so the dev lobby and the live one offer the same
 * list. A key the two declare differently is refused, since either answer
 * would silently drop the other.
 */
export function mergePlayerOptions(
  code: Record<string, PlayerOptionDefinition> | undefined,
  config: unknown,
): Record<string, PlayerOptionDefinition> {
  if (config !== undefined && !Array.isArray(config)) {
    throw new Error(
      'boardsmith.json "playerOptions" must be a list of options, each with an "id", ' +
        'e.g. [{ "id": "botLevel", "type": "select", "label": "Difficulty", "choices": ["easy", "hard"] }].',
    );
  }
  const merged = { ...code };
  ((config ?? []) as ConfigOptionDefinition[]).forEach(({ id, name, ...declared }, index) => {
    const key = id ?? name;
    if (!key) {
      throw new Error(`boardsmith.json playerOptions[${index}] has no "id". Give it one, e.g. "id": "botLevel".`);
    }
    const inCode = code?.[key];
    // Compared as JSON, the form the manifest publishes, so an undefined field in code is no difference.
    if (inCode !== undefined && !isDeepStrictEqual(JSON.parse(JSON.stringify(inCode)), declared)) {
      throw new Error(
        `The player option "${key}" is declared in both your gameDefinition and boardsmith.json, differently.\n` +
          `  gameDefinition: ${JSON.stringify(inCode)}\n` +
          `  boardsmith.json: ${JSON.stringify(declared)}\n` +
          `Declare "${key}" in one place, or make the two declarations the same.`,
      );
    }
    merged[key] = declared as unknown as PlayerOptionDefinition;
  });
  return merged;
}
