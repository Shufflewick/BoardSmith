/**
 * A game's player options are the union of what its gameDefinition and its
 * boardsmith.json declare, by key, and a key the two declare differently is
 * refused (#992). Each merged option must be one the platform's manifest can
 * carry, since dev and the live lobby must offer the same list.
 */
import { describe, it, expect } from 'vitest';
import { defaultSeatOptions, exclusiveSeats, mergePlayerOptions, seatOptionsRefusal } from './player-options.js';
import { createColorOption, type PlayerOptionDefinition } from '../../session/index.js';

const role: PlayerOptionDefinition = {
  type: 'exclusive',
  label: 'Dictator',
  default: 'last',
  choices: [{ value: 'dictator', label: 'Dictator' }],
};
const botLevel = {
  type: 'select',
  label: 'Difficulty',
  default: 'easy',
  choices: [{ value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }],
};

describe('mergePlayerOptions', () => {
  it('keeps the options each side declares', () => {
    expect(mergePlayerOptions({ role }, [{ id: 'botLevel', ...botLevel }])).toEqual({ role, botLevel });
  });

  it('keeps a key declared the same in both once', () => {
    expect(mergePlayerOptions({ role }, [{ id: 'role', ...role }])).toEqual({ role });
  });

  it('does not count an undefined field or a different field order as a difference', () => {
    const reordered = { id: 'role', choices: role.choices, default: 'last', label: 'Dictator', type: 'exclusive' };
    expect(mergePlayerOptions({ role: { ...role, description: undefined } }, [reordered])).toEqual({
      role: { type: 'exclusive', label: 'Dictator', default: 'last', choices: role.choices },
    });
  });

  it('refuses a key declared differently in both, naming the key and both declarations', () => {
    const merge = () => mergePlayerOptions({ role }, [{ id: 'role', ...role, label: 'Tyrant' }]);
    expect(merge).toThrow(/player option "role"/);
    expect(merge).toThrow(/"label":"Dictator"/);
    expect(merge).toThrow(/"label":"Tyrant"/);
    expect(merge).toThrow(/Declare "role" in one place/);
  });

  it('leaves the code-side colour out, which the lobby builds from colorPalette', () => {
    expect(mergePlayerOptions({ color: createColorOption(), role }, undefined)).toEqual({ role });
  });

  it('refuses a boardsmith.json colour option by name and points to colorPalette', () => {
    const merge = () => mergePlayerOptions(undefined, [{ id: 'color', type: 'color', label: 'Colour', choices: [] }]);
    expect(merge).toThrow(/boardsmith.json declares a "color" player option.*"colorPalette"/s);
  });

  it('refuses an id boardsmith.json declares twice, naming it', () => {
    const merge = () => mergePlayerOptions(undefined, [{ id: 'botLevel', ...botLevel }, { name: 'botLevel', ...botLevel }]);
    expect(merge).toThrow(/boardsmith.json declares player option "botLevel" twice/);
  });

  it('reads an option keyed by "name" as boardsmith.json allows', () => {
    expect(mergePlayerOptions(undefined, [{ name: 'botLevel', ...botLevel }])).toEqual({ botLevel });
  });

  it('refuses a boardsmith.json option with no id', () => {
    expect(() => mergePlayerOptions(undefined, [{ ...botLevel }])).toThrow(/playerOptions\[0\] has no "id"/);
  });

  it('refuses a boardsmith.json "playerOptions" that is not a list', () => {
    expect(() => mergePlayerOptions(undefined, { botLevel })).toThrow(/"playerOptions" must be a list/);
  });
});

