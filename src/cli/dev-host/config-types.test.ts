import { describe, it, expect } from 'vitest';
import {
  coerceGameOptionValue,
  validateGameOptionSelection,
  GameOptionSelectionError,
  type DevOptionDef,
} from './config-types.js';

/**
 * CR-02 (161 code review): `--game-option`/lobby values always arrive as raw
 * strings — this is the single shared coercion boundary both `dev.ts` (CLI
 * flags) and `multiplayer-host.ts` (`configure` wire messages) call through,
 * so a unit test here proves the fix for both callers at once.
 */

const numberOpt: DevOptionDef = { id: 'rounds', type: 'number', default: 3 };
const boolOpt: DevOptionDef = { id: 'hardMode', type: 'boolean', default: false };
const selectOpt: DevOptionDef = {
  id: 'level',
  type: 'select',
  default: 1,
  choices: [
    { value: 1, label: 'Level 1' },
    { value: 4, label: 'Level 4' },
  ],
};
const textOpt: DevOptionDef = { id: 'note', type: 'text', default: '' };

describe('coerceGameOptionValue (CR-02)', () => {
  it('coerces a numeric string to a real number', () => {
    expect(coerceGameOptionValue(numberOpt, '5')).toBe(5);
  });

  it('throws an actionable error naming the option + expected type for an uncoercible number', () => {
    expect(() => coerceGameOptionValue(numberOpt, 'abc')).toThrow(GameOptionSelectionError);
    expect(() => coerceGameOptionValue(numberOpt, 'abc')).toThrow(/"rounds"/);
    expect(() => coerceGameOptionValue(numberOpt, 'abc')).toThrow(/number/);
  });

  it('coerces "false"/"true" to real booleans, NOT JS-truthy strings', () => {
    expect(coerceGameOptionValue(boolOpt, 'false')).toBe(false);
    expect(coerceGameOptionValue(boolOpt, 'true')).toBe(true);
  });

  it('throws an actionable error for a boolean value that is neither "true" nor "false"', () => {
    expect(() => coerceGameOptionValue(boolOpt, 'nope')).toThrow(GameOptionSelectionError);
    expect(() => coerceGameOptionValue(boolOpt, 'nope')).toThrow(/"hardMode"/);
  });

  it('resolves a select option with NON-STRING declared choice values from a raw wire string', () => {
    expect(coerceGameOptionValue(selectOpt, '4')).toBe(4);
    expect(typeof coerceGameOptionValue(selectOpt, '4')).toBe('number');
  });

  it('leaves an already-typed (non-string) value untouched', () => {
    expect(coerceGameOptionValue(numberOpt, 5)).toBe(5);
    expect(coerceGameOptionValue(boolOpt, true)).toBe(true);
  });

  it('leaves a text option as-is', () => {
    expect(coerceGameOptionValue(textOpt, 'hello')).toBe('hello');
  });
});

describe('validateGameOptionSelection (CR-02: coerces IN PLACE before validating)', () => {
  const declared = [numberOpt, boolOpt, selectOpt, textOpt];

  it('mutates the selection object with typed values on success', () => {
    const selection: Record<string, unknown> = { rounds: '5', hardMode: 'false', level: '4' };
    validateGameOptionSelection(declared, selection);
    expect(selection.rounds).toBe(5);
    expect(selection.hardMode).toBe(false);
    expect(selection.level).toBe(4);
  });

  it('still rejects a select value not among the (coerced) declared choices', () => {
    const selection: Record<string, unknown> = { level: '99' };
    expect(() => validateGameOptionSelection(declared, selection)).toThrow(GameOptionSelectionError);
    expect(() => validateGameOptionSelection(declared, selection)).toThrow(/"level"/);
  });

  it('still exempts the reserved playerCount key from coercion/validation', () => {
    const selection: Record<string, unknown> = { playerCount: 3 };
    expect(() => validateGameOptionSelection(declared, selection)).not.toThrow();
    expect(selection.playerCount).toBe(3);
  });
});
