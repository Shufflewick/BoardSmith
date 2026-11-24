/**
 * A game whose linked game cannot be exported fails without removing the work folder under an export
 * still being written (#1801): the removal raced the game's own `git checkout` and failed with ENOTEMPTY.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { checkCatalogue } from './catalogue-check.js';
import { fixture, makeGame, makeTree } from './catalogue-fixture.test-helper.js';

const gate = vi.hoisted(() => ({ linkedCheckedOut: undefined as Promise<void> | undefined, folderAtCheckout: undefined as boolean | undefined }));

vi.mock('./git-output.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./git-output.js')>();
  const isExportCheckout = (dir: string, args: string[], slug: string) =>
    args[0] === 'checkout' && basename(dir) === slug && basename(dirname(dir)).startsWith('boardsmith-catalogue-');
  return {
    ...real,
    gitOutput: async (dir: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      if (isExportCheckout(dir, args, 'legacy')) {
        const done = real.gitOutput(dir, args, options);
        gate.linkedCheckedOut = done.then(() => undefined);
        return done;
      }
      if (isExportCheckout(dir, args, 'legacy-world')) {
        while (gate.linkedCheckedOut === undefined) await new Promise((resolve) => setImmediate(resolve));
        await gate.linkedCheckedOut;
        // Let the linked game's export fail, and whatever follows from it run, before this checkout writes.
        await new Promise((resolve) => setImmediate(resolve));
        gate.folderAtCheckout = existsSync(dir);
      }
      return real.gitOutput(dir, args, options);
    },
  };
});

describe('a game whose linked game cannot be exported (#1801)', () => {
  it("fails the game once its own export has finished, so the work folder is not removed under it", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'legacy', { installed: false });
    await makeGame(fx, 'legacy-world', { links: ['legacy'] });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, skip: { legacy: 'not installed' } });

    expect(run.results).toEqual([expect.objectContaining({ slug: 'legacy-world', status: 'failed' })]);
    expect(gate.folderAtCheckout).toBe(true);
  });
});