describe('mergePlayerOptions refuses an option the platform\'s manifest cannot carry', () => {
  // boardsmith.json is untyped, so these shapes still reach the check from there.
  const refused = (option: Record<string, unknown>) => () => mergePlayerOptions(undefined, [{ id: 'odd', ...option }]);

  it('names a type the lobby has no control for, and the types it has', () => {
    expect(refused({ type: 'text', label: 'Name' })).toThrow(
      /Player option "odd" has type "text".*"number", "select", "boolean" or "exclusive"/s,
    );
  });

  it('needs an exclusive option to list its choices, whatever its default', () => {
    expect(refused({ type: 'exclusive', label: 'Dictator', default: 'last' })).toThrow(
      /"odd" needs "choices": a non-empty list of \{ "value", "label" \} strings/,
    );
    expect(refused({ type: 'exclusive', label: 'Dictator', default: 2, choices: role.choices })).toThrow(
      /"odd" needs a string "default"/,
    );
  });

  it('needs a select option\'s choices to be value and label pairs, and its default to be one of them', () => {
    expect(refused({ ...botLevel, choices: ['easy', 'hard'] })).toThrow(/"odd" needs "choices"/);
    expect(refused({ ...botLevel, default: undefined })).toThrow(/"odd" needs a string "default"/);
    expect(refused({ ...botLevel, default: 'medium' })).toThrow(/"odd" has default "medium".*easy, hard/s);
  });

  it('needs a number option\'s default to be a number inside its range, and a boolean\'s to be a boolean', () => {
    expect(refused({ type: 'number', label: 'Seats' })).toThrow(/"odd" needs a number "default"/);
    expect(refused({ type: 'number', label: 'Seats', default: 9, min: 1, max: 4 })).toThrow(
      /"odd" has default 9, above its max of 4\./,
    );
    expect(refused({ type: 'number', label: 'Seats', default: 0, min: 1 })).toThrow(/"odd" has default 0, below its min of 1\./);
    expect(refused({ type: 'number', label: 'Seats', default: 9, max: 4 })).toThrow(/"odd" has default 9, above its max of 4\./);
    expect(refused({ type: 'number', label: 'Seats', default: 2, step: 0 })).toThrow(/"odd" needs a "step" above 0/);
    expect(refused({ type: 'boolean', label: 'Ready' })).toThrow(/"odd" needs a true or false "default"/);
  });

  it('needs a label', () => {
    expect(refused({ ...botLevel, label: '' })).toThrow(/"odd" needs a "label"/);
  });

  it('reports every option it cannot carry in one error', () => {
    const merge = () =>
      mergePlayerOptions(undefined, [{ id: 'a', type: 'text', label: 'A' }, { id: 'b', type: 'select', label: 'B' }]);
    expect(merge).toThrow(/"a".*"b"/s);
  });
});

describe('the code types take only shapes the platform\'s manifest can carry (#992)', () => {
  it('does not compile the shapes the platform refuses', () => {
    const refused: PlayerOptionDefinition[] = [
      // @ts-expect-error an exclusive option needs choices
      { type: 'exclusive', label: 'Dictator', default: 'last' },
      // @ts-expect-error a seat number is not a default the platform carries
      { type: 'exclusive', label: 'Dictator', default: 2, choices: [{ value: 'd', label: 'D' }] },
      // @ts-expect-error choices are value and label pairs
      { type: 'select', label: 'Side', default: 'a', choices: ['a', 'b'] },
      // @ts-expect-error a select needs a default
      { type: 'select', label: 'Side', choices: [{ value: 'a', label: 'A' }] },
      // @ts-expect-error the lobby has no text control
      { type: 'text', label: 'Name', default: '' },
      // @ts-expect-error a number option needs a number default
      { type: 'number', label: 'Seats', default: '2' },
      // @ts-expect-error a number option's range is numbers
      { type: 'number', label: 'Seats', default: 2, min: '1' },
      // @ts-expect-error a boolean option needs a true or false default
      { type: 'boolean', label: 'Ready', default: 'yes' },
    ];
    expect(refused).toHaveLength(8);
  });

  it('takes number and boolean options from code, as boardsmith.json can declare them (#1197)', () => {
    const seats: PlayerOptionDefinition = { type: 'number', label: 'Seats', default: 2, min: 1, max: 4, step: 1 };
    const ready: PlayerOptionDefinition = { type: 'boolean', label: 'Ready', description: 'Start at once', default: false };
    expect(mergePlayerOptions({ seats, ready }, [{ id: 'seats', ...seats }])).toEqual({ seats, ready });
  });
});

