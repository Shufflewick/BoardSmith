/**
 * `boardsmith build` carries a game's declared cover art into the bundle at the path the manifest
 * names, so the platform can store it at publish (#1630). Each build runs while the file is
 * collected, where no test timeout applies (#363); the tests assert what it left behind.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildProject } from './build.js';
import { readDistDir } from '../lib/zip.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { jpegBytes, pngBytes } from '../lib/cover-art.test-helper.js';

const fixtureGame = resolve(dirname(fileURLToPath(import.meta.url)), 'simulate.fixture.ts');
// These tests run the fixture by its path; this links them to it, loading nothing (#1415).
import.meta.glob('./simulate.fixture.ts');

const ART = {
  'art/backdrop.jpg': jpegBytes(1500, 500),
  'art/logo.png': pngBytes(1500, 1500, 'rgba'),
  'public/box.png': pngBytes(280, 280, 'rgba'),
};

function project(art: Record<string, unknown>): string {
  const dir = join(tempTree('boardsmith-build-cover-art-'), 'game');
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table', ...art }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body></body></html>\n');
  writeFileSync(
    join(dir, 'src', 'rules', 'index.ts'),
    `import { DeadEndGame } from ${JSON.stringify(fixtureGame)};\n` +
      "export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', minPlayers: 3, maxPlayers: 4 };\n",
  );
  for (const [path, bytes] of Object.entries(ART)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  return dir;
}

async function build(dir: string): Promise<unknown> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await buildProject(dir, {});
    return undefined;
  } catch (thrown) {
    return thrown;
  } finally {
    log.mockRestore();
  }
}

function manifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'dist', 'manifest.json'), 'utf-8'));
}

const withArt = project({ backdrop: './art/backdrop.jpg', logo: 'art/logo.png', box: 'public/box.png' });
const withArtError = await build(withArt);

const withoutArt = project({});
const withoutArtError = await build(withoutArt);

const missingArt = project({ logo: 'art/missing.png' });
const missingArtError = await build(missingArt);

describe('boardsmith build packs declared cover art (#1630)', () => {
  it('writes each declared path into the manifest, normalised', () => {
    expect(withArtError).toBeUndefined();
    expect(manifest(withArt)).toMatchObject({ backdrop: 'art/backdrop.jpg', logo: 'art/logo.png', box: 'public/box.png' });
  });

  it('packs each file in bundle.zip at the path the manifest names, byte for byte', () => {
    const files = readDistDir(join(withArt, 'dist'));
    const packed = JSON.parse(new TextDecoder().decode(files.get('boardsmith.json')));
    for (const key of ['backdrop', 'logo', 'box']) {
      const path = packed[key] as string;
      expect([...files.get(path)!], path).toEqual([...ART[path as keyof typeof ART]]);
    }
  });

  it('leaves a game that declares no art without any art field', () => {
    expect(withoutArtError).toBeUndefined();
    const built = manifest(withoutArt);
    for (const key of ['backdrop', 'logo', 'box']) expect(built).not.toHaveProperty(key);
  });

  it('fails, naming the field and file, when declared art does not exist', () => {
    expect(String(missingArtError)).toMatch(/boardsmith\.json "logo"[\s\S]*art\/missing\.png/);
  });
});
