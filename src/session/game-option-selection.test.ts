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

describe('selectGameOptions holds a number option to its declared min, max and step', () => {
  const bounded: Record<string, GameOptionDefinition> = {
    rounds: { type: 'number', label: 'Rounds', min: 1, max: 10 },
    bid: { type: 'number', label: 'Bid', min: 5, max: 50, step: 5 },
    floor: { type: 'number', label: 'Floor', min: -3 },
    ceiling: { type: 'number', label: 'Ceiling', max: 100 },
    even: { type: 'number', label: 'Even', step: 2 },
    tenths: { type: 'number', label: 'Tenths', min: 0, max: 1, step: 0.1 },
  };

  it('admits a value exactly at min and exactly at max', () => {
    expect(selectGameOptions(bounded, { rounds: 1 })).toEqual({ rounds: 1 });
    expect(selectGameOptions(bounded, { rounds: 10 })).toEqual({ rounds: 10 });
    expect(selectGameOptions(bounded, { floor: -3 })).toEqual({ floor: -3 });
    expect(selectGameOptions(bounded, { ceiling: 100 })).toEqual({ ceiling: 100 });
  });

  it('refuses a value above max, naming the option and its allowed range', () => {
    expect(() => selectGameOptions(bounded, { rounds: 1000 })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(bounded, { rounds: 11 })).toThrow(
      'Game option "rounds" must be between 1 and 10, got 11.',
    );
    expect(() => selectGameOptions(bounded, { ceiling: 100.5 })).toThrow(
      'Game option "ceiling" must be at most 100, got 100.5.',
    );
  });

  it('refuses a value below min, naming the option and its allowed range', () => {
    expect(() => selectGameOptions(bounded, { rounds: 0 })).toThrow(
      'Game option "rounds" must be between 1 and 10, got 0.',
    );
    expect(() => selectGameOptions(bounded, { floor: -4 })).toThrow(
      'Game option "floor" must be at least -3, got -4.',
    );
  });

  it('checks a wire string after it is read as a number', () => {
    expect(selectGameOptions(bounded, { rounds: '10' })).toEqual({ rounds: 10 });
    expect(() => selectGameOptions(bounded, { rounds: '1000' })).toThrow(/"rounds" must be between 1 and 10/);
  });

  it('admits values on the step counted from min, at both ends of the range', () => {
    expect(selectGameOptions(bounded, { bid: 5 })).toEqual({ bid: 5 });
    expect(selectGameOptions(bounded, { bid: 25 })).toEqual({ bid: 25 });
    expect(selectGameOptions(bounded, { bid: 50 })).toEqual({ bid: 50 });
  });

  it('refuses an off-step value, naming the step and where it counts from', () => {
    expect(() => selectGameOptions(bounded, { bid: 7 })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(bounded, { bid: 7 })).toThrow(
      'Game option "bid" must be in steps of 5 from 5 (5, 10, 15, ...), got 7.',
    );
  });

  it('counts the step from 0 when there is no min', () => {
    expect(selectGameOptions(bounded, { even: -4 })).toEqual({ even: -4 });
    expect(selectGameOptions(bounded, { even: 0 })).toEqual({ even: 0 });
    expect(() => selectGameOptions(bounded, { even: 3 })).toThrow(
      'Game option "even" must be in steps of 2 from 0 (0, 2, 4, ...), got 3.',
    );
  });

  it('admits a fractional step despite floating point rounding, and refuses what is between steps', () => {
    for (const v of [0, 0.1, 0.3, 0.7, 1]) {
      expect(selectGameOptions(bounded, { tenths: v })).toEqual({ tenths: v });
    }
    expect(() => selectGameOptions(bounded, { tenths: 0.15 })).toThrow(/"tenths" must be in steps of 0\.1 from 0 \(0, 0\.1, 0\.2, \.\.\.\), got 0\.15/);
  });

  it('refuses an off-step value far from where the step counts from', () => {
    expect(selectGameOptions(bounded, { even: 1000000000 })).toEqual({ even: 1000000000 });
    expect(() => selectGameOptions(bounded, { even: 1000000001 })).toThrow(/"even" must be in steps of 2/);
    expect(() => selectGameOptions(bounded, { even: 1000000000.5 })).toThrow(/"even" must be in steps of 2/);
    expect(() => selectGameOptions(bounded, { even: 500000000.5 })).toThrow(/"even" must be in steps of 2/);
    const wideTenths: Record<string, GameOptionDefinition> = { t: { type: 'number', label: 'T', step: 0.1 } };
    expect(selectGameOptions(wideTenths, { t: 100000000.1 })).toEqual({ t: 100000000.1 });
    expect(() => selectGameOptions(wideTenths, { t: 100000000.05 })).toThrow(/"t" must be in steps of 0\.1/);
  });

  it('admits every on-step value for a range of steps', () => {
    for (const step of [0.01, 0.05, 0.1, 0.25, 0.3, 0.5, 1, 2.5, 3, 7, 10]) {
      const defs: Record<string, GameOptionDefinition> = { v: { type: 'number', label: 'V', min: -5, step } };
      for (let i = 0; i <= 2000; i += 7) {
        const v = -5 + i * step;
        expect(selectGameOptions(defs, { v })).toEqual({ v });
      }
    }
  });

  it('checks range before step, so a far-off value is told the range', () => {
    expect(() => selectGameOptions(bounded, { bid: 1000 })).toThrow(/"bid" must be between 5 and 50, got 1000/);
  });
});

describe('a game cannot declare a number option no value could satisfy', () => {
  it('refuses a min above its max', () => {
    expect(() =>
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', min: 10, max: 1 } }),
    ).toThrow(/"rounds".*min 10.*max 1/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a step of %s', (step) => {
    expect(() => assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', step } })).toThrow(
      /"rounds".*step/,
    );
  });

  it('refuses a default outside its own min and max, blaming the game', () => {
    expect(() =>
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', min: 1, max: 10, default: 11 } }),
    ).toThrow(/This game declares number option "rounds" with default 11, .*between 1 and 10/);
    expect(() =>
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', min: 1, default: 0 } }),
    ).toThrow(/"rounds" with default 0, .*at least 1/);
  });

  it('refuses a default off its own step, blaming the game', () => {
    expect(() =>
      assertDeclarableGameOptions({ bid: { type: 'number', label: 'Bid', min: 5, step: 5, default: 7 } }),
    ).toThrow(/This game declares number option "bid" with default 7, .*steps of 5 from 5/);
  });

  it('admits a default exactly at min, at max and on step', () => {
    for (const d of [5, 25, 50]) {
      expect(() =>
        assertDeclarableGameOptions({ bid: { type: 'number', label: 'Bid', min: 5, max: 50, step: 5, default: d } }),
      ).not.toThrow();
    }
  });

  it('refuses a default that is not a finite number', () => {
    expect(() =>
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', default: Number.NaN } }),
    ).toThrow(/"rounds".*default/);
  });

  it('refuses a min or max that is not a finite number', () => {
    expect(() =>
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', min: Number.NaN } }),
    ).toThrow(/"rounds".*min/);
    expect(() =>
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', max: '10' as unknown as number } }),
    ).toThrow(/"rounds".*max/);
  });
});
