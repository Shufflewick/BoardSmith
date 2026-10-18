/**
 * importRuntimeBundle builds CLI-side source (the simulation loop, the world host, the
 * table-reload hook) into the rules bundle. That is one engine only when the CLI and the
 * game's `boardsmith` are the same install (#696).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { cliSourceFile, importRuntimeBundle, toPosix } from './game-runtime.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import type { executeOp } from '../../session/index.js';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));

/** A game whose rules import `boardsmith`, installed as `node_modules/boardsmith` by `install`. */
function game(install: (target: string) => void): string {
  const dir = tempTree('boardsmith-one-engine-');
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'one-engine' }));
  writeFileSync(
    join(dir, 'src', 'rules', 'index.ts'),
    [
      `import { Game } from 'boardsmith';`,
      `class OneEngineGame extends Game {}`,
      `export const gameDefinition = { gameClass: OneEngineGame, gameType: 'one-engine', displayName: 'One engine', minPlayers: 2, maxPlayers: 2 };`,
    ].join('\n'),
  );
  mkdirSync(join(dir, 'node_modules'));
  install(join(dir, 'node_modules', 'boardsmith'));
  return dir;
}

// A second boardsmith install at another real path: this checkout's manifest and sources, copied.
// Copied once here, at the top, where no test timeout applies.
const otherInstall = realpathSync(tempTree('boardsmith-other-install-'));
cpSync(join(REPO, 'package.json'), join(otherInstall, 'package.json'));
cpSync(join(REPO, 'src'), join(otherInstall, 'src'), {
  recursive: true,
  filter: (path) => !/\.test(-helper)?\.[cm]?[jt]s$|__fixtures__/.test(path),
});

const linkedToThisCheckout = game((target) => symlinkSync(REPO, target, 'dir'));
const linkedToOtherInstall = game((target) => symlinkSync(otherInstall, target, 'dir'));
// The same checkout, named in other letter case (`file:../../boardsmith`), which a
// case-insensitive file system (macOS by default) resolves to the same directory.
const miscasedRepo = REPO.toLowerCase() === REPO ? REPO.toUpperCase() : REPO.toLowerCase();
const caseInsensitive = existsSync(miscasedRepo);
const linkedToThisCheckoutMiscased = game((target) => symlinkSync(miscasedRepo, target, 'dir'));

const simShard = `export { playShard } from ${JSON.stringify(toPosix(cliSourceFile('lib/sim-shard.ts')))};`;

function bundle(project: string, exports: string[]) {
  return importRuntimeBundle({
    rulesPath: join(project, 'src', 'rules'),
    tempDir: tempTree('boardsmith-one-engine-build-'),
    name: 'one-engine',
    context: 'standalone',
    gameOptions: undefined,
    exports,
  });
}

// Each bundle builds the whole engine, so all are built here, where no test timeout applies (#1127).
const thisInstall = await bundle(linkedToThisCheckout, [simShard]);
const thisInstallMiscased = caseInsensitive ? await bundle(linkedToThisCheckoutMiscased, [simShard]) : undefined;
const otherInstallRefusal = await bundle(linkedToOtherInstall, [simShard]).then(() => undefined, (error: unknown) => error);
const otherInstallRulesOnly = await bundle(linkedToOtherInstall, []);

describe('importRuntimeBundle: one boardsmith per bundle (#696)', () => {
  it('builds CLI-side source with rules that use this same install', () => {
    expect(typeof thisInstall.playShard).toBe('function');
  });

  it.skipIf(!caseInsensitive)('treats a link to this checkout in other letter case as this same install', () => {
    expect(typeof thisInstallMiscased!.playShard).toBe('function');
  });

  it("refuses to build CLI-side source with rules that use another install, naming both", () => {
    expect(otherInstallRefusal).toBeInstanceOf(Error);
    expect((otherInstallRefusal as Error).message).toContain(
      `This game's rules import boardsmith from ${otherInstall}, but this boardsmith command runs from ${REPO}`,
    );
    expect((otherInstallRefusal as Error).message).toContain(`npm install ${REPO}`);
  });

  it('still loads rules alone from another install, since nothing of the CLI is in that bundle', () => {
    expect(otherInstallRulesOnly.gameDefinition.gameType).toBe('one-engine');
  });
});

// A game whose setup crashes on line 6 of its own rules file.
const crashingGame = game(() => {});
writeFileSync(
  join(crashingGame, 'src', 'rules', 'index.ts'),
  [
    `import { Game } from 'boardsmith';`,
    `class CrashGame extends Game {`,
    `  constructor(options: any) {`,
    `    super(options);`,
    `    const deck: any = undefined;`,
    `    deck.cards.length;`,
    `  }`,
    `}`,
    `export const gameDefinition = { gameClass: CrashGame, gameType: 'crash', displayName: 'Crash', minPlayers: 2, maxPlayers: 2 };`,
  ].join('\n'),
);
// Bundled once here, at the top, where no test timeout applies.
const crashingRuntime = await importRuntimeBundle({
  rulesPath: join(crashingGame, 'src', 'rules'),
  tempDir: tempTree('boardsmith-crash-build-'),
  name: 'crash',
  context: 'monorepo',
  gameOptions: undefined,
  exports: [`export { executeOp } from 'boardsmith/session';`],
});

describe('importRuntimeBundle: a crash names the line in the game it came from (#1103)', () => {
  it("logs the crash's stack at the game's own source line, not the bundle's", async () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const run = crashingRuntime.executeOp as typeof executeOp;
      const result = await run(crashingRuntime.gameDefinition, { playerCount: 2 }, null, null, { type: 'start' });
      expect(result.success).toBe(false);
      const crash = printed.mock.calls.flat().find((arg): arg is Error => arg instanceof Error);
      expect(crash?.stack).toContain(`${join(realpathSync(crashingGame), 'src', 'rules', 'index.ts')}:6:`);
    } finally {
      printed.mockRestore();
    }
  });

  it("keeps the map to its line mappings, without a copy of every source file's text", () => {
    // `boardsmith dev` imports a new bundle on every rules save and Node never unloads the old ones.
    const bundled = readFileSync(crashingRuntime.bundlePath, 'utf8');
    const inline = /\/\/# sourceMappingURL=data:application\/json;base64,(\S+)\s*$/.exec(bundled);
    expect(inline).not.toBeNull();
    const map = JSON.parse(Buffer.from(inline![1], 'base64').toString('utf8'));
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sourcesContent).toBeUndefined();
  });
});
