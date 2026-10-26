/**
 * FIXTURES THE `boardsmith verify` TESTS SHARE (the verify*.test.ts files): a bare repository, and
 * the acceptance fixture (#452), a game whose branch breaks a test outside the files it changed.
 */
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { GAME_VITE_CONFIG } from '../lib/test-run-scope.js';
import { commitAll, git, initRepo, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { makeChunkProject } from './chunk-project.test-helper.js';
import { recordSignoff } from './chunk-signoff.js';
import { VERIFY_CHECKS } from './verify.js';

/** A repository on `main` with one commit, holding `files`. */
export async function repo(files: Record<string, string>): Promise<string> {
  const tree = tempTree('bs-verify-');
  const dir = join(tree, 'game');
  await write(dir, { '.gitignore': '.boardsmith/\nnode_modules\n', ...files });
  initRepo(dir);
  commitAll(dir, 'base');
  return dir;
}

// -------------------------------------------------------------------------------------------
// The acceptance fixture (#452): a claim of green is refused when one test outside the changed
// files fails, and accepted once the whole suite is green.
// -------------------------------------------------------------------------------------------

const RULES = `export function bid(high: number, offer: number): boolean {
  return offer > high;
}
`;

const BID_TEST = `import { it, expect } from 'vitest';
import { bid } from '../src/rules';
it('a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });
it('an equal offer loses', () => { expect(bid(3, 3)).toBe(false); });
`;

export const FEE_TEST = `import { it, expect } from 'vitest';
import { fee } from '../src/rules';
it('the fee is twice the price', () => { expect(fee(3)).toBe(6); });
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', noEmit: true, skipLibCheck: true },
  include: ['src', 'tests'],
});

/**
 * A game project with one chunk, built on a branch off `main`: the branch adds `fee` and its test,
 * and (when `breakBid`) also changes `bid`, which breaks `tests/bid.test.ts`, a file the branch
 * never touched.
 */
export async function gameOnBranch(breakBid: boolean): Promise<string> {
  const tree = tempTree('bs-verify-game-');
  const dir = await makeChunkProject(tree, [{ slug: 'deal' }]);
  await write(dir, {
    '.gitignore': '.boardsmith/\nnode_modules\n',
    // An ES module package, as `boardsmith init` writes it, so its config can import boardsmith.
    'package.json': '{ "type": "module" }\n',
    'boardsmith.json': JSON.stringify({ name: 'fixture', backend: 'table' }),
    'vite.config.ts': GAME_VITE_CONFIG,
    'tsconfig.json': TSCONFIG,
    'src/rules.ts': RULES,
    'tests/bid.test.ts': BID_TEST,
  });
  linkGameModules(dir);
  initRepo(dir);
  commitAll(dir, 'base');
  git(dir, 'checkout', '-q', '-b', 'chunk/deal');
  await write(dir, {
    'src/rules.ts':
      (breakBid ? RULES.replace('offer > high', 'offer >= high') : RULES) +
      'export function fee(price: number): number {\n  return price * 2;\n}\n',
    'tests/fee.test.ts': FEE_TEST,
  });
  commitAll(dir, 'chunk-deal/build');
  return dir;
}

/**
 * `build`, `validate` and `smoke` need a whole game (a UI, a bundle, a page to open); this fixture
 * is the rules of one. They stand in as passing here, so a refusal can only come from the checks
 * that really ran: the full suite, the type check and the mutation check. `verify-command.test.ts`
 * and `verify-whole-game.test.ts` run the real `boardsmith verify`, all seven checks, as a user would.
 */
export const CHECKS = {
  ...VERIFY_CHECKS,
  build: async () => ({ passed: true, summary: 'stood in for by the fixture' }),
  validate: async () => ({ passed: true, summary: 'stood in for by the fixture' }),
  smoke: async () => ({ passed: true, summary: 'stood in for by the fixture' }),
};

export const signoff = (project: string) =>
  recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: new Date('2026-09-29T12:00:00Z') });

/** `checks` with a build that writes an uncommitted file into the project while verify runs. */
export function dirtiesTheTree<T extends object>(dir: string, checks: T): T {
  return {
    ...checks,
    build: async () => {
      await write(dir, { 'notes.md': 'written while verify ran\n' });
      return { passed: true, summary: 'stood in for by the fixture' };
    },
  };
}

/** Every check stood in for as passing, counting how many ran: for the tests about when verify runs at all. */
export function countingChecks() {
  const ran: string[] = [];
  const stub = (name: string) => async () => {
    ran.push(name);
    return { passed: true, summary: `${name} stood in for by the fixture` };
  };
  const checks = {
    test: stub('test'),
    typecheck: stub('typecheck'),
    build: stub('build'),
    validate: stub('validate'),
    smoke: stub('smoke'),
    verbs: stub('verbs'),
    mutation: stub('mutation'),
  };
  return { ran, checks };
}

