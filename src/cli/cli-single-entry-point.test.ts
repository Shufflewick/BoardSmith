import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generatePackageJson } from './lib/project-scaffold.js';

/**
 * The BoardSmith CLI is the single entry point for building and testing —
 * in this repo and in every game built with it.
 *
 * The point is uniformity: if a capability is reachable through an npm script,
 * two people running "the tests" or "the build" can be running two different
 * things, and a game can pin tooling the CLI has moved past. So the only script
 * this repo keeps is the one that installs the CLI, and generated games get no
 * scripts at all.
 *
 * This test is the guard on that invariant. If you are adding an npm script,
 * add a `boardsmith <command>` instead.
 */

/**
 * This file spawns the real CLI, so it needs more than vitest's 5s default — see the same note
 * in `cli.test.ts`. The ceiling is a hang guard, not a performance budget.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at src/cli/cli-single-entry-point.test.ts — repo root is two levels up.
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'bin', 'boardsmith.js');

/** The only command the one permitted script may run. */
const LINK_COMMAND = 'npm link';

describe('the CLI is the only entry point', () => {
  describe("BoardSmith's own package.json", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));

    it('declares exactly one script, and it links the CLI', () => {
      // What matters is the COUNT and the COMMAND, not the key — calling it
      // `link` or `setup` is a naming preference; adding a second script is the
      // regression this guards against.
      const names = Object.keys(pkg.scripts);
      expect(names).toHaveLength(1);
      expect(pkg.scripts[names[0]]).toBe(LINK_COMMAND);
    });

    it('has no npm lifecycle hook doing build work', () => {
      // `prepack`/`prepare`/`prepublishOnly` are scripts that run implicitly, so
      // they hide work from the CLI. `boardsmith pack` builds the CLI bundle
      // explicitly instead.
      for (const hook of ['prepack', 'prepare', 'prepublishOnly', 'postinstall']) {
        expect(pkg.scripts).not.toHaveProperty(hook);
      }
    });

    it('still exposes the boardsmith bin that the link script installs', () => {
      expect(pkg.bin).toHaveProperty('boardsmith');
    });
  });

  describe('scaffolded game projects', () => {
    const generated = JSON.parse(
      generatePackageJson({ name: 'test-game', displayName: 'Test Game', description: 'x' }),
    );

    it('get no scripts at all — the CLI is their one interface', () => {
      expect(generated).not.toHaveProperty('scripts');
    });

    it('still depend on boardsmith, so npx boardsmith resolves locally', () => {
      expect(generated.dependencies).toHaveProperty('boardsmith');
    });
  });

  describe('every capability that used to be an npm script is a CLI command', () => {
    let help = '';

    beforeAll(async () => {
      // One spawn for the whole describe — a real CLI process is seconds, not
      // milliseconds (see cli-conformance-commands.test.ts on spawn budget).
      const { stdout } = await execFileAsync(process.execPath, [CLI_BIN, '--help'], {
        cwd: REPO_ROOT,
      });
      help = stdout;
    });

    // Left column: the npm script that was removed. Right: its replacement.
    const replacements: Array<[removedScript: string, command: string]> = [
      ['test', 'test'],
      ['test:watch', 'test'],
      ['build:cli', 'build'],
      ['lint', 'lint'],
      ['lint:css', 'lint'],
      ['audit', 'audit'],
      ['audit:dead-code', 'audit'],
      ['audit:duplication', 'audit'],
      ['harness:ingest', 'harness-ingest'],
    ];

    for (const [removedScript, command] of replacements) {
      it(`\`npm run ${removedScript}\` -> \`boardsmith ${command}\``, () => {
        expect(help).toMatch(new RegExp(`^\\s+${command}[\\s[]`, 'm'));
      });
    }
  });
});
