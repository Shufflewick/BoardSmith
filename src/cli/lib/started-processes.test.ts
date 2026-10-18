import { describe, it, expect } from 'vitest';
import { Started } from './started-processes.js';

describe('Started.finish', () => {
  it('lets the signals go even when the clean-up throws (#853)', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const started = new Started();
    await expect(started.finish(() => Promise.reject(new Error('clean-up failed')))).rejects.toThrow('clean-up failed');
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
});
