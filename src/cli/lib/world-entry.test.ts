/**
 * #170: `boardsmith build` and `boardsmith dev` must ALWAYS have a world entry.
 *
 * The branch this deletes is the one ShufflewickPub #128 could not survive: a
 * host that reads "no world.html" as "this game ships no world UI" cannot tell
 * that apart from a UI that failed to deploy. Once the entry always exists,
 * `uiUrl === null` means the publish is broken and nothing else -- which is what
 * lets #357 delete the platform's generic WorldStage and keep one honest
 * "this world's UI is missing" sentence of its own.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureWorldEntry, WORLD_ENTRY_HTML, WORLD_ENTRY_MAIN } from './world-entry.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

let cwd: string;
beforeEach(() => { cwd = tempTree('bs-world-entry-'); });

describe('a world project always has an entry', () => {
  it('writes both files when the project has neither', async () => {
    const { created } = await ensureWorldEntry(cwd, 'Gloamhall');
    expect(created).toEqual([WORLD_ENTRY_HTML, WORLD_ENTRY_MAIN]);
    expect(existsSync(join(cwd, WORLD_ENTRY_HTML))).toBe(true);
    expect(existsSync(join(cwd, WORLD_ENTRY_MAIN))).toBe(true);
  });

  it('mounts WorldShell over the game\'s own registry, not a hand-rolled board', async () => {
    await ensureWorldEntry(cwd, 'Gloamhall');
    const main = readFileSync(join(cwd, WORLD_ENTRY_MAIN), 'utf-8');
    expect(main).toContain("import uis from './ui/uis.js'");
    expect(main).toContain('WorldShell');
    expect(main).toContain('uis');
  });

  it('names the world in the document title and the mount', async () => {
    await ensureWorldEntry(cwd, 'Gloamhall');
    expect(readFileSync(join(cwd, WORLD_ENTRY_HTML), 'utf-8')).toContain('<title>Gloamhall</title>');
    expect(readFileSync(join(cwd, WORLD_ENTRY_MAIN), 'utf-8')).toContain('"Gloamhall"');
  });

  it('never overwrites what the author wrote', async () => {
    writeFileSync(join(cwd, WORLD_ENTRY_HTML), '<!-- mine -->');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, WORLD_ENTRY_MAIN), '// mine');
    const { created } = await ensureWorldEntry(cwd, 'Gloamhall');
    expect(created).toEqual([]);
    expect(readFileSync(join(cwd, WORLD_ENTRY_HTML), 'utf-8')).toBe('<!-- mine -->');
    expect(readFileSync(join(cwd, WORLD_ENTRY_MAIN), 'utf-8')).toBe('// mine');
  });

  it('fills in only the half that is missing', async () => {
    writeFileSync(join(cwd, WORLD_ENTRY_HTML), '<!-- mine -->');
    const { created } = await ensureWorldEntry(cwd, 'Gloamhall');
    expect(created).toEqual([WORLD_ENTRY_MAIN]);
  });
});
