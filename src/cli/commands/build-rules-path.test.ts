/**
 * `boardsmith build` reads its rules from where the manifest says they are
 * (#531). `paths.rules` is honoured by `dev`, `simulate` and `validate`; a build
 * that hardcoded `src/rules` either failed on a project laid out another way or,
 * worse, shipped an old `src/rules` left beside the real one.
 *
 * It also empties its output folder first, so a file an earlier build left there cannot ship
 * (#842), and refuses an output folder that holds the project or is not a build output.
 *
 * Both builds run while the file is collected, where no test timeout applies,
 * because each runs Vite twice and bundles the rules (#363). The tests assert
 * what the builds left behind.
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildCommand, buildProject, outDirRefusal } from './build.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/** A real game class, so the build can load the rules it compiled. */
const fixtureGame = resolve(dirname(fileURLToPath(import.meta.url)), 'simulate.fixture.ts');
// These tests run the fixture by its path; this links them to it, loading nothing (#1415).
import.meta.glob('./simulate.fixture.ts');

/** Rules whose only distinguishing fact is their seat range. */
function rulesSource(maxPlayers: number): string {
  return [
    `import { DeadEndGame } from ${JSON.stringify(fixtureGame)};`,
    `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', minPlayers: 3, maxPlayers: ${maxPlayers} };`,
    '',
  ].join('\n');
}

/** A table project whose real rules live in `custom/rules`, optionally with a decoy `src/rules`. */
function customRulesProject(decoy: boolean): string {
  // One level down, so a test can hand build a folder holding the project that is still its own.
  const tree = tempTree('boardsmith-build-rules-path-');
  const dir = join(tree, 'game');
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'boardsmith.json'),
    JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table', paths: { rules: 'custom/rules' } }),
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body></body></html>\n');
  mkdirSync(join(dir, 'custom', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'custom', 'rules', 'index.ts'), rulesSource(5));
  if (decoy) {
    mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
    writeFileSync(join(dir, 'src', 'rules', 'index.ts'), rulesSource(9));
  }
  return dir;
}

/** Runs build from inside `dir`, then restores the cwd. Returns what it threw, if anything. */
async function buildIn(dir: string): Promise<unknown> {
  const originalCwd = process.cwd();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(dir);
  try {
    await buildCommand({});
    return undefined;
  } catch (thrown) {
    return thrown;
  } finally {
    process.chdir(originalCwd);
    log.mockRestore();
  }
}

function builtManifest(dir: string): { playerCount?: { min: number; max: number } } {
  return JSON.parse(readFileSync(join(dir, 'dist', 'manifest.json'), 'utf-8'));
}

function builtRules(dir: string): string {
  return readFileSync(join(dir, 'dist', 'rules', 'rules.js'), 'utf-8');
}

const onlyCustom = customRulesProject(false);
const onlyCustomError = await buildIn(onlyCustom);

// An earlier build's output, plus an asset since deleted from public/.
const withStale = customRulesProject(false);
mkdirSync(join(withStale, 'dist', 'rules'), { recursive: true });
writeFileSync(join(withStale, 'dist', 'rules', 'rules.js'), '');
writeFileSync(join(withStale, 'dist', 'removed-from-public.png'), '');
const withStaleError = await buildIn(withStale);

const withDecoy = customRulesProject(true);
const withDecoyError = await buildIn(withDecoy);

describe('boardsmith build honours paths.rules (#531)', () => {
  it('builds a project whose rules live only at paths.rules', () => {
    expect(onlyCustomError).toBeUndefined();
    expect(builtManifest(onlyCustom).playerCount).toEqual({ min: 3, max: 5 });
  });

  it('builds the rules paths.rules names, not an old src/rules beside them', () => {
    expect(withDecoyError).toBeUndefined();
    expect(builtManifest(withDecoy).playerCount).toEqual({ min: 3, max: 5 });
    expect(builtRules(withDecoy)).not.toMatch(/maxPlayers:\s*9/);
  });
});

describe('boardsmith build stops by throwing, so a command running it stops too (#532)', () => {
  it('rejects, naming the file and key, when package.json states no version', async () => {
    const dir = customRulesProject(false);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    await expect(buildProject(dir, {})).rejects.toThrow(/package\.json[\s\S]*version/);
  });

  it('rejects naming the rules entry it looked for when paths.rules points nowhere', async () => {
    const dir = customRulesProject(false);
    writeFileSync(
      join(dir, 'boardsmith.json'),
      JSON.stringify({ name: 'fixture', backend: 'table', paths: { rules: 'missing/rules' } }),
    );
    await expect(buildProject(dir, {})).rejects.toThrow(join(dir, 'missing', 'rules', 'index.ts'));
  });
});

