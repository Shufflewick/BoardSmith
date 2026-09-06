/**
 * #165: `GameDefinition.world` IS TYPED BY `boardsmith/world`, AND THAT
 * DELIBERATELY REVERSES #304.
 *
 * #304 made the field an open record and this file held it that way, on an
 * argument that was true at the time: the engine neither called nor validated a
 * member of the block, so any shape declared here would have been a claim it
 * could not keep. What changed is the premise. The world runtime is in this
 * repository now (`src/world/`), so the shape is not a claim about somebody
 * else's runner -- it IS the runner's declaration, and `src/world/definition.ts`
 * reads the block and refuses a bundle that gets it wrong.
 *
 * That is the whole reason the reversal is right rather than a relapse. The
 * open record had a cost, and it was paid three times over: example-rts,
 * example-mud and LacunaExpanse each hand-copied the contract types because
 * there was nothing to import, and three copies of a contract is three places
 * for it to drift. One declaration both sides import cannot.
 *
 * What this file holds:
 *
 *   1. The deleted ROUND shape is still gone -- `resolveAction`, `enrolAction`,
 *      and the removed `--kind resolution` flag. That regression is what #304
 *      was, and nothing here should bring it back.
 *   2. A real world bundle's definition ANNOTATES. The declaration below is
 *      checked by `tsc -p tsconfig.json` (docs/typecheck.md); before #304 it
 *      failed with "Property 'resolveAction' is missing", and after #165 it
 *      must go on compiling against the library's own type.
 *   3. The field is typed by `boardsmith/world` and by nothing else. A second
 *      copy of the shape in this file would be exactly the drift the reversal
 *      exists to end.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game, Player, type GameElement } from '../engine/index.js';
import { worldAction } from '../world/index.js';
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
    // A WORLD'S VERBS ARE ACTIONS (BoardSmith #169). `walk` is written with
    // `worldAction()` -- the ordered declaration walk, `.needs()` for round one
    // and a `needs:` on the selection that names where it is going -- and lands
    // in the same `_actions` registry a table's action lands in. What the
    // bundle exports is a plain array, and `createWorld` registers it.
    actions: [
      worldAction<WorldGame>('walk')
        .prompt('Walk into another room')
        .needs(() => ['rooms:index'])
        .chooseFrom('to', {
          prompt: 'Where to?',
          needs: () => ['rooms:index'],
          choices: ['hall', 'cellar'],
        })
        .execute(() => {}),
    ],
    genesis: () => ({}) as Record<string, GameElement>,
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
    expect(definition.world).toHaveProperty('actions');
    expect(definition.world).toHaveProperty('genesis');
    expect(definition.world).toHaveProperty('view');
  });

  it('sends the reader to the document that owns the contract', () => {
    expect(
      types,
      'A world author needs to be told where the authoring guide is.',
    ).toContain('docs/persistent-worlds.md');
  });
});

/**
 * #165: ONE DECLARATION, IMPORTED. The field's type must come from the world
 * module, because the alternative -- a shape restated in this file -- is the
 * second authority that #304 was right to refuse and that the extraction exists
 * to make unnecessary.
 */
describe('#165: the world block is typed by boardsmith/world', () => {
  it('imports the shape rather than restating it', () => {
    expect(
      /import type \{ WorldDefinition \} from '\.\.\/world\/definition\.js';/.test(types),
      'GameDefinition.world must be typed by the module that runs it. A local copy of the ' +
        'shape is a second authority, free to drift from the runtime that enforces it.',
    ).toBe(true);
    expect(types).toContain('world?: WorldDefinition;');
  });

  it('declares no world shape of its own', () => {
    // The open record #304 introduced, and any successor to it. A block typed
    // as an untyped record is the state this ticket reverses.
    expect(types).not.toContain('PlatformWorldBlock');
    expect(
      /world\?: Readonly<Record<string, unknown>>/.test(types),
      'An open record here would put the contract back where three games had to hand-copy it.',
    ).toBe(false);
  });
});
