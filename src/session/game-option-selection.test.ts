/**
 * `selectGameOptions` is the one way a player's (or any client's) choice of
 * game options becomes something the session will store or hand to a game
 * constructor. It admits only the options the game declared, typed as
 * declared, and never a field the engine or the host mints itself: `seed`,
 * `elementIdKey` (#447), `playerCount`, `playerConfigs` and the rest. The
 * dev host's `configure` message, its `--game-option` flag, `simulate` and
 * the production lobby all go through it, so this file proves the rule once
 * for every caller.
 */
import { describe, it, expect } from 'vitest';
import {
  HOST_OWNED_GAME_OPTION_KEYS,
  GameOptionSelectionError,
  assertDeclarableGameOptions,
  selectGameOptions,
} from './game-option-selection.js';
import type { GameOptionDefinition } from '../types/protocol.js';

const declared: Record<string, GameOptionDefinition> = {
  rounds: { type: 'number', label: 'Rounds', default: 3 },
  hardMode: { type: 'boolean', label: 'Hard mode', default: false },
  level: {
    type: 'select',
    label: 'Level',
    default: 1,
    choices: [
      { value: 1, label: 'Level 1' },
      { value: 4, label: 'Level 4' },
    ],
  },
};

describe('selectGameOptions keeps engine-owned and host-owned fields out of a selection', () => {
  it.each(['seed', 'elementIdKey', 'playerCount', 'playerNames', 'playerConfigs', 'worldMode', 'randomness'])(
    'refuses %s by name, saying who owns it',
    (key) => {
      expect(() => selectGameOptions(declared, { [key]: 'chosen' })).toThrow(GameOptionSelectionError);
      expect(() => selectGameOptions(declared, { [key]: 'chosen' })).toThrow(new RegExp(`"${key}"`));
      expect(() => selectGameOptions(declared, { [key]: 'chosen' })).toThrow(/cannot be chosen/);
    },
  );

  it('refuses an engine-owned key even when the game declares no options at all', () => {
    expect(() => selectGameOptions(undefined, { elementIdKey: '0123456789abcdef' })).toThrow(/"elementIdKey"/);
  });

  it('names every GameOptions field and every option the session itself supplies', () => {
    for (const key of ['playerCount', 'playerNames', 'seed', 'elementIdKey', 'colors', 'colorLabels', 'tutorial', 'randomness', 'worldMode', 'playerConfigs', 'playerOptions', 'playerIsBot', 'persist']) {
      expect(HOST_OWNED_GAME_OPTION_KEYS).toContain(key);
    }
  });
});

describe('selectGameOptions admits only what the game declared', () => {
  it('refuses an undeclared key and lists the declared ones', () => {
    expect(() => selectGameOptions(declared, { notARealOption: 'x' })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { notARealOption: 'x' })).toThrow(/"notARealOption"/);
    expect(() => selectGameOptions(declared, { notARealOption: 'x' })).toThrow(/rounds, hardMode, level/);
  });

  it('says so when the game declares nothing', () => {
    expect(() => selectGameOptions(undefined, { anything: 1 })).toThrow(/declares no game options/);
  });

  it('returns a copy holding only the chosen keys, never the input object', () => {
    const raw: Record<string, unknown> = { rounds: 5 };
    const selection = selectGameOptions(declared, raw);
    expect(selection).toEqual({ rounds: 5 });
    expect(selection).not.toBe(raw);
  });

  it('skips an option left undefined: an unset option is no choice', () => {
    expect(selectGameOptions(declared, { rounds: undefined, level: 4 })).toEqual({ level: 4 });
  });
});

