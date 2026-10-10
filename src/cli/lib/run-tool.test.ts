import { describe, it, expect, beforeEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fallowCommandLine, runTool, runToolCapturingStdout, toolCommand } from './run-tool.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * `runTool` is the single spawn point every `boardsmith` command uses to invoke
 * a developer tool, so its two contracts matter everywhere:
 *
 *  1. a tool runs from exactly one place: boardsmith's own install for a tool
 *     boardsmith depends on, or the workspace's own `node_modules/.bin/<tool>`
 *     for any other, and a missing one is refused, never fetched by npx (#595);
 *  2. a non-zero exit is RETURNED, not thrown, so a command can run every
 *     configured check before reporting one overall verdict.
 */

let workspace: string;

/** Write an executable shell script into the workspace's node_modules/.bin. */
function writeLocalBin(name: string, body: string): void {
  const binDir = join(workspace, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  workspace = tempTree('bs-run-tool-');
});

describe('runTool', () => {

  it("prefers the workspace's own node_modules/.bin over npx", async () => {
    // `exit 42` is a value npx could never produce for a nonexistent package,
    // so observing it proves the LOCAL binary ran.
    writeLocalBin('made-up-tool', 'exit 42');

    const code = await runTool('made-up-tool', [], { cwd: workspace });

    expect(code).toBe(42);
  });

  it('returns 0 when the tool succeeds', async () => {
    writeLocalBin('made-up-tool', 'exit 0');

    await expect(runTool('made-up-tool', [], { cwd: workspace })).resolves.toBe(0);
  });

  it('resolves — never rejects — on a non-zero exit, so callers can run every check', async () => {
    writeLocalBin('made-up-tool', 'exit 1');

    await expect(runTool('made-up-tool', [], { cwd: workspace })).resolves.toBe(1);
  });

  it('passes arguments through verbatim, without shell glob expansion', async () => {
    // The workspace contains a file the shell WOULD match if it expanded the
    // glob; the tool must still receive the literal pattern and do its own
    // matching (stylelint and vitest both rely on this).
    writeFileSync(join(workspace, 'a.vue'), '');
    writeLocalBin('made-up-tool', '[ "$1" = "*.vue" ] && exit 7 || exit 8');

    const code = await runTool('made-up-tool', ['*.vue'], { cwd: workspace });

    expect(code).toBe(7);
  });

  it('runs the tool in the requested cwd', async () => {
    const marker = join(workspace, 'marker-file');
    writeFileSync(marker, '');
    writeLocalBin('made-up-tool', '[ -f marker-file ] && exit 0 || exit 9');

    await expect(runTool('made-up-tool', [], { cwd: workspace })).resolves.toBe(0);
  });
});

/**
 * `runToolCapturingStdout` exists because a tool's machine-readable output is
 * the only trustworthy source for a verdict a command has to reason about
 * (issue #176: `boardsmith audit` needs `fallow audit`'s changed-file count,
 * and parsing its human report for it would break on any rewording).
 */
describe('runToolCapturingStdout', () => {
  it('returns the tool\'s stdout alongside its exit code', async () => {
    writeLocalBin('made-up-tool', 'echo \'{"verdict":"pass"}\'; exit 0');

    const result = await runToolCapturingStdout('made-up-tool', [], { cwd: workspace });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ verdict: 'pass' });
  });

  // fallow exits 1 whenever the audit verdict is `fail`, and that run's JSON is
  // exactly the report the caller needs. A non-zero exit must not lose it.
  it('still returns stdout when the tool exits non-zero', async () => {
    writeLocalBin('made-up-tool', 'echo \'{"verdict":"fail"}\'; exit 1');

    const result = await runToolCapturingStdout('made-up-tool', [], { cwd: workspace });

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ verdict: 'fail' });
  });

  /**
   * A tool's stdout arrives in chunks whose boundaries the caller does not
   * choose, and a UTF-8 character can straddle one. Decoding each chunk on its
   * own turns the split character into U+FFFD, so the captured text is no
   * longer what the tool printed.
   *
   * That is not cosmetic. `boardsmith audit --dupes-baseline` hashes the
   * duplicated source text `fallow dupes` reports to key an accepted clone
   * group, so a corrupted character changes the key: issue #241 saw two
   * accepted groups report as new because an insertion in an unrelated file
   * moved the byte offsets of everything after it in a 4.6 MB report, and with
   * them the chunk boundary that landed inside a box-drawing character.
   *
   * The payload here is nothing but three-byte characters, so a boundary can
   * only avoid splitting one by falling on a multiple of three; a pipe's
   * 65,536-byte read does not.
   */
  it('decodes multi-byte UTF-8 that straddles a chunk boundary', async () => {
    const payload = '\u2500'.repeat(40_000);
    const payloadPath = join(workspace, 'payload.txt');
    writeFileSync(payloadPath, payload, 'utf-8');
    writeLocalBin('made-up-tool', `cat "${payloadPath}"`);

    const result = await runToolCapturingStdout('made-up-tool', [], { cwd: workspace });

    // Asserted before the equality, so a regression reads as the one character
    // that broke rather than as a 120 kB diff.
    expect(result.stdout).not.toContain('\uFFFD');
    expect(result.stdout).toBe(payload);
  });

  it('passes arguments through verbatim', async () => {
    writeLocalBin('made-up-tool', 'echo "$2"');

    const result = await runToolCapturingStdout('made-up-tool', ['audit', '--format'], {
      cwd: workspace,
    });

    expect(result.stdout.trim()).toBe('--format');
  });
});

