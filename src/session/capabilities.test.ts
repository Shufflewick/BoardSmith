import { describe, it, expect } from 'vitest';
import {
  GAME_BACKENDS,
  capabilityContradictions,
  isGameBackend,
  resolveCapabilities,
  type GameBackend,
} from './capabilities.js';

/** A table game's compiled definition: seat range, no world block. */
const tableDefinition = { minPlayers: 2, maxPlayers: 4 };

/** A world game's compiled definition: a world block with its own seat count. */
const worldDefinition = { world: { maxPlayers: 40 } };

function capabilities(
  backend: GameBackend,
  definition: Parameters<typeof resolveCapabilities>[0]['definition'],
  declared: Parameters<typeof resolveCapabilities>[0]['declared'] = {},
) {
  return resolveCapabilities({ backend, definition, declared });
}

describe('GAME_BACKENDS', () => {
  it('names the two backends the engine runs', () => {
    expect([...GAME_BACKENDS]).toEqual(['table', 'world']);
  });

  it('recognises only a declared backend name', () => {
    expect(isGameBackend('table')).toBe(true);
    expect(isGameBackend('world')).toBe(true);
    expect(isGameBackend('tables')).toBe(false);
    expect(isGameBackend(undefined)).toBe(false);
  });
});

describe('resolveCapabilities — the table backend', () => {
  it('offers a table and no world', () => {
    const set = capabilities('table', tableDefinition);
    expect(set.table).toBe(true);
    expect(set.world).toBe(false);
  });

  it('offers undo and spectators, which a per-action snapshot pays for', () => {
    const set = capabilities('table', tableDefinition);
    expect(set.undo).toBe(true);
    expect(set.spectators).toBe(true);
  });

  it('offers bots exactly when the bundle compiles one', () => {
    expect(capabilities('table', tableDefinition).bots).toBe(false);
    expect(capabilities('table', { ...tableDefinition, bot: { objectives: [] } }).bots).toBe(true);
  });

  it('reads asyncPlay and joinInProgress from what the author declared', () => {
    expect(capabilities('table', tableDefinition).asyncPlay).toBe(false);
    expect(capabilities('table', tableDefinition).joinInProgress).toBe(false);

    const declared = capabilities('table', tableDefinition, {
      asyncPlay: true,
      joinInProgress: true,
    });
    expect(declared.asyncPlay).toBe(true);
    expect(declared.joinInProgress).toBe(true);
  });

  it('reads crossSessionState from the compiled definition, never from the config', () => {
    expect(capabilities('table', tableDefinition).crossSessionState).toBe(false);
    expect(
      capabilities('table', { ...tableDefinition, persistence: true }).crossSessionState,
    ).toBe(true);
  });

  it('answers a non-boolean declaration as false rather than as truthiness', () => {
    // A malformed declaration is refused by `capabilityContradictions`; what
    // matters here is that the resolved set never carries a non-boolean.
    const set = capabilities('table', tableDefinition, { asyncPlay: 'yes' });
    expect(set.asyncPlay).toBe(false);
  });
});

describe('resolveCapabilities — the world backend', () => {
  it('offers a world and no table', () => {
    const set = capabilities('world', worldDefinition);
    expect(set.world).toBe(true);
    expect(set.table).toBe(false);
  });

  it('offers no undo, no spectators and no bots', () => {
    const set = capabilities('world', worldDefinition);
    expect(set.undo).toBe(false);
    expect(set.spectators).toBe(false);
    expect(set.bots).toBe(false);
  });

  it('implies asyncPlay, joinInProgress and crossSessionState from the backend', () => {
    const set = capabilities('world', worldDefinition);
    expect(set.asyncPlay).toBe(true);
    expect(set.joinInProgress).toBe(true);
    expect(set.crossSessionState).toBe(true);
  });

  it('is the same set whether or not the author wrote the stripped flags', () => {
    // The flags are refused by `capabilityContradictions`; this proves that
    // even if one slipped through it could not change the answer.
    expect(
      capabilities('world', worldDefinition, { asyncPlay: false, joinInProgress: false }),
    ).toEqual(capabilities('world', worldDefinition));
  });
});

describe('capabilityContradictions', () => {
  const contradictions = (
    backend: GameBackend,
    definition: Parameters<typeof capabilityContradictions>[0]['definition'],
    declared: Parameters<typeof capabilityContradictions>[0]['declared'] = {},
  ) => capabilityContradictions({ backend, definition, declared });

  it('is silent on a consistent table game', () => {
    expect(contradictions('table', tableDefinition)).toEqual([]);
    expect(
      contradictions('table', { ...tableDefinition, bot: {}, persistence: true }, {
        asyncPlay: true,
        joinInProgress: true,
      }),
    ).toEqual([]);
  });

  it('is silent on a consistent world game', () => {
    expect(contradictions('world', worldDefinition)).toEqual([]);
  });

  it('refuses a world backend whose rules export no world', () => {
    const [message] = contradictions('world', {});
    expect(message).toContain('"backend": "world"');
    expect(message).toContain('gameDefinition');
  });

  it('refuses a table backend whose rules export a world', () => {
    const [message] = contradictions('table', { ...tableDefinition, world: { maxPlayers: 40 } });
    expect(message).toContain('"backend": "table"');
    expect(message).toContain('world');
  });

  it('refuses each stripped flag on a world, naming the backend as the answer', () => {
    for (const key of ['asyncPlay', 'joinInProgress'] as const) {
      const [message] = contradictions('world', worldDefinition, { [key]: true });
      expect(message).toContain(`"${key}"`);
      expect(message).toContain('world backend already answers');
    }
  });

  it('refuses round policy on a world, which has no rounds', () => {
    for (const key of ['roundDeadline', 'idleAction'] as const) {
      const [message] = contradictions('world', worldDefinition, { [key]: {} });
      expect(message).toContain(`"${key}"`);
      expect(message).toContain('a world has no rounds');
    }
  });

  it('refuses a world whose rules declare persistence, for the same reason', () => {
    const [message] = contradictions('world', { ...worldDefinition, persistence: true });
    expect(message).toContain('persistence');
    expect(message).toContain('world backend already answers');
  });

  it('refuses a world bundle that ships a bot, naming the backend', () => {
    const [message] = contradictions('world', { ...worldDefinition, bot: {} });
    expect(message).toContain('bot');
    expect(message).toContain('world backend');
  });

  it('refuses a world that declares a table roster', () => {
    const [message] = contradictions('world', { ...worldDefinition, minPlayers: 2, maxPlayers: 40 });
    expect(message).toContain('minPlayers');
    expect(message).toContain('world.maxPlayers');
  });

  it('refuses a world whose world block declares no seats', () => {
    const [message] = contradictions('world', { world: {} });
    expect(message).toContain('world.maxPlayers');
  });

  it('refuses a table that declares no seat range', () => {
    const [message] = contradictions('table', {});
    expect(message).toContain('minPlayers');
    expect(message).toContain('maxPlayers');
  });

  it('refuses a non-boolean declaration rather than reading its truthiness', () => {
    const [message] = contradictions('table', tableDefinition, { asyncPlay: 'yes' });
    expect(message).toContain('"asyncPlay" must be true or false');
  });
});
