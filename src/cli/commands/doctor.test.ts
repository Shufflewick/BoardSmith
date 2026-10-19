import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { appendGitignoreEntry, doctorCommand } from './doctor.js';
import { DESIGN_DIR, SCRATCH_DIR } from '../lib/project-paths.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { GAME_VITE_CONFIG, GAME_VITE_CONFIG_FILE } from '../lib/test-run-scope.js';
import { INGEST_PRE_COMMIT_HOOK, installIngestHook } from '../lib/ingest-hook.js';

/**
 * `doctor` is issue #6's migration path: design artifacts belong under `design/`, throwaway
 * scripts under `.boardsmith/scratch/`, and NOTHING is ever deleted.
 *
 * Every fixture is a real temp project (and, where tracking matters, a real temp git repo built
 * with `git init` + a commit, per `drift-check.test.ts`'s convention). No test reads or writes
 * anything under `~/BoardSmithGames/`.
 */

let dir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = tempTree('bs-doctor-');
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(async () => {
  logSpy.mockRestore();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/**
 * A minimal project: just enough for `doctor` to accept it.
 *
 * It gets a `.gitignore` that already covers `.boardsmith/`, and the vite config `init` writes,
 * by default, so neither finding shows up as noise in every other test. The tests that exercise
 * those rules pass their own files (or `{ gitignore: false }` / `{ testConfig: false }` for none).
 */
async function project(
  files: Record<string, string> = {},
  opts: { gitignore?: boolean; testConfig?: boolean } = {},
): Promise<string> {
  const projectDir = join(dir, 'game');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(join(projectDir, 'boardsmith.json'), '{"name":"game"}\n');
  if (opts.gitignore !== false && !('.gitignore' in files)) {
    await fs.writeFile(join(projectDir, '.gitignore'), 'node_modules/\n.boardsmith/\n');
  }
  if (opts.testConfig !== false && !(GAME_VITE_CONFIG_FILE in files)) {
    await fs.writeFile(join(projectDir, GAME_VITE_CONFIG_FILE), GAME_VITE_CONFIG);
  }
  for (const [path, content] of Object.entries(files)) {
    await fs.mkdir(join(projectDir, path, '..'), { recursive: true });
    await fs.writeFile(join(projectDir, path), content);
  }
  return projectDir;
}

/** Turns a project into a git repo with everything committed. */
function commitAll(projectDir: string): void {
  execSync('git init', { cwd: projectDir, stdio: 'ignore' });
  execSync('git add -A', { cwd: projectDir, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m first', {
    cwd: projectDir,
    stdio: 'ignore',
  });
}

const read = (p: string) => fs.readFile(p, 'utf-8');

/** Everything the human report printed, with colour codes stripped. */
const printed = () =>
  logSpy.mock.calls
    .map((c) => String(c[0]))
    .join('\n')
    .replace(/\u001b\[[0-9;]*m/g, '');
const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

describe('boardsmith doctor', () => {
  it('rejects a directory that is not a game project', async () => {
    await expect(doctorCommand({ project: dir })).rejects.toThrow(/No boardsmith\.json/);
  });

  it('reports a current-layout project as healthy and exits zero', async () => {
    const projectDir = await project({
      [`${DESIGN_DIR}/SKETCH.md`]: '# sketch\n',
      [`${DESIGN_DIR}/chunks/jab/CHUNK.md`]: '# jab\n',
      'src/rules/index.ts': 'export {};\n',
    });

    const result = await doctorCommand({ project: projectDir });

    expect(result.healthy).toBe(true);
    expect(result.findings).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports misplaced design artifacts without moving them, and exits non-zero', async () => {
    const projectDir = await project({
      'SKETCH.md': '# sketch\n',
      'RULINGS.md': '# rulings\n',
      'chunks/jab/CHUNK.md': '# jab\n',
      'rulebook/INDEX.md': '# index\n',
    });

    const result = await doctorCommand({ project: projectDir });

    expect(result.healthy).toBe(false);
    expect(result.counts).toEqual({ moved: 0, pending: 4, conflicts: 0 });
    expect(result.findings.map((f) => f.from).sort()).toEqual([
      'RULINGS.md',
      'SKETCH.md',
      'chunks',
      'rulebook',
    ]);
    // Report-only: everything is still exactly where it was.
    expect(await exists(join(projectDir, 'SKETCH.md'))).toBe(true);
    expect(await exists(join(projectDir, DESIGN_DIR, 'SKETCH.md'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('--fix moves design artifacts into design/, content intact', async () => {
    const projectDir = await project({
      'SKETCH.md': '# sketch\n',
      'DECISIONS.md': '# decisions\n',
      'chunks/jab/CHUNK.md': '# jab\n',
      'rulebook/INDEX.md': '# index\n',
      'rulebook/source/rules.pdf': 'PDF',
    });

    const result = await doctorCommand({ project: projectDir, fix: true });

    expect(result.counts.pending).toBe(0);
    expect(result.counts.conflicts).toBe(0);
    expect(result.findings.every((f) => f.fixed)).toBe(true);

    expect(await read(join(projectDir, DESIGN_DIR, 'SKETCH.md'))).toBe('# sketch\n');
    expect(await read(join(projectDir, DESIGN_DIR, 'chunks', 'jab', 'CHUNK.md'))).toBe('# jab\n');
    expect(await read(join(projectDir, DESIGN_DIR, 'rulebook', 'source', 'rules.pdf'))).toBe('PDF');
    expect(await exists(join(projectDir, 'SKETCH.md'))).toBe(false);
    expect(await exists(join(projectDir, 'chunks'))).toBe(false);
  });

  it('leaves non-design files in the project root alone', async () => {
    const projectDir = await project({
      'SKETCH.md': '# sketch\n',
      'package.json': '{}\n',
      'src/rules/index.ts': 'export {};\n',
      'tests/a.test.ts': 'export {};\n',
      'public/card.png': 'PNG',
      'README.md': '# readme\n',
    });

    await doctorCommand({ project: projectDir, fix: true });

    for (const kept of ['package.json', 'README.md', 'src/rules/index.ts', 'tests/a.test.ts']) {
      expect(await exists(join(projectDir, kept))).toBe(true);
    }
    expect(await exists(join(projectDir, DESIGN_DIR, 'README.md'))).toBe(false);
  });

  it('--fix moves stray scratch scripts into .boardsmith/scratch/ rather than deleting them', async () => {
    // The exact filenames issue #6 reported.
    const projectDir = await project({
      '_dbg.mjs': 'console.log(1)\n',
      '_dbg2.mjs': 'console.log(2)\n',
      '_cap_tmp.mjs': 'console.log(3)\n',
      '_drive_tmp.mjs': 'console.log(4)\n',
      '_drive2_tmp.mjs': 'console.log(5)\n',
    });

    const result = await doctorCommand({ project: projectDir, fix: true });

    expect(result.findings.filter((f) => f.kind === 'scratch-in-root')).toHaveLength(5);
    // Moved, NOT deleted — content survives verbatim.
    expect(await read(join(projectDir, SCRATCH_DIR, '_dbg.mjs'))).toBe('console.log(1)\n');
    expect(await read(join(projectDir, SCRATCH_DIR, '_drive2_tmp.mjs'))).toBe('console.log(5)\n');
    expect(await exists(join(projectDir, '_dbg.mjs'))).toBe(false);
  });

  it('does not treat an ordinary root script as scratch', async () => {
    const projectDir = await project({
      [GAME_VITE_CONFIG_FILE]: GAME_VITE_CONFIG,
      'build.mjs': 'export {}\n',
      '_dbg.mjs': 'console.log(1)\n',
    });

    const result = await doctorCommand({ project: projectDir, fix: true });

    expect(result.findings.map((f) => f.from)).toEqual(['_dbg.mjs']);
    expect(await exists(join(projectDir, 'vite.config.ts'))).toBe(true);
    expect(await exists(join(projectDir, 'build.mjs'))).toBe(true);
  });

  it('reports a conflict and clobbers nothing when both copies exist', async () => {
    const projectDir = await project({
      'SKETCH.md': 'root copy\n',
      [`${DESIGN_DIR}/SKETCH.md`]: 'design copy\n',
    });

    const result = await doctorCommand({ project: projectDir, fix: true });

    expect(result.counts).toEqual({ moved: 0, pending: 0, conflicts: 1 });
    expect(result.findings[0].kind).toBe('move-conflict');
    expect(result.findings[0].detail).toMatch(/will not choose between them/);
    // BOTH survive untouched.
    expect(await read(join(projectDir, 'SKETCH.md'))).toBe('root copy\n');
    expect(await read(join(projectDir, DESIGN_DIR, 'SKETCH.md'))).toBe('design copy\n');
    expect(process.exitCode).toBe(1);
  });

  it('reports a conflict, and moves nothing over it, when the design copy is a link it cannot follow (#1174)', async () => {
    const projectDir = await project({ 'SKETCH.md': 'root copy\n' });
    const designCopy = join(projectDir, DESIGN_DIR, 'SKETCH.md');
    await fs.mkdir(join(projectDir, DESIGN_DIR), { recursive: true });
    await fs.symlink(designCopy, designCopy);

    const result = await doctorCommand({ project: projectDir, fix: true });

    expect(result.findings.map((f) => f.kind)).toEqual(['move-conflict']);
    expect(await read(join(projectDir, 'SKETCH.md'))).toBe('root copy\n');
    expect(await fs.readlink(designCopy)).toBe(designCopy);
  });

  it('is idempotent — a second --fix run finds nothing and exits zero', async () => {
    const projectDir = await project({
      'SKETCH.md': '# sketch\n',
      'chunks/jab/CHUNK.md': '# jab\n',
      '_dbg.mjs': 'console.log(1)\n',
    });

    await doctorCommand({ project: projectDir, fix: true });
    process.exitCode = undefined;
    const second = await doctorCommand({ project: projectDir, fix: true });

    expect(second.healthy).toBe(true);
    expect(second.findings).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('uses git mv for tracked files so the move is staged, not a delete+add', async () => {
    const projectDir = await project({
      'SKETCH.md': '# sketch\n',
      'chunks/jab/CHUNK.md': '# jab\n',
    });
    commitAll(projectDir);

    await doctorCommand({ project: projectDir, fix: true });

    // `git mv` stages the rename; a plain fs.rename would leave the old path as an unstaged
    // deletion and the new path untracked.
    const status = execSync('git status --porcelain', { cwd: projectDir }).toString();
    expect(status).toMatch(/^R.*SKETCH\.md/m);
    expect(status).not.toMatch(/^\?\?\s+design\//m);
  });

  it('still migrates a project that is not a git repo at all', async () => {
    const projectDir = await project({ 'SKETCH.md': '# sketch\n' });

    await doctorCommand({ project: projectDir, fix: true });

    expect(await read(join(projectDir, DESIGN_DIR, 'SKETCH.md'))).toBe('# sketch\n');
  });

  it('does not create empty design/ or scratch dirs in a healthy project', async () => {
    const projectDir = await project({ 'src/rules/index.ts': 'export {};\n' });

    await doctorCommand({ project: projectDir, fix: true });

    expect(await exists(join(projectDir, DESIGN_DIR))).toBe(false);
    expect(await exists(join(projectDir, SCRATCH_DIR))).toBe(false);
  });

  it('untracks scratch it moved, so the junk stops being committed but stays on disk', async () => {
    // `.gitignore` has no effect on an already-tracked path, so a bare `git mv` would leave
    // `_dbg.mjs` committed at a tidier path — which is not what issue #6 asked for.
    const projectDir = await project({
      '.gitignore': 'node_modules/\n.boardsmith/\n',
      '_dbg.mjs': 'console.log(1)\n',
    });
    commitAll(projectDir);

    await doctorCommand({ project: projectDir, fix: true });

    const tracked = execSync('git ls-files', { cwd: projectDir }).toString();
    expect(tracked).not.toMatch(/_dbg\.mjs/);
    // Untracked, NOT deleted.
    expect(await read(join(projectDir, SCRATCH_DIR, '_dbg.mjs'))).toBe('console.log(1)\n');
  });

  it('reports and adds the .boardsmith/ ignore rule when .gitignore lacks it', async () => {
    const projectDir = await project({ '.gitignore': 'node_modules/\ndist/\n' });

    const before = await doctorCommand({ project: projectDir });
    expect(before.findings.map((f) => f.kind)).toEqual(['scratch-dir-not-ignored']);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await doctorCommand({ project: projectDir, fix: true });

    const gitignore = await read(join(projectDir, '.gitignore'));
    expect(gitignore).toMatch(/^\.boardsmith\/$/m);
    // The designer's existing rules survive.
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
  });

  it('creates a .gitignore when the project has none', async () => {
    const projectDir = await project({}, { gitignore: false });

    await doctorCommand({ project: projectDir, fix: true });

    expect(await read(join(projectDir, '.gitignore'))).toMatch(/^\.boardsmith\/$/m);
  });

  it('refuses, naming the file, when .gitignore cannot be read, and leaves it as it was (#1110)', async () => {
    const projectDir = await project({ '.gitignore': 'node_modules/\n' });
    const gitignore = join(projectDir, '.gitignore');
    await fs.chmod(gitignore, 0o200);
    try {
      await expect(doctorCommand({ project: projectDir, fix: true })).rejects.toThrow(`Could not read ${gitignore} (EACCES)`);
    } finally {
      await fs.chmod(gitignore, 0o644);
    }
    expect(await read(gitignore)).toBe('node_modules/\n');
  });

  it('the ignore-rule writer itself refuses an unreadable .gitignore and leaves it as it was (#1110)', async () => {
    const projectDir = await project({ '.gitignore': 'node_modules/\n' });
    const gitignore = join(projectDir, '.gitignore');
    await fs.chmod(gitignore, 0o200);
    try {
      await expect(appendGitignoreEntry(projectDir)).rejects.toThrow(`Could not read ${gitignore} (EACCES)`);
    } finally {
      await fs.chmod(gitignore, 0o644);
    }
    expect(await read(gitignore)).toBe('node_modules/\n');
  });

  it('a project whose .gitignore already covers .boardsmith/ is healthy', async () => {
    const projectDir = await project({ '.gitignore': 'node_modules/\n.boardsmith/\n' });

    const result = await doctorCommand({ project: projectDir });

    expect(result.healthy).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it.each(['.boardsmith', '/.boardsmith/', '/.boardsmith'])(
    'accepts %s, which git applies the same as .boardsmith/ (#846)',
    async (line) => {
      const projectDir = await project({ '.gitignore': `node_modules/\n${line}\n` });

      const result = await doctorCommand({ project: projectDir });

      expect(result.findings).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    },
  );

  it('--json emits the machine-readable result and no human report', async () => {
    const projectDir = await project({ 'SKETCH.md': '# sketch\n' });

    const result = await doctorCommand({ project: projectDir, json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(
      JSON.parse(JSON.stringify(result)),
    );
  });

  // #298, #528: chunk worktrees live under .boardsmith/worktrees/, inside the project, and a test run
  // that does not leave that directory out runs their unfinished tests too. The exclusions ship in
  // defineGameViteConfig, and --fix moves a project onto it.
  const OLD_VITE_CONFIG = [
    "import { defineConfig } from 'vite';",
    "import vue from '@vitejs/plugin-vue';",
    '',
    'export default defineConfig({',
    '  // One Vue runtime across the game/library boundary.',
    "  resolve: { dedupe: [\"vue\"] },",
    '  plugins: [vue()],',
    '});',
    '',
  ].join('\n');
  const OLD_VITEST_CONFIG = [
    "import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';",
    "import base from './vite.config.ts';",
    '',
    'export default defineConfig(async (env) =>',
    "  mergeConfig(typeof base === 'function' ? await base(env) : base, {",
    '    test: { exclude: [...configDefaults.exclude, ".boardsmith/**", \'.worktrees/**\', "**/tests/browser/**"] },',
    '  }),',
    ');',
    '',
  ].join('\n');

  it('rewrites a config that sets nothing defineGameViteConfig does not to the one-line config, removing its vitest config', async () => {
    const projectDir = await project({ 'vite.config.ts': OLD_VITE_CONFIG, 'vitest.config.ts': OLD_VITEST_CONFIG });

    const before = await doctorCommand({ project: projectDir });
    expect(before.findings.map((f) => f.kind)).toEqual(['test-run-collects-worktrees']);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    const fixed = await doctorCommand({ project: projectDir, fix: true });
    expect(fixed.counts).toEqual({ moved: 1, pending: 0, conflicts: 0 });
    expect(process.exitCode).toBeUndefined();

    expect(await read(join(projectDir, GAME_VITE_CONFIG_FILE))).toBe(GAME_VITE_CONFIG);
    await expect(fs.stat(join(projectDir, 'vitest.config.ts'))).rejects.toThrow();
    expect((await doctorCommand({ project: projectDir })).healthy).toBe(true);
  });

  it('reports a project with no config as missing one, and writes the one-line config', async () => {
    const projectDir = await project({}, { testConfig: false });

    const before = await doctorCommand({ project: projectDir });
    expect(before.findings).toMatchObject([{ kind: 'test-config-missing', from: GAME_VITE_CONFIG_FILE }]);
    expect(printed()).toMatch(/missing +\S*vite\.config\.ts/);
    expect(printed()).not.toMatch(/outdated/);

    await doctorCommand({ project: projectDir, fix: true });
    expect(await read(join(projectDir, GAME_VITE_CONFIG_FILE))).toBe(GAME_VITE_CONFIG);
  });

  it('says to delete a leftover vitest config that vitest reads in place of a vite config already built with defineGameViteConfig, and keeps that vite config', async () => {
    const own = GAME_VITE_CONFIG.replace('defineGameViteConfig()', "defineGameViteConfig({ test: { setupFiles: ['./tests/setup.ts'] } })");
    const projectDir = await project({ [GAME_VITE_CONFIG_FILE]: own, 'vitest.config.ts': OLD_VITEST_CONFIG });

    const before = await doctorCommand({ project: projectDir });
    expect(before.findings).toMatchObject([{ kind: 'test-run-collects-worktrees', from: 'vitest.config.ts' }]);
    expect(before.findings[0].detail).toMatch(/vitest reads vitest\.config\.ts in place of vite\.config\.ts.*Delete vitest\.config\.ts/);
    expect(before.findings[0].detail).not.toMatch(/vite\.config\.ts sets more/);

    await doctorCommand({ project: projectDir, fix: true });
    expect(await read(join(projectDir, GAME_VITE_CONFIG_FILE))).toBe(own);
    await expect(fs.stat(join(projectDir, 'vitest.config.ts'))).rejects.toThrow();
    expect((await doctorCommand({ project: projectDir })).healthy).toBe(true);
  });

  it('asks for a hand edit when a leftover vitest config has settings of its own, beside a vite config already built with defineGameViteConfig', async () => {
    const vitest = OLD_VITEST_CONFIG.replace('test: { exclude', "test: { setupFiles: ['./tests/setup.ts'], exclude");
    const projectDir = await project({ [GAME_VITE_CONFIG_FILE]: GAME_VITE_CONFIG, 'vitest.config.ts': vitest });

    const result = await doctorCommand({ project: projectDir, fix: true });

    expect(result.findings).toMatchObject([{ kind: 'test-config-needs-edit', from: 'vitest.config.ts', fixed: false }]);
    expect(result.findings[0].detail).toMatch(/vitest\.config\.ts sets more than defineGameViteConfig\(\) does \(test\.setupFiles\).*pass it to defineGameViteConfig in vite\.config\.ts.*then delete vitest\.config\.ts/s);
    expect(await read(join(projectDir, 'vitest.config.ts'))).toBe(vitest);
  });

  it.each([
    ['a setting of its own', OLD_VITE_CONFIG.replace('  plugins: [vue()],', "  plugins: [vue()],\n  test: { setupFiles: ['./tests/setup.ts'] },"), 'test.setupFiles'],
    ['an exclude of its own', OLD_VITE_CONFIG.replace('  plugins: [vue()],', "  plugins: [vue()],\n  test: { exclude: ['tests/tdd/**'] },"), 'test.exclude'],
    ['a plugin of its own', OLD_VITE_CONFIG.replace('[vue()]', '[vue(), inspect()]'), 'plugins'],
    ['code of its own', `const tdd = process.env.TDD === '1';\n${OLD_VITE_CONFIG}`, "const tdd = process.env.TDD === '1';"],
    ['settings imported from a file of its own', `import shared from './vite.shared';\n${OLD_VITE_CONFIG}`, "import shared from './vite.shared';"],
    ['a side-effect import', `import './tests/patch-env';\n${OLD_VITE_CONFIG}`, "import './tests/patch-env';"],
  ])('asks for a hand edit naming it, and changes nothing, when a config has %s', async (_what, viteConfig, named) => {
    const projectDir = await project({ 'vite.config.ts': viteConfig, 'vitest.config.ts': OLD_VITEST_CONFIG });

    const result = await doctorCommand({ project: projectDir, fix: true });

    expect(result.findings).toMatchObject([{ kind: 'test-config-needs-edit', from: 'vite.config.ts', fixed: false }]);
    expect(result.findings[0].detail).toContain(`vite.config.ts sets more than defineGameViteConfig() does (${named})`);
    expect(result.findings[0].detail).toContain("import { defineGameViteConfig } from 'boardsmith/vite-config';");
    expect(result.counts).toEqual({ moved: 0, pending: 0, conflicts: 1 });
    expect(process.exitCode).toBe(1);
    expect(await read(join(projectDir, 'vite.config.ts'))).toBe(viteConfig);
    expect(await read(join(projectDir, 'vitest.config.ts'))).toBe(OLD_VITEST_CONFIG);
  });

  describe('closing advice (#299)', () => {
    const ownConfig = { [GAME_VITE_CONFIG_FILE]: 'export default { test: { globals: true } };\n' };

    it('offers --fix when every finding is fixable', async () => {
      const projectDir = await project({ 'SKETCH.md': 'x\n' });

      await doctorCommand({ project: projectDir });

      expect(printed()).toMatch(/1 to fix\.\nRun boardsmith doctor --fix to put them right\./);
      expect(printed()).not.toMatch(/hand edit/);
    });

    it('does not offer --fix when only conflicts remain, and points at the per-conflict instructions', async () => {
      const projectDir = await project(ownConfig);

      await doctorCommand({ project: projectDir });

      expect(printed()).not.toMatch(/--fix to put/);
      expect(printed()).toMatch(/1 conflict\(s\) need a hand edit; --fix cannot resolve them\. Follow the instructions printed under each one above\./);
    });

    it('says what --fix handles and what needs a hand edit when both kinds exist', async () => {
      const projectDir = await project({ 'SKETCH.md': 'x\n', ...ownConfig });

      await doctorCommand({ project: projectDir });

      expect(printed()).toMatch(/1 to fix, 1 conflict\(s\)\.\nRun boardsmith doctor --fix to put the 1 fixable finding\(s\) right\. The conflict\(s\) need a hand edit; --fix cannot resolve them\. Follow the instructions printed under each one above\./);
    });
  });

  // #1009: doctor is where a project's ingest pre-commit hook is installed and kept current.
  describe('the ingest pre-commit hook (#1009)', () => {
    const OWN_HOOK = '#!/bin/sh\necho mine\n';
    const hookPath = (projectDir: string) => join(projectDir, '.git', 'hooks', 'pre-commit');

    async function gitProject(): Promise<string> {
      const projectDir = await project();
      execSync('git init', { cwd: projectDir, stdio: 'ignore' });
      return projectDir;
    }

    it('reports a missing hook, and --fix installs it executable', async () => {
      const projectDir = await gitProject();
      await fs.rm(hookPath(projectDir), { force: true });

      const report = await doctorCommand({ project: projectDir });
      expect(report.findings.map((f) => f.kind)).toEqual(['ingest-hook-not-current']);
      expect(process.exitCode).toBe(1);
      expect(await exists(hookPath(projectDir))).toBe(false);

      process.exitCode = undefined;
      const fixed = await doctorCommand({ project: projectDir, fix: true });
      expect(fixed.counts).toEqual({ moved: 1, pending: 0, conflicts: 0 });
      expect(process.exitCode).toBeUndefined();
      expect(await read(hookPath(projectDir))).toBe(INGEST_PRE_COMMIT_HOOK);
      expect((await fs.stat(hookPath(projectDir))).mode & 0o111).toBeGreaterThan(0);
    });

    it('reports a stale BoardSmith hook, and --fix rewrites it with the current text', async () => {
      const projectDir = await gitProject();
      await fs.writeFile(hookPath(projectDir), '#!/bin/sh\n# BoardSmith ingest synthesis (old)\nexit 0\n', { mode: 0o755 });

      const report = await doctorCommand({ project: projectDir });
      expect(report.findings.map((f) => f.kind)).toEqual(['ingest-hook-not-current']);
      expect(process.exitCode).toBe(1);

      process.exitCode = undefined;
      await doctorCommand({ project: projectDir, fix: true });
      expect(process.exitCode).toBeUndefined();
      expect(await read(hookPath(projectDir))).toBe(INGEST_PRE_COMMIT_HOOK);
    });

    it('finds nothing when the current hook is installed', async () => {
      const projectDir = await gitProject();
      await installIngestHook(projectDir);

      const result = await doctorCommand({ project: projectDir });

      expect(result.healthy).toBe(true);
      expect(result.notes).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    });

    it('leaves a hook it did not write alone, with a note that does not change the exit code', async () => {
      const projectDir = await gitProject();
      await fs.writeFile(hookPath(projectDir), OWN_HOOK, { mode: 0o755 });

      const result = await doctorCommand({ project: projectDir, fix: true });

      expect(result.healthy).toBe(true);
      expect(process.exitCode).toBeUndefined();
      expect(await read(hookPath(projectDir))).toBe(OWN_HOOK);
      expect(result.notes).toHaveLength(1);
      expect(printed()).toContain(result.notes[0]);
      expect(result.notes[0]).toMatch(/delete \.git\/hooks\/pre-commit and run boardsmith doctor --fix/);
      expect(result.notes[0]).toMatch(/boardsmith ingest-gaps/);
    });

    it('leaves a hook it cannot read alone, with a note that does not change the exit code (#1110)', async () => {
      const projectDir = await gitProject();
      await fs.writeFile(hookPath(projectDir), OWN_HOOK);
      await fs.chmod(hookPath(projectDir), 0o200);
      let result;
      try {
        result = await doctorCommand({ project: projectDir, fix: true });
      } finally {
        await fs.chmod(hookPath(projectDir), 0o755);
      }

      expect(result.healthy).toBe(true);
      expect(process.exitCode).toBeUndefined();
      expect(await read(hookPath(projectDir))).toBe(OWN_HOOK);
      expect(result.notes[0]).toMatch(/could not read \.git\/hooks\/pre-commit/);
    });

    it('reports a missing hook from a linked worktree, and --fix installs it where git runs it (#1186)', async () => {
      const mainDir = await gitProject();
      execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m base', { cwd: mainDir, stdio: 'ignore' });
      const worktree = `${mainDir}-wt`;
      execSync(`git worktree add "${worktree}"`, { cwd: mainDir, stdio: 'ignore' });

      const report = await doctorCommand({ project: worktree });
      expect(report.findings.map((f) => f.kind)).toEqual(['ingest-hook-not-current']);

      process.exitCode = undefined;
      await doctorCommand({ project: worktree, fix: true });
      expect(await read(hookPath(mainDir))).toBe(INGEST_PRE_COMMIT_HOOK);
    });

    it('reports a hook git cannot run because it lost its execute bit, and --fix restores it (#1187)', async () => {
      const projectDir = await gitProject();
      await installIngestHook(projectDir);
      await fs.chmod(hookPath(projectDir), 0o644);

      const report = await doctorCommand({ project: projectDir });
      expect(report.findings.map((f) => f.kind)).toEqual(['ingest-hook-not-current']);

      process.exitCode = undefined;
      await doctorCommand({ project: projectDir, fix: true });
      expect((await fs.stat(hookPath(projectDir))).mode & 0o111).toBeGreaterThan(0);
    });
  });
});