/**
 * fallow decides what the audit gate reports, and its findings change between
 * releases: 3.x skips test files in `fallow dupes` where 2.48.0 did not, so the
 * same tree gave a different verdict on every machine that had a different
 * fallow on PATH (#545). boardsmith therefore depends on one exact fallow, and
 * runs THAT one wherever it is invoked from: a game project's own
 * `node_modules/.bin/fallow`, or a global one on PATH, must never be what runs.
 */
describe('fallow', () => {
  const boardsmithFallow = (): string => {
    const require = createRequire(import.meta.url);
    const { version } = require('fallow/package.json') as { version: string };
    return version;
  };

  it("runs boardsmith's own fallow, not the workspace's", async () => {
    writeLocalBin('fallow', 'echo "fallow 0.0.0-workspace"');

    const result = await runToolCapturingStdout('fallow', ['--version'], { cwd: workspace });

    expect(result.stdout).toContain(`fallow ${boardsmithFallow()}`);
  });

  it("runs boardsmith's own fallow, not one on PATH", async () => {
    const pathDir = join(workspace, 'path-bin');
    mkdirSync(pathDir);
    writeFileSync(join(pathDir, 'fallow'), '#!/bin/sh\necho "fallow 0.0.0-path"\n');
    chmodSync(join(pathDir, 'fallow'), 0o755);
    const original = process.env.PATH;
    process.env.PATH = `${pathDir}${delimiter}${original}`;
    try {
      const result = await runToolCapturingStdout('fallow', ['--version'], { cwd: workspace });

      expect(result.stdout).toContain(`fallow ${boardsmithFallow()}`);
    } finally {
      process.env.PATH = original;
    }
  });

  it('names the same fallow in the command it tells a developer to run', () => {
    const require = createRequire(import.meta.url);
    const script = require.resolve('fallow/bin/fallow');

    const line = fallowCommandLine(['health', '--save-baseline', 'x.json'], workspace);

    expect(line).toBe(`node ${relative(workspace, script)} health --save-baseline x.json`);
  });
});

