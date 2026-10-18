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

type Option = Record<string, unknown>;

const isPair = (c: unknown) =>
  typeof c === 'object' && c !== null && typeof (c as Option).value === 'string' && typeof (c as Option).label === 'string';

function choiceProblems(name: string, option: Option): string[] {
  const { type, default: initial, choices } = option;
  if (typeof initial !== 'string') return [`${name} needs a string "default".`];
  if (!Array.isArray(choices) || choices.length === 0 || !choices.every(isPair)) {
    return [`${name} needs "choices": a non-empty list of { "value", "label" } strings, e.g. [{ "value": "easy", "label": "Easy" }].`];
  }
  const values = choices.map((c: Option) => c.value);
  // The platform lets an exclusive default name a seat ("last") rather than a choice.
  return type === 'select' && !values.includes(initial)
    ? [`${name} has default "${initial}", which is none of its choices (${values.join(', ')}).`]
    : [];
}

function numberProblems(name: string, { default: initial, min, max, step }: Option): string[] {
  if (typeof initial !== 'number') return [`${name} needs a number "default".`];
  if ([min, max, step].some((n) => n !== undefined && typeof n !== 'number')) {
    return [`${name} needs "min", "max" and "step", where given, to be numbers.`];
  }
  if (typeof step === 'number' && step <= 0) return [`${name} needs a "step" above 0.`];
  const outside = (typeof min === 'number' && initial < min) || (typeof max === 'number' && initial > max);
  return outside ? [`${name} has default ${initial}, outside ${String(min)} to ${String(max)}.`] : [];
}

/** What each type the platform's manifest accepts needs (ShufflewickPub games/src/manifest-schema.ts). */
const TYPE_CHECKS: Record<string, (name: string, option: Option) => string[]> = {
  number: numberProblems,
  select: choiceProblems,
  exclusive: choiceProblems,
  boolean: (name, option) => (typeof option.default === 'boolean' ? [] : [`${name} needs a true or false "default".`]),
};

/** Why the platform's manifest could not carry this player option; empty when it can. */
function publishProblems(key: string, option: Option): string[] {
  const name = `Player option "${key}"`;
  const check = TYPE_CHECKS[option.type as string];
  if (!check) {
    return [`${name} has type ${JSON.stringify(option.type)}, which the lobby has no control for. Use "number", "select", "boolean" or "exclusive".`];
  }
  const label = typeof option.label === 'string' && option.label !== '' ? [] : [`${name} needs a "label".`];
  return [...label, ...check(name, option)];
}

/**
 * A game's player options: the ones its gameDefinition declares and the ones
 * boardsmith.json declares, by key (#992). `boardsmith dev` and the published
 * manifest both read this, so the dev lobby and the live one offer the same
 * list. A key the two declare differently is refused, since either answer
 * would silently drop the other, and so is an option the platform's manifest
 * cannot carry, since dev would offer what the live lobby cannot. Colour is
 * left out: the lobby builds it from `colorPalette` (#814).
 */
export function mergePlayerOptions(
  code: Record<string, PlayerOptionDefinition> | undefined,
  config: unknown,
): Record<string, PlayerOptionDefinition> {
  if (config !== undefined && !Array.isArray(config)) {
    throw new Error(
      'boardsmith.json "playerOptions" must be a list of options, each with an "id", ' +
        'e.g. [{ "id": "botLevel", "type": "select", "label": "Difficulty", "default": "easy", ' +
        '"choices": [{ "value": "easy", "label": "Easy" }] }].',
    );
  }
  const { color: _color, ...merged } = { ...code };
  ((config ?? []) as ConfigOptionDefinition[]).forEach(({ id, name, ...declared }, index) => {
    const key = id ?? name;
    if (!key) {
      throw new Error(`boardsmith.json playerOptions[${index}] has no "id". Give it one, e.g. "id": "botLevel".`);
    }
    if (key === 'color') return;
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
  const problems = Object.entries(merged).flatMap(([key, option]) => publishProblems(key, option as unknown as Option));
  if (problems.length > 0) {
    throw new Error(
      `The live lobby could not offer these player options, so neither dev nor build will:\n  ${problems.join('\n  ')}`,
    );
  }
  return merged;
}
