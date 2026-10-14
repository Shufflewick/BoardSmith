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
  assertPresetsSelectable,
  declaredGameOptionsOf,
  parseGameOptionList,
  selectDesignerGameOptions,
  selectGameOptions,
  withDeclaredGameOptions,
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

  it('returns a copy, never the input object', () => {
    const raw: Record<string, unknown> = { rounds: 5 };
    const selection = selectGameOptions(declared, raw);
    expect(selection).toEqual({ rounds: 5, hardMode: false, level: 1 });
    expect(selection).not.toBe(raw);
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
    const odd = { ...declared, constructor: { type: 'number', label: 'Constructor', default: 0 } } as Record<string, GameOptionDefinition>;
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
    expect(selectGameOptions(declared, { rounds: '5' })).toMatchObject({ rounds: 5 });
    expect(() => selectGameOptions(declared, { rounds: 'abc' })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { rounds: 'abc' })).toThrow(/"rounds".*number/);
  });

  it('boolean: "false" is false, not JS-truthy; another string is refused', () => {
    expect(selectGameOptions(declared, { hardMode: 'false' })).toMatchObject({ hardMode: false });
    expect(selectGameOptions(declared, { hardMode: 'true' })).toMatchObject({ hardMode: true });
    expect(() => selectGameOptions(declared, { hardMode: 'nope' })).toThrow(/"hardMode"/);
  });

  it('select: a string reaches a non-string declared choice; a value outside the choices is refused', () => {
    expect(selectGameOptions(declared, { level: '4' })).toMatchObject({ level: 4 });
    expect(() => selectGameOptions(declared, { level: '99' })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(declared, { level: 99 })).toThrow(/"level".*one of: 1, 4/);
  });

  it('leaves an already typed value untouched', () => {
    expect(selectGameOptions(declared, { rounds: 5, hardMode: true, level: 1 })).toMatchObject({ rounds: 5, hardMode: true, level: 1 });
  });
});

