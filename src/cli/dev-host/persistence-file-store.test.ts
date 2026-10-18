/**
 * #887: the dev store is written whole or not at all. A save writes a new file
 * and renames it over the old one, so a crash mid-write cannot leave the
 * developer's store torn; a second name for the old file still reads the old
 * store afterwards, which an in-place write would have overwritten.
 */
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadDevStore } from './persistence-file-store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('replaces the store file rather than writing into it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-store-'));
  dirs.push(dir);
  const path = join(dir, '.boardsmith-dev-store.json');
  const { save } = loadDevStore(path);
  writeFileSync(path, 'old');
  linkSync(path, join(dir, 'old-name'));

  await save();

  expect(readFileSync(join(dir, 'old-name'), 'utf8')).toBe('old');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toBeTypeOf('object');
});
