import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { collectOutput, logLines } from './child-output.js';

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

describe('logLines', () => {
  it('logs a line whose text arrives in two chunks as one line, and the last line though it has no newline (#1691)', async () => {
    const stream = new PassThrough().setEncoding('utf-8');
    const logged: string[] = [];
    logLines(stream, (line) => logged.push(line));
    stream.write('one\ntw');
    stream.write('o\n\nthree');
    stream.end();
    await new Promise((resolve) => stream.once('end', resolve));
    expect(logged).toEqual(['one', 'two', 'three']);
  });
});