describe('selectGameOptions matches a select value by the choice-matching rule (#574)', () => {
  // A choice value may be an object, as game bundles and the dev host's lobby
  // already use (#572), so this declaration needs no cast (#593).
  const small = { width: 9, height: 9 };
  const large = { width: 19, height: 19, tiles: [{ kind: 'stone' }] };
  const board: Record<string, GameOptionDefinition> = {
    board: {
      type: 'select',
      label: 'Board',
      default: small,
      choices: [
        { value: small, label: 'Small' },
        { value: large, label: 'Large' },
      ],
    },
  };

  it('admits an object choice that crossed the wire as a different, equal object, returning the declared object', () => {
    const sent = JSON.parse(JSON.stringify({ board: large })) as Record<string, unknown>;
    expect(sent.board).not.toBe(large);
    expect(selectGameOptions(board, sent).board).toBe(large);
  });

  it('refuses the text "[object Object]": a string names a choice by its text only when the choice is not an object (#593)', () => {
    expect(() => selectGameOptions(board, { board: '[object Object]' })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(board, { board: '[object Object]' })).toThrow(/"board".*one of:/);
  });

  it('a direct match wins over a match by text (#593)', () => {
    const ambiguous: Record<string, GameOptionDefinition> = {
      pick: {
        type: 'select',
        label: 'Pick',
        default: 1,
        choices: [
          { value: 1, label: 'Number one' },
          { value: '1', label: 'Text one' },
        ],
      },
    };
    expect(selectGameOptions(ambiguous, { pick: '1' }).pick).toBe('1');
    expect(selectGameOptions(ambiguous, { pick: 1 }).pick).toBe(1);
  });

  it('freezes the declared choice it returns, deeply, so a game cannot change the declaration for the next game (#593)', () => {
    const chosen = selectGameOptions(board, { board: { width: 19, height: 19, tiles: [{ kind: 'stone' }] } }).board as typeof large;
    expect(() => {
      chosen.width = 5;
    }).toThrow(TypeError);
    expect(() => chosen.tiles.push({ kind: 'sand' })).toThrow(TypeError);
    expect(() => {
      chosen.tiles[0].kind = 'sand';
    }).toThrow(TypeError);
    expect(selectGameOptions(board, { board: { width: 19, height: 19, tiles: [{ kind: 'stone' }] } }).board).toBe(large);
  });

  it('still refuses an object that is not one of the choices', () => {
    expect(() => selectGameOptions(board, { board: { width: 13, height: 13 } })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(board, { board: { width: 13, height: 13 } })).toThrow(/"board".*one of:/);
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
    rounds: { type: 'number', label: 'Rounds', min: 1, max: 10, default: 1 },
    bid: { type: 'number', label: 'Bid', min: 5, max: 50, step: 5, default: 5 },
    floor: { type: 'number', label: 'Floor', min: -3, default: -3 },
    ceiling: { type: 'number', label: 'Ceiling', max: 100, default: 100 },
    even: { type: 'number', label: 'Even', step: 2, default: 0 },
    tenths: { type: 'number', label: 'Tenths', min: 0, max: 1, step: 0.1, default: 0 },
  };

  it('admits a value exactly at min and exactly at max', () => {
    expect(selectGameOptions(bounded, { rounds: 1 })).toMatchObject({ rounds: 1 });
    expect(selectGameOptions(bounded, { rounds: 10 })).toMatchObject({ rounds: 10 });
    expect(selectGameOptions(bounded, { floor: -3 })).toMatchObject({ floor: -3 });
    expect(selectGameOptions(bounded, { ceiling: 100 })).toMatchObject({ ceiling: 100 });
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
    expect(selectGameOptions(bounded, { rounds: '10' })).toMatchObject({ rounds: 10 });
    expect(() => selectGameOptions(bounded, { rounds: '1000' })).toThrow(/"rounds" must be between 1 and 10/);
  });

  it('admits values on the step counted from min, at both ends of the range', () => {
    expect(selectGameOptions(bounded, { bid: 5 })).toMatchObject({ bid: 5 });
    expect(selectGameOptions(bounded, { bid: 25 })).toMatchObject({ bid: 25 });
    expect(selectGameOptions(bounded, { bid: 50 })).toMatchObject({ bid: 50 });
  });

  it('refuses an off-step value, naming the step and where it counts from', () => {
    expect(() => selectGameOptions(bounded, { bid: 7 })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(bounded, { bid: 7 })).toThrow(
      'Game option "bid" must be in steps of 5 from 5 (5, 10, 15, ...), got 7.',
    );
  });

  it('counts the step from 0 when there is no min', () => {
    expect(selectGameOptions(bounded, { even: -4 })).toMatchObject({ even: -4 });
    expect(selectGameOptions(bounded, { even: 0 })).toMatchObject({ even: 0 });
    expect(() => selectGameOptions(bounded, { even: 3 })).toThrow(
      'Game option "even" must be in steps of 2 from 0 (0, 2, 4, ...), got 3.',
    );
  });

  it('admits a fractional step despite floating point rounding, and refuses what is between steps', () => {
    for (const v of [0, 0.1, 0.3, 0.7, 1]) {
      expect(selectGameOptions(bounded, { tenths: v })).toMatchObject({ tenths: v });
    }
    expect(() => selectGameOptions(bounded, { tenths: 0.15 })).toThrow(/"tenths" must be in steps of 0\.1 from 0 \(0, 0\.1, 0\.2, \.\.\.\), got 0\.15/);
  });

  it('refuses an off-step value far from where the step counts from', () => {
    expect(selectGameOptions(bounded, { even: 1000000000 })).toMatchObject({ even: 1000000000 });
    expect(() => selectGameOptions(bounded, { even: 1000000001 })).toThrow(/"even" must be in steps of 2/);
    expect(() => selectGameOptions(bounded, { even: 1000000000.5 })).toThrow(/"even" must be in steps of 2/);
    expect(() => selectGameOptions(bounded, { even: 500000000.5 })).toThrow(/"even" must be in steps of 2/);
    const wideTenths: Record<string, GameOptionDefinition> = { t: { type: 'number', label: 'T', step: 0.1, default: 0 } };
    expect(selectGameOptions(wideTenths, { t: 100000000.1 })).toMatchObject({ t: 100000000.1 });
    expect(() => selectGameOptions(wideTenths, { t: 100000000.05 })).toThrow(/"t" must be in steps of 0\.1/);
  });

  it('admits every on-step value for a range of steps', () => {
    for (const step of [0.01, 0.05, 0.1, 0.25, 0.3, 0.5, 1, 2.5, 3, 7, 10]) {
      const defs: Record<string, GameOptionDefinition> = { v: { type: 'number', label: 'V', min: -5, step, default: -5 } };
      for (let i = 0; i <= 2000; i += 7) {
        const v = -5 + i * step;
        expect(selectGameOptions(defs, { v })).toMatchObject({ v });
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
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', min: 10, max: 1, default: 1 } }),
    ).toThrow(/"rounds".*min 10.*max 1/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a step of %s', (step) => {
    expect(() => assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', step, default: 0 } })).toThrow(
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
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', min: Number.NaN, default: 0 } }),
    ).toThrow(/"rounds".*min/);
    expect(() =>
      assertDeclarableGameOptions({ rounds: { type: 'number', label: 'Rounds', max: '10' as unknown as number, default: 0 } }),
    ).toThrow(/"rounds".*max/);
  });
});

describe('a designer-only option is never a player\'s to choose (#687)', () => {
  const withKnob: Record<string, GameOptionDefinition> = {
    ...declared,
    lootScale: { type: 'number', label: 'Loot scale', min: 0.5, max: 2, step: 0.25, default: 1, designerOnly: true },
  };

  it('a player selection naming it is refused by name, saying who can set it', () => {
    expect(() => selectGameOptions(withKnob, { lootScale: 1.5 })).toThrow(GameOptionSelectionError);
    expect(() => selectGameOptions(withKnob, { lootScale: 1.5 })).toThrow(
      /Game option "lootScale" is designer-only: .*boardsmith simulate.*table setup/,
    );
  });

  it('a player selection of the other options is admitted as before', () => {
    expect(selectGameOptions(withKnob, { rounds: 4 })).toMatchObject({ rounds: 4 });
  });

  it('the designer selection admits it, checked against its declaration like any option', () => {
    expect(selectDesignerGameOptions(withKnob, { lootScale: '1.5', rounds: 4 })).toMatchObject({ lootScale: 1.5, rounds: 4 });
    expect(() => selectDesignerGameOptions(withKnob, { lootScale: 3 })).toThrow(/"lootScale" must be between 0.5 and 2/);
  });

  it('the designer selection still refuses a host-owned or undeclared key', () => {
    expect(() => selectDesignerGameOptions(withKnob, { seed: 'x' })).toThrow(/"seed" cannot be chosen/);
    expect(() => selectDesignerGameOptions(withKnob, { nope: 1 })).toThrow(/Unknown game option "nope"/);
  });

  it('a preset that sets a designer-only option is refused, naming the preset and the option', () => {
    expect(() =>
      assertPresetsSelectable(withKnob, [
        { name: 'Quick', options: { rounds: 2 } },
        { name: 'Rich', options: { lootScale: 2 } },
      ]),
    ).toThrow(/This game's preset "Rich" cannot be used: Game option "lootScale" is designer-only/);
    expect(() => assertPresetsSelectable(withKnob, [{ name: 'Quick', options: { rounds: 2 } }])).not.toThrow();
    expect(() => assertPresetsSelectable(withKnob, undefined)).not.toThrow();
  });

  it('a preset naming an undeclared option, or a number off its step, is refused at load', () => {
    expect(() => assertPresetsSelectable(withKnob, [{ name: 'Typo', options: { roundz: 2 } }])).toThrow(
      /preset "Typo" cannot be used: Unknown game option "roundz"/,
    );
    const stepped: Record<string, GameOptionDefinition> = { bid: { type: 'number', label: 'Bid', min: 5, step: 5, default: 5 } };
    expect(() => assertPresetsSelectable(stepped, [{ name: 'Odd', options: { bid: 7 } }])).toThrow(
      /preset "Odd" cannot be used: Game option "bid" must be in steps of 5/,
    );
  });

  it('a preset that sets only its players, with no options, is admitted', () => {
    expect(() => assertPresetsSelectable(withKnob, [{ name: 'Three', players: [{}, {}, {}] }])).not.toThrow();
  });
});

describe('every selection is filled with the declared defaults (#701)', () => {
  const withKnob: Record<string, GameOptionDefinition> = {
    ...declared,
    lootScale: { type: 'number', label: 'Loot scale', min: 0.5, max: 2, step: 0.25, default: 1, designerOnly: true },
  };

  it('a player selection holds every declared option: the chosen value, or its default', () => {
    expect(selectGameOptions(declared, {})).toEqual({ rounds: 3, hardMode: false, level: 1 });
    expect(selectGameOptions(declared, { rounds: 5 })).toEqual({ rounds: 5, hardMode: false, level: 1 });
  });

  it('an option left undefined gets its default', () => {
    expect(selectGameOptions(declared, { rounds: undefined, level: 4 })).toEqual({ rounds: 3, hardMode: false, level: 4 });
  });

  it('a designer-only option gets its default in a player selection, and the designer selection may set it', () => {
    expect(selectGameOptions(withKnob, { rounds: 4 })).toEqual({ rounds: 4, hardMode: false, level: 1, lootScale: 1 });
    expect(selectDesignerGameOptions(withKnob, { lootScale: 1.5 })).toMatchObject({ rounds: 3, lootScale: 1.5 });
  });

  it('a default select choice is the declared value, frozen like a chosen one', () => {
    const shaped: Record<string, GameOptionDefinition> = {
      board: { type: 'select', label: 'Board', default: { w: 3 }, choices: [{ value: { w: 3 }, label: 'Small' }] },
    };
    const selection = selectGameOptions(shaped, {});
    expect(selection.board).toEqual({ w: 3 });
    expect(Object.isFrozen(selection.board)).toBe(true);
  });
});

describe('every declared option has a default its own declaration admits (#701)', () => {
  it.each<[string, Record<string, unknown>]>([
    ['number', { type: 'number', label: 'Rounds' }],
    ['boolean', { type: 'boolean', label: 'Fast' }],
    ['select', { type: 'select', label: 'Level', choices: [{ value: 1, label: 'One' }] }],
  ])('refuses a %s option with no default, blaming the game', (_type, def) => {
    expect(() => assertDeclarableGameOptions({ opt: def as unknown as GameOptionDefinition })).toThrow(
      /This game declares game option "opt" with no default.*Give it a default/,
    );
  });

  it('refuses a select default that is not one of its choices, and a boolean default that is not true or false', () => {
    expect(() =>
      assertDeclarableGameOptions({
        level: { type: 'select', label: 'Level', default: 2, choices: [{ value: 1, label: 'One' }] },
      }),
    ).toThrow(/This game declares game option "level" with default 2, which its own declaration refuses/);
    expect(() =>
      assertDeclarableGameOptions({ fast: { type: 'boolean', label: 'Fast', default: 'yes' as unknown as boolean } }),
    ).toThrow(/This game declares game option "fast" with default "yes"/);
  });
});

describe('boardsmith.json\'s gameOptions list is the one declaration (#701)', () => {
  const list = [
    { id: 'rounds', type: 'number', label: 'Rounds', min: 1, max: 9, default: 3 },
    { id: 'lootScale', type: 'number', label: 'Loot scale', default: 1, designerOnly: true },
  ];

  it('parseGameOptionList keys the list by id, keeping every other field', () => {
    expect(parseGameOptionList(list)).toEqual({
      rounds: { type: 'number', label: 'Rounds', min: 1, max: 9, default: 3 },
      lootScale: { type: 'number', label: 'Loot scale', default: 1, designerOnly: true },
    });
    expect(parseGameOptionList(undefined)).toEqual({});
  });

  it('parseGameOptionList refuses what is not a list of options with distinct ids', () => {
    expect(() => parseGameOptionList({ rounds: {} })).toThrow(/boardsmith\.json's "gameOptions" must be a list/);
    expect(() => parseGameOptionList([{ type: 'boolean', label: 'Fast', default: false }])).toThrow(
      /boardsmith\.json's game option 1 has no "id"/,
    );
    expect(() => parseGameOptionList([list[0], list[0]])).toThrow(/declares game option "rounds" twice/);
    expect(() =>
      parseGameOptionList([{ id: 'fast', type: 'boolean', label: 'Fast', default: false, designerOnly: false }]),
    ).toThrow(/"fast" has designerOnly false.*true or leave it out/);
    expect(() => parseGameOptionList([{ id: 'rounds', type: 'number', label: 'Rounds' }])).toThrow(/no default/);
    expect(() => parseGameOptionList([{ id: 'n', type: 'nubmer', label: 'N', default: 1 }])).toThrow(
      /"n" with type "nubmer".*"number", "boolean" or "select"/,
    );
    expect(() => parseGameOptionList([{ id: 'n', type: 'number', default: 1 }])).toThrow(/"n" with no label/);
    expect(() => parseGameOptionList([{ id: 'lv', type: 'select', label: 'Lv', default: 1 }])).toThrow(
      /select option "lv" with no choices/,
    );
  });

  it('withDeclaredGameOptions attaches the list to a game definition, where declaredGameOptionsOf reads it', () => {
    const definition = { gameType: 'g' };
    const loaded = withDeclaredGameOptions(definition, list);
    expect(declaredGameOptionsOf(loaded)).toEqual(parseGameOptionList(list));
    expect(declaredGameOptionsOf({ ...loaded })).toEqual(parseGameOptionList(list));
    expect(declaredGameOptionsOf(definition)).toBeUndefined();
  });

  it('withDeclaredGameOptions refuses a game definition that still declares gameOptions, saying where they go', () => {
    expect(() => withDeclaredGameOptions({ gameType: 'g', gameOptions: {} }, list)).toThrow(
      /gameDefinition declares gameOptions.*boardsmith\.json/,
    );
  });
});
