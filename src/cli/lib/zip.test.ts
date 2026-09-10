/**
 * WHAT A BUNDLE MUST CONTAIN BEFORE IT CAN BE PUBLISHED (#188).
 *
 * `readDistDir` is the last gate between a build and a published bundle, and
 * it was written when every game had a table. It demanded `ui/index.html` and
 * a `playerCount`, so the entire world half of the catalogue built and
 * validated cleanly and then died in packaging -- `boardsmith validate` was
 * already backend-aware and this was not.
 *
 * The manifest is read in that function anyway, so `backend` is in hand at the
 * point of the check. These tests hold that BOTH backends can be packaged and
 * that each is still refused for the thing it actually lacks.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readDistDir } from './zip.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

let dir: string;

/** A dist/ tree in the shape `boardsmith build` really emits. */
function dist(manifest: Record<string, unknown>, entry: 'index.html' | 'world.html' | null): string {
  dir = tempTree('bs-zip-');
  mkdirSync(join(dir, 'rules'), { recursive: true });
  mkdirSync(join(dir, 'ui'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'rules', 'rules.js'), 'export const gameDefinition = {};');
  if (entry) writeFileSync(join(dir, 'ui', entry), '<!doctype html>');
  return dir;
}

const TABLE = { backend: 'table', playerCount: { min: 2, max: 4 } };
const WORLD = { backend: 'world', world: { maxPlayers: 40 } };

describe('readDistDir — the entry and seat count each backend actually has', () => {
  it('packages a table, whose entry is ui/index.html', () => {
    const files = readDistDir(dist(TABLE, 'index.html'));
    expect(files.has('index.html')).toBe(true);
    expect(files.has('boardsmith.json')).toBe(true);
    expect(files.has('rules.js')).toBe(true);
  });

  it('packages a world, whose entry is ui/world.html and which has no playerCount', () => {
    const files = readDistDir(dist(WORLD, 'world.html'));
    expect(files.has('world.html')).toBe(true);
    expect(files.has('boardsmith.json')).toBe(true);
  });

  it('refuses a table with no index.html, naming the entry that backend needs', () => {
    expect(() => readDistDir(dist(TABLE, null))).toThrow(/ui\/index\.html/);
  });

  it('refuses a world with no world.html, naming the entry that backend needs', () => {
    expect(() => readDistDir(dist(WORLD, null))).toThrow(/ui\/world\.html/);
  });

  it('refuses a table with no playerCount', () => {
    expect(() => readDistDir(dist({ backend: 'table' }, 'index.html'))).toThrow(/playerCount/);
  });

  it('refuses a world with no world.maxPlayers, which is a world’s one seat count', () => {
    expect(() => readDistDir(dist({ backend: 'world' }, 'world.html'))).toThrow(/world\.maxPlayers/);
  });

  it('refuses a manifest that names no backend at all', () => {
    // Required with no default since #171. A bundle that does not say cannot be
    // packaged, rather than being guessed into the table shape it used to be.
    expect(() => readDistDir(dist({ playerCount: { min: 2, max: 2 } }, 'index.html'))).toThrow(
      /backend/,
    );
  });
});
