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
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { skillMarkdown } from '../slash-command/skill-markdown.test-helper.js';

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

/**
 * A game with boardsmith installed in its node_modules (or, with `checkout`, a BoardSmith clone),
 * and a stale skill in the sandbox's HOME. `npm` is a stub that records its arguments in `npmCalls`.
 */
function installedLayout(prefix: string, options: { shipsSource: boolean; checkout?: boolean; link?: boolean }) {
  const sandbox = fixtureSandbox(prefix);
  const game = join(sandbox.root, 'my-game');
  const pkg = options.checkout ? join(sandbox.root, 'BoardSmith') : join(game, 'node_modules', 'boardsmith');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  if (options.checkout) mkdirSync(join(pkg, '.git'));
  mkdirSync(game, { recursive: true });
  writeFileSync(join(game, 'package.json'), JSON.stringify({ name: 'my-boardsmith-game' }));
  const npmCalls = join(sandbox.root, 'npm-calls');
  writeFileSync(join(sandbox.root, 'bin', 'npm'), `#!/bin/sh\necho "$*" >> '${npmCalls}'\n`, { mode: 0o755 });
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
        'const m = await import(process.argv[1]); await m.installClaudeCommand({ force: true, skipLink: process.argv[2] !== "link" });',
        join(pkg, 'dist', 'cli.js'),
        options.link ? 'link' : 'no-link',
      ],
      {
        cwd: game,
        // The link step runs `npm`, here the stub, so the permission model must let node start a process.
        env: options.link ? { ...sandbox.env, NODE_OPTIONS: `${sandbox.env.NODE_OPTIONS} --allow-child-process` } : sandbox.env,
        encoding: 'utf8',
      },
    );
  return { run, staleSkill, npmCalls };
}

describe('installClaudeCommand from an installed copy (#723)', () => {
  it('reads the skills from the boardsmith package, not the game that installed it', () => {
    const { run, staleSkill } = installedLayout('bs-723-installed-', { shipsSource: true });

    const result = run();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(staleSkill, 'utf8')).toBe(
      skillMarkdown('bs/create-game.md'),
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

describe('the global link from boardsmith claude (#942)', () => {
  it('is skipped from an installed copy, saying why and what to do instead', () => {
    const { run, npmCalls } = installedLayout('bs-942-installed-', { shipsSource: true, link: true });

    const result = run();

    expect(result.status).toBe(0);
    expect(existsSync(npmCalls)).toBe(false);
    expect(result.stdout).toContain('Skipped linking BoardSmith globally');
    expect(result.stdout).toContain('npm link');
  });

  it('is made from a source checkout', () => {
    const { run, npmCalls } = installedLayout('bs-942-checkout-', { shipsSource: true, checkout: true, link: true });

    const result = run();

    expect(result.status).toBe(0);
    expect(readFileSync(npmCalls, 'utf8')).toBe('link --force\n');
  });
});
