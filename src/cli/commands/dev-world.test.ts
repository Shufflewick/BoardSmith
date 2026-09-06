/**
 * #167: WHAT `boardsmith dev` SERVES FOR A WORLD, and where its two roads part.
 *
 * The server itself is exercised in a browser (that is what a dev host is for);
 * what is asserted here is the part that decides things before a socket exists
 * -- which document a project's world surface comes from (#170: there is now
 * exactly one, and a project that had none is given one), and the fact that a
 * world project no longer needs a table half at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_IFRAME_PATH, WORLD_WS_PATH } from './dev-world.js';
import { ensureWorldEntry, WORLD_ENTRY_HTML } from '../lib/world-entry.js';
import { GAME_IFRAME_PATH } from './dev.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEV_HOST_DIR = join(REPO_ROOT, 'src', 'cli', 'dev-host');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bs-dev-world-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('which surface a world run serves', () => {
  it('serves the bundle\'s own world.html, and nothing else (#170)', async () => {
    // There used to be two documents and a branch: the bundle's `world.html`
    // when it had one, and a fallback with a debug board when it did not. Only
    // one of those is a path production takes, which made local behaviour a
    // poor guide to published behaviour for exactly the games most likely to be
    // prototypes.
    //
    // The branch is gone because the case it existed for is: a world project
    // always has an entry, and `ensureWorldEntry` writes it into the author's
    // own repository the first time the world is built or run.
    const { created } = await ensureWorldEntry(dir, 'Gloamhall');
    expect(created).toContain(WORLD_ENTRY_HTML);
    expect(existsSync(join(dir, WORLD_ENTRY_HTML))).toBe(true);
  });

  it('mounts WorldShell over the registry, so there is no second protocol', async () => {
    await ensureWorldEntry(dir, 'Gloamhall');
    const main = readFileSync(join(dir, 'src', 'world-main.ts'), 'utf-8');
    expect(main).toContain('WorldShell');
    expect(main).toContain("./ui/uis.js");
  });
});

describe('the two dev hosts share no path and no socket', () => {
  it('serves its surface and its socket at names the table host does not use', () => {
    // Distinct on purpose. A table shell acts on any `{source:'shufflewick'}`
    // frame it recognises, so a wrong pairing must be INERT rather than
    // half-consumed -- the same reason `worldProtocol.ts` gives for its own
    // source strings.
    expect(WORLD_IFRAME_PATH).not.toBe(GAME_IFRAME_PATH);
    expect(WORLD_WS_PATH).not.toBe('/__boardsmith/ws');
  });

  it('serves its surface from a TOP-LEVEL path, so relative assets resolve', () => {
    // Issue 134: a bundle references its art relatively, and a relative
    // reference resolves against the DIRECTORY of the document making it. One
    // segment deep, every asset resolves one directory too far down and 404s.
    expect(WORLD_IFRAME_PATH.slice(1)).not.toContain('/');
  });
});

describe('#167: `boardsmith dev` no longer needs a table half to open a world', () => {
  it('a world project scaffolded with no src/main.ts has a surface to serve', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    expect(readdirSync(join(dir, 'src'))).not.toContain('main.ts');
    await ensureWorldEntry(dir, 'Gloamhall');
    expect(existsSync(join(dir, WORLD_ENTRY_HTML))).toBe(true);
    // Still no table half: the world entry is the whole of what a world needs.
    expect(readdirSync(join(dir, 'src'))).not.toContain('main.ts');
  });

  it('devCommand takes the world road before anything reads the table entry', () => {
    // Read rather than run: starting a Vite server in a unit test proves less
    // than the browser pass does and costs a port. What has to be true is that
    // the branch happens, and that nothing after it is reached for a world.
    const source = readFileSync(join(REPO_ROOT, 'src', 'cli', 'commands', 'dev.ts'), 'utf-8');
    const branch = source.indexOf('if (worldMode) {');
    expect(branch).toBeGreaterThan(0);
    expect(source.slice(branch)).toContain('startWorldDevServer');
    // The table host is constructed AFTER the branch, so a world never builds
    // one.
    expect(source.indexOf('new MultiplayerHost(')).toBeGreaterThan(branch);
  });
});
