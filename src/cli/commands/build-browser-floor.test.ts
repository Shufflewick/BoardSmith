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

// One stylesheet for the whole bundle, which Vite emits after the per-chunk ones (#1633 review F2).
const oneStylesheet = project("import './style.css';\n", {
  'src/style.css': '@starting-style { .panel { opacity: 0; } }\n',
  'vite.config.mjs': 'export default { build: { cssCodeSplit: false } };\n',
});
const oneStylesheetError = await build(oneStylesheet);

// Tailwind v4's container utilities escape `@` in class names, and `@font-feature-values` holds at-rules of its own (#1633 review F1, F4).
const floorCss = project("import './style.css';\n", {
  'src/style.css': '.\\@container { container-type: inline-size; }\n@container (min-width: 28rem) { .\\@md\\:flex { display: flex; } }\n@font-feature-values Fancy { @styleset { nice: 12; } @swash { flowing: 1; } }\n',
});
const floorCssError = await build(floorCss);

// Tailwind v4's `before:content-['']` escapes quotes in its class name; an above-floor rule after it must still fail (#1634).
const escapedQuote = project("import './style.css';\n", {
  'src/style.css': String.raw`.before\:content-\[\\\"\\\"\]:before{--tw-content:\"\";content:var(--tw-content)}
.panel{opacity:1}
@starting-style{.panel{opacity:0}}
.c{content:"a"}
`,
});
const escapedQuoteError = await build(escapedQuote);

// Each of these once hid the above-floor rules after it from the check (#1634 review F1, F2, F3, F5). Unminified, so the check sees them as written.
const hidingCss: Record<string, string> = {
  'a quoted url() holding a parenthesis': `.a{background:url("data:image/svg+xml,%3csvg fill='rgb(0,0,0)'%3e")}\n@starting-style{.p{opacity:0}}\n.c{content:'x'}\n`,
  'a string with a line continuation': `.a{content:"ab\\\ncd"}\n@starting-style{.p{opacity:0}}\n.c{content:"x"}\n`,
  'an unquoted url() with an escaped parenthesis': `.a{background:url(a\\)b'c.png)}\n@starting-style{.p{opacity:0}}\n.c{content:'x'}\n`,
  'an upper-case function name': `.a{color:LIGHT-DARK(red,blue)}\n`,
};
const hidingCssErrors = Object.fromEntries(
  await Promise.all(Object.entries(hidingCss).map(async ([name, css]) => [name, await build(project("import './style.css';\n", { 'src/style.css': css, 'vite.config.mjs': 'export default { build: { cssMinify: false } };\n' }))])),
);

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

  it('checks a stylesheet Vite emits for the whole bundle', () => {
    expect(String(oneStylesheetError)).toMatch(/assets\/[\w-]+\.css[\s\S]*Safari 16\.4[\s\S]*@starting-style/);
  });

  it('fails on CSS newer than the floor after an escaped quote in a class name', () => {
    expect(String(escapedQuoteError)).toMatch(/assets\/index-[\w-]+\.css[\s\S]*Safari 16\.4[\s\S]*@starting-style/);
  });

  it.each(Object.keys(hidingCss))('fails on CSS newer than the floor after %s', (name) => {
    expect(String(hidingCssErrors[name])).toMatch(/assets\/index-[\w-]+\.css[\s\S]*Safari 16\.4[\s\S]*(@starting-style|LIGHT-DARK\()/i);
  });

  it('passes CSS the floor parses: escaped @ in a class name, and @font-feature-values blocks', () => {
    expect(floorCssError).toBeUndefined();
    expect(built(floorCss, '.css')).toContain('@styleset');
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