/**
 * #551: `boardsmith audit --duplication` ran jscpd through `npx`, so whichever
 * jscpd the machine had cached or npm called latest decided the verdict.
 * fallow cannot replace it: it scans only the script blocks of `.vue` files,
 * and jscpd is what catches duplicated `<template>` markup in `src/ui`. So
 * boardsmith depends on one exact jscpd and runs THAT one, as it does fallow.
 */
describe('jscpd', () => {
  const boardsmithRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');

  it("is pinned to an exact version in boardsmith's own dependencies", () => {
    const require = createRequire(import.meta.url);
    const { dependencies } = require(join(boardsmithRoot, 'package.json')) as {
      dependencies: Record<string, string>;
    };

    expect(dependencies.jscpd).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("resolves from boardsmith's own install, never the workspace's or npx", () => {
    writeLocalBin('jscpd', 'echo "jscpd 0.0.0-workspace"');

    const { command, commandArgs } = toolCommand('jscpd', ['src/'], workspace);

    expect(command).toBe(process.execPath);
    expect(commandArgs[0]).toContain(`${sep}node_modules${sep}jscpd${sep}`);
    expect(commandArgs.slice(1)).toEqual(['src/']);
  });

  it('never falls back to npx when the workspace has no jscpd', () => {
    const { command } = toolCommand('jscpd', [], workspace);

    expect(command).not.toBe('npx');
    expect(command).toBe(process.execPath);
  });
});

/**
 * #595: eslint, stylelint, vitest and vue-tsc ran through `npx` whenever the
 * workspace had no local copy, so whichever version npx found or fetched
 * decided the verdict, and it differed by machine.
 *
 * eslint is a `dependencies` entry of boardsmith (its plugin and the sandbox
 * scan run it), so boardsmith pins it and runs its own copy, as it does fallow.
 * vitest, vue-tsc and stylelint have to match the workspace's own vue,
 * TypeScript and style setup, so they come only from the workspace, and a
 * workspace without one is told which package to install.
 */
describe('eslint', () => {
  const boardsmithRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');

  it("is pinned to an exact version in boardsmith's own dependencies", () => {
    const require = createRequire(import.meta.url);
    const { dependencies } = require(join(boardsmithRoot, 'package.json')) as {
      dependencies: Record<string, string>;
    };

    expect(dependencies.eslint).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("runs boardsmith's own eslint, not the workspace's", async () => {
    writeLocalBin('eslint', 'echo "v0.0.0-workspace"');
    const require = createRequire(import.meta.url);
    const { version } = require('eslint/package.json') as { version: string };

    const result = await runToolCapturingStdout('eslint', ['--version'], { cwd: workspace });

    expect(result.stdout.trim()).toBe(`v${version}`);
  });
});

describe('a tool the workspace must install itself', () => {
  it.each(['vitest', 'vue-tsc', 'stylelint'])('runs the workspace\'s own %s', async (bin) => {
    writeLocalBin(bin, 'exit 42');

    await expect(runTool(bin, [], { cwd: workspace })).resolves.toBe(42);
  });

  it.each(['vitest', 'vue-tsc', 'stylelint'])(
    'refuses with the install command when the workspace has no %s',
    (bin) => {
      expect(() => toolCommand(bin, [], workspace)).toThrow(
        `${bin} is not installed in this project.\nInstall it with: npm install -D ${bin}`,
      );
    },
  );

  it('never runs npx, even when one is on PATH', async () => {
    const pathDir = join(workspace, 'path-bin');
    const marker = join(workspace, 'npx-ran');
    mkdirSync(pathDir);
    writeFileSync(join(pathDir, 'npx'), `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(join(pathDir, 'npx'), 0o755);
    const original = process.env.PATH;
    process.env.PATH = `${pathDir}${delimiter}${original}`;
    try {
      await expect(runTool('vitest', ['run'], { cwd: workspace })).rejects.toThrow('npm install -D vitest');
      expect(existsSync(marker)).toBe(false);
    } finally {
      process.env.PATH = original;
    }
  });
});
