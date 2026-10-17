import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { readIfExists } from './read-if-exists.js';

const readText = (path: string) => fs.readFile(path, 'utf-8');

describe('readIfExists', () => {
  it('reads a file that is there', async () => {
    const dir = tempTree('bs-read-if-exists-');
    await fs.writeFile(join(dir, 'a.txt'), 'hello');
    expect(await readIfExists(join(dir, 'a.txt'), readText)).toBe('hello');
  });

  it('answers undefined when nothing is at the path', async () => {
    expect(await readIfExists(join(tempTree('bs-read-if-exists-'), 'gone.txt'), readText)).toBeUndefined();
  });

  it('throws, naming the file, when a folder is in the file\'s place', async () => {
    const dir = tempTree('bs-read-if-exists-');
    await fs.mkdir(join(dir, 'a.txt'));
    await expect(readIfExists(join(dir, 'a.txt'), readText)).rejects.toThrow(`Could not read ${join(dir, 'a.txt')} (EISDIR)`);
  });

  it('answers undefined when a file stands where a folder on the path would be, since nothing is at the path', async () => {
    const dir = tempTree('bs-read-if-exists-');
    await fs.writeFile(join(dir, 'a'), '');
    expect(await readIfExists(join(dir, 'a', 'b.txt'), readText)).toBeUndefined();
  });

  it('throws, naming the file, when it may not look at the path', async () => {
    const dir = tempTree('bs-read-if-exists-');
    await fs.mkdir(join(dir, 'locked'));
    await fs.writeFile(join(dir, 'locked', 'a.txt'), 'hello');
    await fs.chmod(join(dir, 'locked'), 0o000);
    try {
      await expect(readIfExists(join(dir, 'locked', 'a.txt'), readText)).rejects.toThrow(`Could not read ${join(dir, 'locked', 'a.txt')} (EACCES)`);
    } finally {
      await fs.chmod(join(dir, 'locked'), 0o755);
    }
  });
});
