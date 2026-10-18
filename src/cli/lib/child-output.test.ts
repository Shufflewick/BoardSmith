import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { collectOutput } from './child-output.js';

describe('collectOutput', () => {
  it('keeps a character whose bytes arrive in two chunks whole (#853)', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const output = collectOutput({ stdout, stderr } as unknown as ChildProcess);
    const bytes = Buffer.from('é', 'utf-8');
    stdout.write(bytes.subarray(0, 1));
    stdout.write(bytes.subarray(1));
    await new Promise((resolve) => setImmediate(resolve));
    expect(output()).toBe('é');
  });
});
