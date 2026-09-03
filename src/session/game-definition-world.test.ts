/**
 * #304: `GameDefinition.world` WAS THE DELETED ROUND SHAPE, AND STILL IS UNTIL
 * THIS FILE IS GREEN.
 *
 * The field required `resolveAction`, accepted `enrolAction`, and its comment
 * advertised a `boardsmith dev --kind resolution` flag. All three belonged to
 * the round architecture, which was deleted: `src/cli/commands/validate.ts`
 * refuses both keys in `boardsmith.json` with a did-you-mean, and the flag is
 * recorded as removed in `docs/api/engine-contract.json`. The live block a
 * world bundle exports is a different thing entirely, and the platform's world
 * runner is what calls it.
 *
 * So the two facts this file holds are:
 *
 *   1. The round shape is gone from the type, comment and all.
 *   2. The type accepts what a world bundle really exports. The annotation
 *      below is the whole test for that: it is checked by `tsc -p
 *      tsconfig.json` (docs/typecheck.md), and before the fix it failed with
 *      "Property 'resolveAction' is missing" -- which is what an author who
 *      annotated their own definition was told.
 *
 * What this file deliberately does NOT do is assert the block's members. The
 * platform owns that contract and validates it on a world's first wake; a
 * second copy here would be free to drift, and drifting is precisely what the
 * shape this replaces did for two architectures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game, Player } from '../engine/index.js';
import type { GameDefinition } from './types.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = readFileSync(join(SRC, 'session', 'types.ts'), 'utf-8');

class WorldGame extends Game<WorldGame, Player> {}

/**
 * A world definition in the shape `~/BoardSmithGames/example-mud` really
 * exports, written the way an author should be able to write it: annotated,
 * so the compiler is the one that says whether it is well-formed.
 */
const definition: GameDefinition = {
  gameClass: WorldGame,
  gameType: 'gloamhall',
  minPlayers: 2,
  maxPlayers: 40,
  world: {
    commands: { walk: () => undefined },
    genesis: () => undefined,
    view: () => [] as readonly string[],
  },
};

describe('#304: the round-world shape is gone from GameDefinition', () => {
  const GONE: Array<{ name: string; why: string }> = [
    {
      name: 'resolveAction',
      why: 'A resident world has no round to resolve. `boardsmith validate` already refuses this key in boardsmith.json.',
    },
    {
      name: 'enrolAction',
      why: 'A joiner is seated by the world itself; nothing submits an enrolment action.',
    },
    {
      name: '--kind resolution',
      why: 'The flag was removed (docs/api/engine-contract.json). A type comment is the last place a deleted flag should still be advertised.',
    },
  ];

  it.each(GONE)('src/session/types.ts says nothing about $name', ({ name, why }) => {
    expect(types.includes(name), why).toBe(false);
  });

  it('carries the block a world bundle really exports', () => {
    expect(definition.world).toHaveProperty('commands');
    expect(definition.world).toHaveProperty('genesis');
    expect(definition.world).toHaveProperty('view');
  });

  it('sends the reader to the document that owns the contract', () => {
    expect(
      types,
      'The engine does not define the world block, so the type has to name who does.',
    ).toContain('docs/persistent-worlds.md');
  });
});

/**
 * The comment on that field says the engine never reads the block. That is a
 * claim about this repo, so it is checked against this repo rather than
 * trusted: the moment something here reads `gameDefinition.world`, the engine
 * has taken a share of a contract it does not document, and the comment is
 * false.
 */
describe('#304: nothing in the engine reads the world block it carries', () => {
  const sources = readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
    .filter((path) => !path.includes('__fixtures__'));

  it('reads the source tree it thinks it is reading', () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it.each(sources)('%s reads no world block', (relative) => {
    const code = readFileSync(join(SRC, relative), 'utf-8');
    expect(
      /\b(gameDefinition|definition|gameDef)\.world\b/.test(code),
      `${relative} reads the game definition's world block. Nothing in this engine may: ` +
        'its members are the hosting platform\'s to call, and typing them here would create ' +
        'a second authority for a contract this repo cannot enforce.',
    ).toBe(false);
  });
});
