import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool } from './run-tool.js';

/**
 * `runTool` is the single spawn point every `boardsmith` command uses to invoke
 * a developer tool, so its two contracts matter everywhere:
 *
 *  1. the workspace's OWN `node_modules/.bin/<tool>` wins, so a declared
 *     devDependency is what runs — never a different version fetched by npx;
 *  2. a non-zero exit is RETURNED, not thrown, so a command can run every
 *     configured check before reporting one overall verdict.
 */

describe('runTool', () => {
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
    workspace = mkdtempSync(join(tmpdir(), 'bs-run-tool-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

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
