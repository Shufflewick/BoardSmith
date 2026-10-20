import { describe, it, expect } from 'vitest';
import {
  GAME_BACKENDS,
  capabilityContradictions,
  isGameBackend,
  resolveCapabilities,
  type GameBackend,
} from './capabilities.js';
import { Game, Player, type GameOptions } from '../engine/index.js';
import { DeployGame, FixedDeployGame, UntimedDeployGame } from './testing/fixtures/timed-step-fixture.js';
import { withDeclaredGameOptions } from './game-option-selection.js';

/** A game class that builds no flow. */
class PlainGame extends Game<PlainGame, Player> {}

/** A table game's compiled definition: seat range, no world block. */
const tableDefinition = { gameClass: PlainGame, minPlayers: 2, maxPlayers: 4 };

/** A world game's compiled definition: a world block with its own seat count. */
const worldDefinition = { gameClass: PlainGame, world: { maxPlayers: 40 } };

/** A table whose compiled flow has one step declaring a time limit, 'deploy'. */
const timedDefinition = { ...tableDefinition, gameClass: FixedDeployGame };

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

  it('offers timedSteps exactly when a step of the compiled flow declares a time limit', () => {
    expect(capabilities('table', tableDefinition).timedSteps).toBe(false);
    expect(capabilities('table', { ...tableDefinition, gameClass: UntimedDeployGame }).timedSteps).toBe(false);
    expect(capabilities('table', timedDefinition).timedSteps).toBe(true);
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

  it('offers no undo, no spectators, no bots and no timed steps', () => {
    const set = capabilities('world', worldDefinition);
    expect(set.undo).toBe(false);
    expect(set.spectators).toBe(false);
    expect(set.bots).toBe(false);
    expect(set.timedSteps).toBe(false);
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
    const [message] = contradictions('world', { gameClass: PlainGame });
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
    const [message] = contradictions('world', { gameClass: PlainGame, world: {} });
    expect(message).toContain('world.maxPlayers');
  });

  it('refuses a table that declares no seat range', () => {
    const [message] = contradictions('table', { gameClass: PlainGame });
    expect(message).toContain('minPlayers');
    expect(message).toContain('maxPlayers');
  });

  it('refuses a timed step without an idleAction, naming the step and the fix', () => {
    const [message] = contradictions('table', timedDefinition);
    expect(message).toContain("'deploy'");
    expect(message).toContain('timeLimitMs');
    expect(message).toContain('"idleAction"');
    expect(message).toContain('boardsmith.json');
  });

  it('refuses it even when the game ships a bot: a bot is not how a timed step closes', () => {
    const [message] = contradictions('table', { ...timedDefinition, bot: {} });
    expect(message).toContain('"idleAction"');
    expect(message).toContain('not');
    expect(message).toMatch(/bot/);
  });

  it('is silent on a timed step whose game declares an idleAction', () => {
    expect(contradictions('table', timedDefinition, { idleAction: { name: 'commit' } })).toEqual([]);
  });

  it('refuses a non-boolean declaration rather than reading its truthiness', () => {
    const [message] = contradictions('table', tableDefinition, { asyncPlay: 'yes' });
    expect(message).toContain('"asyncPlay" must be true or false');
  });
});

/** A deploy game whose round is timed only for some options: `blitz`, or the "rapid" `pace`. */
class OptionTimedGame extends DeployGame {
  constructor(options: GameOptions & { blitz?: boolean; pace?: string; minutes?: number; teams?: boolean }) {
    if (options.teams === true && options.playerCount === 3) throw new Error('teams need an even seat count');
    const timed = options.blitz === true || options.pace === 'rapid' || options.minutes === 5;
    super(options, timed ? 60_000 : undefined);
  }
}

/** `tableDefinition` built from OptionTimedGame, carrying `gameOptions` as a loaded bundle does. */
function optionTimedDefinition(gameOptions: unknown[]) {
  return withDeclaredGameOptions({ ...tableDefinition, gameClass: OptionTimedGame }, gameOptions);
}

const blitz = (defaultValue: boolean) => ({ id: 'blitz', type: 'boolean', label: 'Blitz', default: defaultValue });
const pace = {
  id: 'pace',
  type: 'select',
  label: 'Pace',
  default: 'calm',
  choices: [{ value: 'calm', label: 'Calm' }, { value: 'rapid', label: 'Rapid' }],
};

