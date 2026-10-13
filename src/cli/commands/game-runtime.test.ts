/**
 * importRuntimeBundle builds CLI-side source (the simulation loop, the world host, the
 * table-reload hook) into the rules bundle. That is one engine only when the CLI and the
 * game's `boardsmith` are the same install (#696).
 */
import { cpSync, existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cliSourceFile, importRuntimeBundle, toPosix } from './game-runtime.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

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
    exports,
  });
}

describe('importRuntimeBundle: one boardsmith per bundle (#696)', () => {
  it('builds CLI-side source with rules that use this same install', async () => {
    const module = await bundle(linkedToThisCheckout, [simShard]);
    expect(typeof module.playShard).toBe('function');
  });

  it.skipIf(!caseInsensitive)('treats a link to this checkout in other letter case as this same install', async () => {
    const module = await bundle(linkedToThisCheckoutMiscased, [simShard]);
    expect(typeof module.playShard).toBe('function');
  });

  it("refuses to build CLI-side source with rules that use another install, naming both", async () => {
    await expect(bundle(linkedToOtherInstall, [simShard])).rejects.toThrow(
      `This game's rules import boardsmith from ${otherInstall}, but this boardsmith command runs from ${REPO}`,
    );
    await expect(bundle(linkedToOtherInstall, [simShard])).rejects.toThrow(`npm install ${REPO}`,
    );
  });

  it('still loads rules alone from another install, since nothing of the CLI is in that bundle', async () => {
    const module = await bundle(linkedToOtherInstall, []);
    expect(module.gameDefinition.gameType).toBe('one-engine');
  });
});