describe('selectGameOptions reads client JSON by its own keys only', () => {
  it('refuses a name that every object inherits, as undeclared', () => {
    for (const name of ['toString', 'constructor', 'hasOwnProperty']) {
      const raw = JSON.parse(`{"${name}":"x"}`) as Record<string, unknown>;
      expect(() => selectGameOptions(declared, raw)).toThrow(GameOptionSelectionError);
      expect(() => selectGameOptions(declared, raw)).toThrow(new RegExp(`Unknown game option "${name}"`));
    }
  });

  it('refuses "__proto__", so a selection can never read a host-owned key through its prototype', () => {
    const raw = JSON.parse('{"__proto__":{"seed":"evil"},"rounds":1}') as Record<string, unknown>;
    expect(() => selectGameOptions(declared, raw)).toThrow(/Unknown game option "__proto__"/);
  });

  it('a declared option named like an inherited property is still a plain own key of the selection', () => {
    const odd = { ...declared, constructor: { type: 'number', label: 'Constructor' } } as Record<string, GameOptionDefinition>;
    const selection = selectGameOptions(odd, JSON.parse('{"constructor":"3"}') as Record<string, unknown>);
    expect(Object.hasOwn(selection, 'constructor')).toBe(true);
    expect(selection.constructor).toBe(3);
    expect(Object.getPrototypeOf(selection)).toBe(Object.prototype);
  });
});

describe('selectGameOptions refuses a value of the wrong type whatever its shape', () => {
  it.each([[[1, 2]], [true], [{ n: 1 }], [null], [NaN], [Infinity], [''], ['  ']])('number: %j is refused', (value) => {
    expect(() => selectGameOptions(declared, { rounds: value })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { rounds: value })).toThrow(/"rounds" must be a number/);
  });

  it.each([[1], [0], ['yes'], [[true]], [null], [{}]])('boolean: %j is refused', (value) => {
    expect(() => selectGameOptions(declared, { hardMode: value })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { hardMode: value })).toThrow(/"hardMode" must be true or false/);
  });

  it.each([[[1]], [{ value: 1 }], [null], ['1.0'], [true]])('select: %j is refused', (value) => {
    expect(() => selectGameOptions(declared, { level: value })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { level: value })).toThrow(/"level".*one of: 1, 4/);
  });
});

describe('selectGameOptions coerces wire strings to the declared type', () => {
  it('number: a numeric string becomes a number; anything else is refused by name', () => {
    expect(selectGameOptions(declared, { rounds: '5' })).toEqual({ rounds: 5 });
    expect(() => selectGameOptions(declared, { rounds: 'abc' })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { rounds: 'abc' })).toThrow(/"rounds".*number/);
  });

  it('boolean: "false" is false, not JS-truthy; another string is refused', () => {
    expect(selectGameOptions(declared, { hardMode: 'false' })).toEqual({ hardMode: false });
    expect(selectGameOptions(declared, { hardMode: 'true' })).toEqual({ hardMode: true });
    expect(() => selectGameOptions(declared, { hardMode: 'nope' })).toThrow(/"hardMode"/);
  });

  it('select: a string reaches a non-string declared choice; a value outside the choices is refused', () => {
    expect(selectGameOptions(declared, { level: '4' })).toEqual({ level: 4 });
    expect(() => selectGameOptions(declared, { level: '99' })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { level: 99 })).toThrow(/"level".*one of: 1, 4/);
  });

  it('leaves an already typed value untouched', () => {
    expect(selectGameOptions(declared, { rounds: 5, hardMode: true, level: 1 })).toEqual({ rounds: 5, hardMode: true, level: 1 });
  });
});

describe('a game cannot declare an option named for a field the host owns', () => {
  const clashing = { seed: { type: 'number', label: 'Seed' } } as unknown as Record<string, GameOptionDefinition>;

  it('assertDeclarableGameOptions refuses it by name', () => {
    expect(() => assertDeclarableGameOptions(clashing)).toThrow(/"seed"/);
    expect(() => assertDeclarableGameOptions(clashing)).toThrow(/rename/i);
    expect(() => assertDeclarableGameOptions(declared)).not.toThrow();
    expect(() => assertDeclarableGameOptions(undefined)).not.toThrow();
  });

  it('selectGameOptions refuses the declaration before reading any selection', () => {
    expect(() => selectGameOptions(clashing, {})).toThrow(/"seed"/);
  });
});
