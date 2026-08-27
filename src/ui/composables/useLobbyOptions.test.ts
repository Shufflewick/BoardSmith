// @vitest-environment jsdom
/**
 * WHAT THE WAITING ROOM OFFERS (#157).
 *
 * Which options a lobby renders, and where each one goes: a standard option
 * belongs in "Your Settings", an EXCLUSIVE one belongs on the seat rows because
 * no two seats may hold the same value, and colour is special because a lobby
 * can enable it without the game declaring it.
 *
 * Pure derivations over the lobby and the game's declared options, extracted
 * from a 1674-line component where reaching them meant mounting the room.
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useLobbyOptions } from './useLobbyOptions.js';
import type { LobbyInfo } from '../../client/index.js';

function lobby(extra: Partial<LobbyInfo> = {}): LobbyInfo {
  return { state: 'waiting', gameType: 'chess', slots: [], openSlots: 0, ...extra } as LobbyInfo;
}

function options(l: LobbyInfo, playerOptions?: Record<string, unknown>) {
  return useLobbyOptions({ lobby: ref(l), playerOptions: ref(playerOptions) });
}

describe('useLobbyOptions', () => {
  it('offers nothing when the game declares nothing and colour is off', () => {
    const o = options(lobby());
    expect(o.effectivePlayerOptions.value).toBeNull();
    expect(o.standardPlayerOptions.value).toBeNull();
    expect(o.exclusivePlayerOptions.value).toBeNull();
  });

  it('injects a colour option, first, when the lobby enables colour selection', () => {
    const o = options(
      lobby({ colorSelectionEnabled: true, colors: ['#ff0000', '#00ff00'] }),
      { variant: { type: 'choice', label: 'Variant', choices: ['a'] } }
    );

    const keys = Object.keys(o.effectivePlayerOptions.value!);
    expect(keys[0]).toBe('color');
    expect(o.effectivePlayerOptions.value!.color).toMatchObject({
      type: 'color',
      label: 'Color',
      choices: [{ value: '#ff0000', label: '#ff0000' }, { value: '#00ff00', label: '#00ff00' }],
    });
  });

  it('leaves the game\'s own colour option alone, labels and all', () => {
    const declared = { type: 'color', label: 'Army', choices: [{ value: '#ff0000', label: 'Red' }] };
    const o = options(lobby({ colorSelectionEnabled: true, colors: ['#123456'] }), { color: declared });

    // The game said what its colours mean; a generic injection would erase that.
    expect(o.effectivePlayerOptions.value!.color).toEqual(declared);
    expect(o.effectivePlayerOptions.value!.color.label).toBe('Army');
  });

  it('splits standard options from exclusive ones, because they render in different places', () => {
    const o = options(lobby(), {
      variant: { type: 'choice', label: 'Variant', choices: ['a'] },
      faction: { type: 'exclusive', label: 'Faction', choices: ['x', 'y'] },
    });

    expect(Object.keys(o.standardPlayerOptions.value!)).toEqual(['variant']);
    expect(Object.keys(o.exclusivePlayerOptions.value!)).toEqual(['faction']);
  });

  it('reports null rather than an empty bag when a side of the split is empty', () => {
    const o = options(lobby(), { faction: { type: 'exclusive', label: 'Faction', choices: ['x'] } });
    expect(o.standardPlayerOptions.value).toBeNull();
    expect(o.exclusivePlayerOptions.value).not.toBeNull();
  });

  it('hides the internal playerConfigs bag from the game-options summary', () => {
    const o = options(lobby({ gameOptions: { playerConfigs: [{ name: 'Ada' }], variant: 'quick' } }));
    expect(o.displayableGameOptions.value).toEqual({ variant: 'quick' });

    const onlyInternal = options(lobby({ gameOptions: { playerConfigs: [] } }));
    expect(onlyInternal.displayableGameOptions.value).toBeNull();
  });

  it('normalises option choices to value/label pairs, and gives an exclusive one none', () => {
    const o = options(lobby());
    expect(o.getPlayerOptionChoices({ type: 'choice', label: 'V', choices: ['a', { value: 'b', label: 'B' }] } as never))
      .toEqual([{ value: 'a', label: 'a' }, { value: 'b', label: 'B' }]);
    expect(o.getPlayerOptionChoices({ type: 'exclusive', label: 'F', choices: ['x'] } as never)).toEqual([]);
    expect(o.getPlayerOptionChoices({ type: 'choice', label: 'V' } as never)).toEqual([]);
  });
});
