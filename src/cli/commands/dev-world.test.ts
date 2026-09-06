/**
 * #167: WHAT `boardsmith dev` SERVES FOR A WORLD, and where its two roads part.
 *
 * The server itself is exercised in a browser (that is what a dev host is for);
 * what is asserted here is the part that decides things before a socket exists
 * -- which document a project's world surface comes from, and the fact that a
 * world project no longer needs a table half at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WORLD_ENTRY_HTML,
  WORLD_IFRAME_PATH,
  WORLD_WS_PATH,
  resolveWorldSurface,
} from './dev-world.js';
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
  it("serves the bundle's own world.html when it has one", () => {
    writeFileSync(join(dir, WORLD_ENTRY_HTML), '<!doctype html>');
    const surface = resolveWorldSurface(dir, DEV_HOST_DIR);
    expect(surface.ownWorldUi).toBe(true);
    expect(surface.path).toBe(join(dir, WORLD_ENTRY_HTML));
  });

  it("serves the shell's own surface when the project has written none", () => {
    // `example-rts` and `example-mud` are both this shape. A world with no UI
    // must still be openable, or the games most likely to be prototypes are
    // the ones with no local loop.
    const surface = resolveWorldSurface(dir, DEV_HOST_DIR);
    expect(surface.ownWorldUi).toBe(false);
    expect(surface.path).toBe(join(DEV_HOST_DIR, 'world-fallback.html'));
  });

  it("the shell's own surface really mounts WorldShell, not a second protocol", () => {
    // The whole argument for the fallback: a world with no UI is exercised
    // through the code path a world with one takes. If this ever stopped
    // mounting WorldShell it would be a private debug console wearing the
    // fallback's name, and would prove nothing about a published run.
    const main = readFileSync(join(DEV_HOST_DIR, 'world-fallback-main.ts'), 'utf-8');
    expect(main).toContain('WorldShell');
    expect(main).toContain('WorldDevBoard');
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
  it('a world project scaffolded with no src/main.ts has a surface to serve', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    expect(readdirSync(join(dir, 'src'))).not.toContain('main.ts');
    expect(resolveWorldSurface(dir, DEV_HOST_DIR).path).toBeTruthy();
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
