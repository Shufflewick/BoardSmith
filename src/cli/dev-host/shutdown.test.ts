/**
 * #197: Ctrl-C through a package script signals every process in the group, so
 * a dev command is routinely told to stop twice. It must stop once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { onShutdown } from './shutdown.js';

describe('a dev command shutting down', () => {
  const handles: Array<{ cancel(): void }> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.cancel();
  });

  it('runs the teardown once however many signals arrive', async () => {
    const teardown = vi.fn(async () => {});
    const handle = onShutdown(teardown);
    handles.push(handle);
    process.emit('SIGINT');
    process.emit('SIGTERM');
    process.emit('SIGINT');
    await handle.run();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('a second caller joins the run already in progress', async () => {
    let release = (): void => {};
    const teardown = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const handle = onShutdown(teardown);
    handles.push(handle);
    const first = handle.run();
    const second = handle.run();
    release();
    await Promise.all([first, second]);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('stops listening when cancelled', async () => {
    const teardown = vi.fn(async () => {});
    onShutdown(teardown).cancel();
    process.emit('SIGINT');
    await Promise.resolve();
    expect(teardown).not.toHaveBeenCalled();
  });
});