describe('boardsmith build empties its output folder, and only a build output folder (#842)', () => {
  it('leaves no file from an earlier build in the output', () => {
    expect(withStaleError).toBeUndefined();
    expect(existsSync(join(withStale, 'dist', 'removed-from-public.png'))).toBe(false);
    expect(builtManifest(withStale).playerCount).toEqual({ min: 3, max: 5 });
  });

  it('refuses the project folder as --out-dir and deletes nothing', async () => {
    const dir = customRulesProject(false);
    await expect(buildProject(dir, { outDir: dir })).rejects.toThrow(/project folder/);
    expect(existsSync(join(dir, 'custom', 'rules', 'index.ts'))).toBe(true);
  });

  it('refuses a folder holding the project as --out-dir and deletes nothing', async () => {
    const dir = customRulesProject(false);
    await expect(buildProject(dir, { outDir: join(dir, '..') })).rejects.toThrow(/project folder/);
    expect(existsSync(join(dir, 'custom', 'rules', 'index.ts'))).toBe(true);
  });

  it('refuses a symlink as --out-dir, here to the project, and deletes nothing', async () => {
    const dir = customRulesProject(false);
    const link = join(dir, '..', 'link-to-game');
    symlinkSync(dir, link);
    await expect(buildProject(dir, { outDir: link })).rejects.toThrow(/symlink/);
    expect(existsSync(link)).toBe(true);
    expect(existsSync(join(dir, 'custom', 'rules', 'index.ts'))).toBe(true);
  });

  // macOS's default disk ignores letter case; elsewhere the upper-cased path is another folder.
  const caseProject = customRulesProject(false);
  it.skipIf(!existsSync(caseProject.toUpperCase()))('refuses the project folder named in other letter case', async () => {
    await expect(buildProject(caseProject, { outDir: caseProject.toUpperCase() })).rejects.toThrow(/project folder/);
    expect(existsSync(join(caseProject, 'custom', 'rules', 'index.ts'))).toBe(true);
  });

  it('refuses the filesystem root as holding the project', () => {
    // The pure check only: a build is never run against `/`.
    expect(outDirRefusal(customRulesProject(false), '/')).toMatch(/project folder or a folder holding it/);
  });

  it('refuses a file as --out-dir and leaves it', async () => {
    const dir = customRulesProject(false);
    const out = join(dir, 'out.txt');
    writeFileSync(out, 'keep me');
    await expect(buildProject(dir, { outDir: out })).rejects.toThrow(/is a file, not a folder/);
    expect(readFileSync(out, 'utf-8')).toBe('keep me');
  });

  it('refuses a folder that is not an earlier build output and deletes nothing', async () => {
    const dir = customRulesProject(false);
    const out = join(dir, 'notes');
    mkdirSync(out);
    writeFileSync(join(out, 'todo.txt'), 'keep me');
    await expect(buildProject(dir, { outDir: out })).rejects.toThrow(/rules\/rules\.js/);
    expect(readFileSync(join(out, 'todo.txt'), 'utf-8')).toBe('keep me');
  });
});

describe('boardsmith build refuses a linked folder in public/ (#1114)', () => {
  it('names the link and leaves the earlier dist/ untouched, since publish cannot follow it once copied to dist/', async () => {
    const dir = customRulesProject(false);
    mkdirSync(join(dir, 'art'));
    mkdirSync(join(dir, 'public'));
    symlinkSync(join(dir, 'art'), join(dir, 'public', 'cards'), 'dir');
    // An earlier build's output, which a refusal must leave as it was.
    mkdirSync(join(dir, 'dist', 'rules'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'rules', 'rules.js'), 'earlier build');
    await expect(buildProject(dir, {})).rejects.toThrow(
      `${join(dir, 'public', 'cards')} is a link to a folder, and links are followed only to files. Replace the link with a copy of what it should point to.`,
    );
    expect(readFileSync(join(dir, 'dist', 'rules', 'rules.js'), 'utf-8')).toBe('earlier build');
  });
});
