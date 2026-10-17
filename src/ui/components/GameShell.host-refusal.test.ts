// @vitest-environment jsdom
/**
 * A REFUSED TEACHING CONTROL SAYS SO (#859).
 *
 * The platform transport never rejects: a host that refuses an op, or never
 * answers, RESOLVES `{ success: false, error }`. The demo bar only caught a
 * rejection, so a refusal removed nothing and showed nothing, and in production,
 * where the host has no demo or teaching ops at all, every control looked dead.
 *
 * Driven on the REAL GameShell through the REAL transport: the button posts a
 * `server_request`, the host answers it, and the toast is read off the one
 * global toast list.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useToast } from '../composables/useToast.js';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

const toast = useToast();

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

/** Seat 1 watching a running, paused bot demo. */
async function mountDemoTable() {
  const posted = enterIframe();
  const wrapper = mountPlatformShell();
  await nextTick();
  fromHost({ type: 'init', seat: 1 });
  fromHost({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: [] },
      state: {
        view: {},
        players: [{ name: 'P1', seat: 1 }, { name: 'P2', seat: 2 }],
        currentPlayer: 1,
        isMyTurn: false,
        availableActions: [],
        isDemoRunning: true,
        demoControls: { paused: true, delay: 1200, canStepBack: false },
      },
    },
    winners: [],
  });
  await flushPromises();
  /** Answer the one request posted for `op`. */
  function answer(op: string, result: Record<string, unknown>): void {
    const request = posted.find((m) => (m as { op?: string }).op === op) as { requestId: string } | undefined;
    if (!request) throw new Error(`the shell never asked the host for '${op}'`);
    fromHost({ type: 'server_response', requestId: request.requestId, result });
  }
  return { wrapper, answer };
}

afterEach(() => {
  for (const t of [...toast.toasts.value]) toast.remove(t.id);
  leaveIframe();
  document.body.innerHTML = '';
});

describe('GameShell shows a host refusal of a demo control (#859)', () => {
  it('reads an op the host does not know as a control the table does not support', async () => {
    const { wrapper, answer } = await mountDemoTable();
    await wrapper.find('[aria-label="Step forward one move"]').trigger('click');
    answer('demo-control', { success: false, error: "Unknown server op: 'demo-control'" });
    await flushPromises();
    expect(toast.toasts.value.map((t) => [t.type, t.message])).toEqual([
      ['error', 'This table does not support demo controls.'],
    ]);
  });

  it('shows the host\'s own reason when it refuses to stop the demo', async () => {
    const { wrapper, answer } = await mountDemoTable();
    await wrapper.find('[aria-label="Stop demo"]').trigger('click');
    answer('demo-stop', { success: false, error: 'No demo is running.' });
    await flushPromises();
    expect(toast.toasts.value.map((t) => [t.type, t.message])).toEqual([['error', 'No demo is running.']]);
  });
});
