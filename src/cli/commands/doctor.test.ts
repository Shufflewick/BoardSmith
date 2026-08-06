import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { doctorCommand } from './doctor.js';
import { DESIGN_DIR, SCRATCH_DIR } from '../lib/project-paths.js';

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
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-doctor-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(async () => {
  logSpy.mockRestore();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * A minimal project: just enough for `doctor` to accept it.
 *
 * It gets a `.gitignore` that already covers `.boardsmith/` by default, so the ignore-rule
 * finding does not show up as noise in every other test. The tests that exercise that rule pass
 * their own `.gitignore` (or `{ gitignore: false }` for none at all).
 */
async function project(
  files: Record<string, string> = {},
  opts: { gitignore?: boolean } = {},
): Promise<string> {
  const projectDir = join(dir, 'game');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(join(projectDir, 'boardsmith.json'), '{"name":"game"}\n');
  if (opts.gitignore !== false && !('.gitignore' in files)) {
    await fs.writeFile(join(projectDir, '.gitignore'), 'node_modules/\n.boardsmith/\n');
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
      'vite.config.ts': 'export default {}\n',
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

  it('a project whose .gitignore already covers .boardsmith/ is healthy', async () => {
    const projectDir = await project({ '.gitignore': 'node_modules/\n.boardsmith/\n' });

    const result = await doctorCommand({ project: projectDir });

    expect(result.healthy).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('--json emits the machine-readable result and no human report', async () => {
    const projectDir = await project({ 'SKETCH.md': '# sketch\n' });

    const result = await doctorCommand({ project: projectDir, json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(
      JSON.parse(JSON.stringify(result)),
    );
  });
});
