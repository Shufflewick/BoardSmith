// @vitest-environment jsdom
/**
 * GameShell clears its dev-build 0x0 board check on unmount (#749): the check
 * waits SETTLE_MS after each state and must not outlive the shell.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { SETTLE_MS } from '../composables/useAutoZoom.js';
import { leaveIframe, mountTableWithDebugPanel } from './GameShell.platform-mount.test-helper.js';

const Board = defineComponent({ setup: () => () => h('div', 'board') });

afterEach(() => {
  leaveIframe();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GameShell unmount (#749)', () => {
  it('clears the pending 0x0 board check when unmounted after a state arrived', async () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { wrapper } = await mountTableWithDebugPanel(Board);
    const settleChecks = setSpy.mock.calls.flatMap((call, i) =>
      call[1] === SETTLE_MS ? [setSpy.mock.results[i]!.value] : [],
    );
    expect(settleChecks).toHaveLength(1);

    wrapper.unmount();

    expect(clearSpy.mock.calls.map(([id]) => id)).toContain(settleChecks[0]);
  });
});
