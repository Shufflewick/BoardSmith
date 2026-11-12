/**
 * `boardsmith build` targets the oldest browsers a game supports and fails when the bundle still
 * holds JavaScript or CSS they cannot parse (#1633). One unsupported construct in a bundle blanks
 * every game that ships it (#1631). Each build runs while the file is collected, where no test
 * timeout applies (#363); the tests assert what it left behind.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildProject } from './build.js';
import { BROWSER_FLOOR_NAMES } from '../lib/browser-floor.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import guide from '../../../docs/custom-ui-guide.md';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const fixtureGame = join(here, 'simulate.fixture.ts');
// These builds read the fixture, the shipped UI and the folders it imports by path; this links them, loading nothing (#1415).
import.meta.glob(['./simulate.fixture.ts', '/src/{ui,engine,session,client,runtime,types,world,utils}/**/*.{ts,vue}', '!/src/**/*.test.ts', '!/src/**/*.test-helper.ts', '/src/vite-config/index.js']);

/** A table project whose UI entry is `main` and whose files are `files`. */
function project(main: string, files: Record<string, string> = {}): string {
  const dir = tempTree('boardsmith-build-browser-floor-');
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table' }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n');
  writeFileSync(join(dir, 'src', 'main.ts'), main);
  writeFileSync(
    join(dir, 'src', 'rules', 'index.ts'),
    `import { DeadEndGame } from ${JSON.stringify(fixtureGame)};\n` +
      "export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', minPlayers: 3, maxPlayers: 4 };\n",
  );
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  return dir;
}

async function build(dir: string): Promise<unknown> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await buildProject(dir, {});
    return undefined;
  } catch (thrown) {
    return thrown;
  } finally {
    log.mockRestore();
  }
}

/** Every built file of `dir` ending in `extension`, joined. */
const built = (dir: string, extension: string) => {
  const assets = join(dir, 'dist', 'ui', 'assets');
  return readdirSync(assets).filter((file) => file.endsWith(extension)).map((file) => readFileSync(join(assets, file), 'utf-8')).join('\n');
};

// The whole of boardsmith/ui and its subpaths, mounted the way a game's bundle carries them.
const shipped = project(
  ['index', 'components/auto-ui/index', 'components/dice/index', 'debug']
    .map((path, i) => `import * as ui${i} from ${JSON.stringify(join(repo, 'src', 'ui', `${path}.ts`))};`)
    .join('\n') + '\nconsole.log(ui0, ui1, ui2, ui3);\n',
  { 'vite.config.mjs': `import { defineGameViteConfig } from ${JSON.stringify(pathToFileURL(join(repo, 'src', 'vite-config', 'index.js')).href)};\nexport default defineGameViteConfig();\n` },
);
// A game installs vue, which the shipped UI imports.
symlinkSync(join(repo, 'node_modules'), join(shipped, 'node_modules'));
const shippedError = await build(shipped);

const regexSets = project("console.log(/[\\p{L}--[a-z]]/v.test('é'));\n");
const regexSetsError = await build(regexSets);

const startingStyle = project("import './style.css';\n", { 'src/style.css': '.panel { opacity: 1; }\n@starting-style { .panel { opacity: 0; } }\n' });
const startingStyleError = await build(startingStyle);

const staticBlock = project("class Ready { static { console.log('ready'); } }\nconsole.log(Ready);\n");
const staticBlockError = await build(staticBlock);

const nested = project("import './style.css';\n", { 'src/style.css': '.panel { color: red; & .title { color: blue; } }\n' });
const nestedError = await build(nested);

describe('boardsmith build holds the bundle to the browser floor (#1633)', () => {
  it('builds every file boardsmith/ui ships', () => {
    expect(shippedError).toBeUndefined();
  });

  it('fails on JavaScript syntax newer than the floor, naming the file and the code', () => {
    expect(String(regexSetsError)).toMatch(/assets\/index-[\w-]+\.js[\s\S]*Safari 16\.4[\s\S]*\/v/);
  });

  it('fails on CSS newer than the floor, naming the file and the rule', () => {
    expect(String(startingStyleError)).toMatch(/assets\/index-[\w-]+\.css[\s\S]*Safari 16\.4[\s\S]*@starting-style/);
  });

  it('leaves syntax the floor has as written, such as a class static block', () => {
    expect(staticBlockError).toBeUndefined();
    expect(built(staticBlock, '.js')).toMatch(/static\{/);
  });

  it('rewrites CSS the floor lacks but can be lowered to, such as nesting', () => {
    expect(nestedError).toBeUndefined();
    expect(built(nested, '.css')).toContain('.panel .title{color:#00f}');
  });

  it('is the floor custom-ui-guide.md states', () => {
    expect(guide).toContain(`The oldest browsers a game supports are ${BROWSER_FLOOR_NAMES}.`);
  });
});
