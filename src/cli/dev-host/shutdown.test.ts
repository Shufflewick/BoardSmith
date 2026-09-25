/**
 * A dev command's stop (#197, #366).
 *
 * #197: Ctrl-C through a package script signals the process twice, once from
 * the terminal and once forwarded by npm, so a dev command is routinely told
 * to stop twice for one keypress. It must stop once.
 *
 * #366: a stop that cannot finish must still end, and say what it could not
 * close. The teardown closes what a host holds in order and bounds the wait,
 * and a second Ctrl-C ends it at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DUPLICATE_SIGNAL_MS, onShutdown, STOP_LIMIT_MS, teardownInOrder, type HeldResource } from './shutdown.js';

/** A resource whose close never finishes, the shape Vite's close had in #366. */
const neverCloses = (name: string): HeldResource => ({ name, close: () => new Promise<void>(() => {}) });

describe('teardownInOrder', () => {
  it('closes every resource in order, once, however many callers ask', async () => {
    const closed: string[] = [];
    const teardown = teardownInOrder([
      { name: 'the socket', close: () => void closed.push('socket') },
      { name: 'the world', close: async () => void closed.push('world') },
    ]);
    await Promise.all([teardown.run(), teardown.run()]);
    expect(closed).toEqual(['socket', 'world']);
    expect(teardown.stillOpen()).toEqual([]);
  });

  it('names what is still open while a close is in progress', async () => {
    let release = (): void => {};
    const teardown = teardownInOrder([
      { name: 'the socket', close: () => {} },
      { name: 'the Vite dev server', close: () => new Promise<void>((resolve) => (release = resolve)) },
      { name: 'the build directory', close: () => {} },
    ]);
    const running = teardown.run();
    await vi.waitFor(() => expect(teardown.stillOpen()).toEqual(['the Vite dev server', 'the build directory']));
    release();
    await running;
    expect(teardown.stillOpen()).toEqual([]);
  });

  it('closes the rest when one close fails, then refuses naming the one that did not close', async () => {
    const closed: string[] = [];
    const teardown = teardownInOrder([
      { name: 'the world', close: () => Promise.reject(new Error('the store is locked')) },
      { name: 'the build directory', close: () => void closed.push('build') },
    ]);
    await expect(teardown.run()).rejects.toThrow('Still open: the world (the store is locked).');
    expect(closed).toEqual(['build']);
    expect(teardown.stillOpen()).toEqual(['the world']);
  });

  describe('a close that never finishes', () => {
    beforeEach(() => void vi.useFakeTimers());
    afterEach(() => void vi.useRealTimers());

    it('is given up on after the limit, naming it and everything after it', async () => {
      const teardown = teardownInOrder([
        { name: 'the socket', close: () => {} },
        neverCloses('the Vite dev server'),
        { name: 'the build directory', close: () => {} },
      ]);
      const running = teardown.run();
      const refused = expect(running).rejects.toThrow(
        `Stopping did not finish within ${STOP_LIMIT_MS / 1000} seconds. ` +
          'Still open: the Vite dev server, the build directory.',
      );
      await vi.advanceTimersByTimeAsync(STOP_LIMIT_MS);
      await refused;
    });

    it('leaves no timer behind when it does finish', async () => {
      await teardownInOrder([{ name: 'the socket', close: () => {} }]).run();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('a dev command shutting down', () => {
  const handles: Array<{ cancel(): void }> = [];
  const said: string[] = [];
  const exit = vi.fn();
  const io = { say: (line: string) => void said.push(line), exit };

  beforeEach(() => {
    said.length = 0;
    exit.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.cancel();
    vi.useRealTimers();
  });

  it('runs the teardown once for the two signals one Ctrl-C delivers, then exits cleanly', async () => {
    const close = vi.fn();
    handles.push(onShutdown(teardownInOrder([{ name: 'the socket', close }]), io));
    process.emit('SIGINT');
    process.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(said.filter((line) => line.includes('Shutting down...'))).toHaveLength(1);
  });

  it('a second Ctrl-C stops without waiting, naming what is still open', async () => {
    handles.push(onShutdown(teardownInOrder([neverCloses('the Vite dev server')]), io));
    process.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(DUPLICATE_SIGNAL_MS);
    process.emit('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
    expect(said.at(-1)).toBe('Stopped without waiting. Still open: the Vite dev server.');
  });

  it('a stop that never finishes exits after the limit, naming what is still open', async () => {
    handles.push(onShutdown(teardownInOrder([neverCloses('the Vite dev server')]), io));
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(STOP_LIMIT_MS);
    expect(exit).toHaveBeenCalledWith(1);
    expect(said.at(-1)).toContain('Still open: the Vite dev server.');
  });

  it('stops listening when cancelled', async () => {
    const close = vi.fn();
    onShutdown(teardownInOrder([{ name: 'the socket', close }]), io).cancel();
    process.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(0);
    expect(close).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
