/**
 * A game's player options are the union of what its gameDefinition and its
 * boardsmith.json declare, by key, and a key the two declare differently is
 * refused (#992).
 */
import { describe, it, expect } from 'vitest';
import { mergePlayerOptions } from './player-options.js';

const role = { type: 'exclusive' as const, label: 'Dictator', default: 'last' as const };
const botLevel = { type: 'select', label: 'Difficulty', choices: ['easy', 'hard'] };

describe('mergePlayerOptions', () => {
  it('keeps the options each side declares', () => {
    expect(mergePlayerOptions({ role }, [{ id: 'botLevel', ...botLevel }])).toEqual({ role, botLevel });
  });

  it('keeps a key declared the same in both once', () => {
    expect(mergePlayerOptions({ role }, [{ id: 'role', ...role }])).toEqual({ role });
  });

  it('refuses a key declared differently in both, naming the key and both declarations', () => {
    const merge = () => mergePlayerOptions({ role }, [{ id: 'role', ...role, label: 'Tyrant' }]);
    expect(merge).toThrow(/player option "role"/);
    expect(merge).toThrow(/"label":"Dictator"/);
    expect(merge).toThrow(/"label":"Tyrant"/);
    expect(merge).toThrow(/Declare "role" in one place/);
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
