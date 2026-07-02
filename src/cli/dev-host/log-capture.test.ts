import { describe, it, expect, beforeEach } from 'vitest';
import { record, getEntries, clearEntries, MAX_LOG_ENTRIES } from './log-capture.js';

describe('log-capture ring buffer (ERR-04)', () => {
  beforeEach(() => {
    clearEntries();
  });

  it('record() then getEntries() returns entries with {severity, message, source, timestamp}', () => {
    record('warning', 'boardRefs boom', 'boardRefs');
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ severity: 'warning', message: 'boardRefs boom', source: 'boardRefs' });
    expect(typeof entries[0].timestamp).toBe('number');
  });

  it('pushing more than MAX_LOG_ENTRIES evicts oldest (FIFO), length never exceeds cap', () => {
    for (let i = 0; i < MAX_LOG_ENTRIES + 10; i++) {
      record('info', `entry-${i}`, 'test');
    }
    const entries = getEntries();
    expect(entries.length).toBe(MAX_LOG_ENTRIES);
    // Oldest 10 were evicted — the first entry should be entry-10.
    expect(entries[0].message).toBe('entry-10');
    expect(entries[entries.length - 1].message).toBe(`entry-${MAX_LOG_ENTRIES + 9}`);
  });

  it('record() messages contain no stack trace / file path', () => {
    const err = new Error('boom');
    record('error', err.message, 'test');
    const entries = getEntries();
    expect(entries[0].message).not.toMatch(/\.ts:\d+/);
    expect(entries[0].message).not.toContain('at ');
  });
});