const declared: Record<string, PlayerOptionDefinition> = {
  color: createColorOption(),
  side: { type: 'select', label: 'Side', default: 'north', choices: [{ value: 'north', label: 'North' }, { value: 'south', label: 'South' }] },
  handicap: { type: 'number', label: 'Handicap', default: 2, min: 0, max: 5, step: 2 },
  ready: { type: 'boolean', label: 'Ready', default: false },
  dictator: { type: 'exclusive', label: 'Dictator', default: 'last', choices: [{ value: 'dictator', label: 'Dictator' }] },
};
const personal = { side: 'north', handicap: 2, ready: false };

describe('defaultSeatOptions (#1304, #1325)', () => {
  it("gives each seat every select, number and boolean default, and an exclusive option's value to the seat its default names", () => {
    expect(defaultSeatOptions(declared, 3)).toEqual([personal, personal, { ...personal, dictator: 'dictator' }]);
  });

  it.each([
    ['first', 1],
    ['', 1],
    ['2', 2],
    ['9', 3],
    ['0', 1],
    ['anyone', 1],
  ])('names the holder of an exclusive option whose default is "%s" as the platform does: seat %i', (initial, holder) => {
    const options: Record<string, PlayerOptionDefinition> = { lead: { ...declared.dictator, default: initial } as PlayerOptionDefinition };
    expect(exclusiveSeats(options, defaultSeatOptions(options, 3))).toEqual({ lead: holder });
  });
});

describe('seatOptionsRefusal (#1323)', () => {
  const table = (...seats: unknown[]) => seats;

  it('accepts one set of declared values per seat, with each exclusive option held by one seat', () => {
    expect(seatOptionsRefusal(declared, table({ ...personal, side: 'south', ready: true }, { ...personal, dictator: 'dictator' }), 2)).toBeUndefined();
  });

  const holder = { ...personal, dictator: 'dictator' };
  it.each<[string, unknown, RegExp, Record<string, PlayerOptionDefinition>?]>([
    ['a table of the wrong size', table(holder), /one set of player options for each of the 2 seats/],
    ['a table that is not a list', { 1: holder, 2: personal }, /one set of player options for each of the 2 seats/],
    ['a seat that is not a set of options', table(holder, 'south'), /Seat 2's player options must be a set of option values/],
    ['a seat missing an option', table(holder, { side: 'north', handicap: 2 }), /Seat 2 has no value for Ready\. Give each seat a value for every player option\./],
    ['an undeclared option', table(holder, { ...personal, speed: 3 }), /Seat 2: "speed" is not a player option of this game; its player options are side, handicap, ready, dictator\./],
    ['colour, which is chosen with the seat', table({ ...holder, color: '#fff' }, personal), /Seat 1: "color" is not a player option/],
    ['a number off its step', table(holder, { ...personal, handicap: 3 }), /Seat 2: Handicap must be in steps of 2 from 0 \(0, 2, 4, \.\.\.\), not 3\./],
    ['a number outside its range', table(holder, { ...personal, handicap: 6 }), /Seat 2: Handicap must be between 0 and 5, not 6\./],
    ['a number that is not one', table({ ...holder, handicap: '3' }, personal), /Seat 1: Handicap must be a number, not "3"\./],
    ['a boolean that is not one', table({ ...holder, ready: 'yes' }, personal), /Seat 1: Ready must be true or false, not "yes"\./],
    ['a select value among none of its choices', table({ ...holder, side: 'west' }, personal), /Seat 1: Side is "west", which is none of its choices \(north, south\)\./],
    ['an exclusive value among none of its choices', table({ ...holder, dictator: 'king' }, personal), /Seat 1: Dictator is "king", which is none of its choices \(dictator\)\./],
    ['an exclusive option no seat holds', table(personal, personal), /Give Dictator to one seat\./],
    ['an option a seat left out whose id an object has anyway', table(holder, personal), /Seat 1 has no value for Constructor\./, { constructor: { type: 'boolean', label: 'Constructor', default: false } }],
    ['an exclusive option two seats hold', table(holder, holder), /Dictator is given to seats 1 and 2; give it to one seat\./],
  ])('refuses %s', (_case, seats, message, more = {}) => {
    expect(seatOptionsRefusal({ ...declared, ...more }, seats, 2)).toMatch(message);
  });
});
