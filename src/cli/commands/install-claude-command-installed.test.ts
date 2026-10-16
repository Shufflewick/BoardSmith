/**
 * `boardsmith claude` run from an installed copy (#723): the code sits in
 * `<game>/node_modules/boardsmith/dist/cli.js`, not in this checkout's `src/`.
 *
 * The installer used to find its own package three folders up from itself,
 * which from `dist/` is the game. With a game named like "my-boardsmith-game"
 * it passed the name check, deleted the installed skills under `--force`, then
 * failed reading the game's (absent) `src/cli/slash-command`.
 *
 * The installer runs in a fixture sandbox, so its HOME, and with it
 * `~/.claude/skills`, is inside the temp tree and nothing else is writable.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Bundled once, at load time, the way `dist/cli.js` bundles it: every module in one file under dist/.
const bundle = await build({
  entryPoints: [join(REPO_ROOT, 'src', 'cli', 'commands', 'install-claude-command.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const bundleText = bundle.outputFiles[0].text;

/** A game with boardsmith installed in its node_modules, and a stale skill in the sandbox's HOME. */
function installedLayout(prefix: string, options: { shipsSource: boolean }) {
  const sandbox = fixtureSandbox(prefix);
  const game = join(sandbox.root, 'my-game');
  const pkg = join(game, 'node_modules', 'boardsmith');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(join(game, 'package.json'), JSON.stringify({ name: 'my-boardsmith-game' }));
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'boardsmith', version: '0.0.0' }));
  writeFileSync(join(pkg, 'dist', 'cli.js'), bundleText);
  if (options.shipsSource) symlinkSync(join(REPO_ROOT, 'src'), join(pkg, 'src'));

  const staleSkill = join(sandbox.env.HOME!, '.claude', 'skills', 'bs-create-game', 'SKILL.md');
  mkdirSync(dirname(staleSkill), { recursive: true });
  writeFileSync(staleSkill, 'stale');

  const run = () =>
    spawnSync(
      'node',
      [
        '--input-type=module',
        '-e',
        'const m = await import(process.argv[1]); await m.installClaudeCommand({ force: true, skipLink: true });',
        join(pkg, 'dist', 'cli.js'),
      ],
      { cwd: game, env: sandbox.env, encoding: 'utf8' },
    );
  return { run, staleSkill };
}

describe('installClaudeCommand from an installed copy (#723)', () => {
  it('reads the skills from the boardsmith package, not the game that installed it', () => {
    const { run, staleSkill } = installedLayout('bs-723-installed-', { shipsSource: true });

    const result = run();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(staleSkill, 'utf8')).toBe(
      readFileSync(join(REPO_ROOT, 'src', 'cli', 'slash-command', 'bs', 'create-game.md'), 'utf8'),
    );
  });

  it('with --force, leaves the installed skills alone when the package has no skill sources', () => {
    const { run, staleSkill } = installedLayout('bs-723-no-source-', { shipsSource: false });

    const result = run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('skill sources');
    expect(readFileSync(staleSkill, 'utf8')).toBe('stale');
  });
});