describe('timed steps that depend on game options (#812)', () => {
  it('builds the game with its declared defaults: a blitz that defaults on is timed', () => {
    const definition = optionTimedDefinition([blitz(true)]);
    expect(capabilities('table', definition).timedSteps).toBe(true);
    const [message] = capabilityContradictions({ backend: 'table', definition, declared: {} });
    expect(message).toContain("'deploy'");
    expect(message).toContain('default game options');
  });

  it('finds a timer that only a non-default select choice turns on, naming that choice', () => {
    const definition = optionTimedDefinition([blitz(false), pace]);
    expect(capabilities('table', definition).timedSteps).toBe(true);
    const [message] = capabilityContradictions({ backend: 'table', definition, declared: {} });
    expect(message).toContain('"idleAction"');
    expect(message).toContain('pace: "rapid"');
    expect(capabilities('table', optionTimedDefinition([])).timedSteps).toBe(false);
  });

  it('refuses, by name, a game with more option combinations than it will build', () => {
    // 2 to the 7th combinations at each of 3 seat counts is 384 builds.
    const many = Array.from({ length: 7 }, (_, i) => ({ ...blitz(false), id: `flag${i}` }));
    const definition = optionTimedDefinition(many);
    const [message] = capabilityContradictions({ backend: 'table', definition, declared: {} });
    expect(message).toContain('384');
    expect(message).toContain('256');
    expect(message).toContain('timeLimitMs');
    expect(() => capabilities('table', definition)).toThrow(/384/);
  });

  it('needs no search when the default options already have a timed step', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...blitz(false), id: `flag${i}` }));
    const definition = optionTimedDefinition([blitz(true), ...many]);
    expect(capabilities('table', definition).timedSteps).toBe(true);
    expect(capabilityContradictions({ backend: 'table', definition, declared: { idleAction: { name: 'commit' } } })).toEqual([]);
  });

  it('names the seat count and options of a combination whose constructor throws', () => {
    const definition = optionTimedDefinition([{ ...blitz(false), id: 'teams' }]);
    expect(() => capabilityContradictions({ backend: 'table', definition, declared: {} })).toThrow(
      'Constructing this game at 3 players with game options teams: true threw: teams need an even seat count',
    );
  });

  it('leaves designer-only and number options at their defaults, unsearched', () => {
    const designerBlitz = { ...blitz(false), designerOnly: true };
    const minutes = { id: 'minutes', type: 'number', label: 'Minutes', default: 10 };
    expect(capabilities('table', optionTimedDefinition([designerBlitz, minutes])).timedSteps).toBe(false);
    expect(capabilities('table', optionTimedDefinition([{ ...designerBlitz, default: true }])).timedSteps).toBe(true);
  });
});

describe('a table seat range must hold a seat count (#1303)', () => {
  const contradictions = (backend: GameBackend, definition: Parameters<typeof capabilityContradictions>[0]['definition']) =>
    capabilityContradictions({ backend, definition, declared: {} });

  it('refuses a minPlayers above maxPlayers, and one below a single seat, naming both numbers', () => {
    expect(contradictions('table', { ...tableDefinition, minPlayers: 4, maxPlayers: 2 })).toEqual([
      'minPlayers (4) is more than maxPlayers (2), so there is no seat count to build this game at. ' +
        'Set minPlayers to at most maxPlayers in your gameDefinition (src/rules/index.ts).',
    ]);
    expect(contradictions('table', { ...tableDefinition, minPlayers: 0, maxPlayers: 2 })).toEqual([
      'minPlayers is 0, but a table needs at least one seat. Set minPlayers to 1 or more in your gameDefinition (src/rules/index.ts).',
    ]);
  });

  it('refuses a seat range too wide to build each seat count, rather than building it', () => {
    const [message] = contradictions('table', { ...tableDefinition, minPlayers: 2, maxPlayers: 1000 });
    expect(message).toMatch(/^This game would have to be built 999 times to find every step that declares timeLimitMs/);
  });

  it('does not tell a game too wide to build at all to time a step with its default options, which builds nothing either', () => {
    const [message] = contradictions('table', { ...timedDefinition, minPlayers: 2, maxPlayers: 1000 });
    expect(message).not.toMatch(/time a step with its default options/);
  });
});
