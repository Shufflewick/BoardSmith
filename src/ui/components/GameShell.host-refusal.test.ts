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
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useToast } from '../composables/useToast.js';
import PlayShell from './PlayShell.vue';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
  mountTableWithDebugPanel,
} from './GameShell.platform-mount.test-helper.js';

const toast = useToast();
const Board = defineComponent({ name: 'Board', setup: () => () => h('div', 'board') });

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

/** Answer the one request `posted` holds for `op`. */
function answerer(posted: unknown[]) {
  return (op: string, result: Record<string, unknown>): void => {
    const request = posted.find((m) => (m as { op?: string }).op === op) as { requestId: string } | undefined;
    if (!request) throw new Error(`the shell never asked the host for '${op}'`);
    fromHost({ type: 'server_response', requestId: request.requestId, result });
  };
}

/** Seat 1's frame while a paused bot demo runs; `complete` ends the game. */
function postDemoState(complete = false): void {
  fromHost({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: !complete, availableActions: [], complete },
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
}

/** Seat 1 watching a running, paused bot demo. */
async function mountDemoTable() {
  const posted = enterIframe();
  const wrapper = mountPlatformShell();
  mounted.push(wrapper);
  await nextTick();
  fromHost({ type: 'init', seat: 1 });
  postDemoState();
  await flushPromises();
  return { wrapper, answer: answerer(posted) };
}

/** Every shell a test mounted: one left mounted answers the next test's request ids too. */
const mounted: { unmount(): void }[] = [];

const shownToasts = () => toast.toasts.value.map((t) => [t.type, t.message]);

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
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
    expect(shownToasts()).toEqual([
      ['error', 'This table does not support demo controls.'],
    ]);
  });

  it('shows the host\'s own reason when it refuses to stop the demo', async () => {
    const { wrapper, answer } = await mountDemoTable();
    await wrapper.find('[aria-label="Stop demo"]').trigger('click');
    answer('demo-stop', { success: false, error: 'No demo is running.' });
    await flushPromises();
    expect(shownToasts()).toEqual([['error', 'No demo is running.']]);
  });
});

describe('GameShell shows a host refusal of the demo stop a finished game sends (#859)', () => {
  it('shows the host\'s reason', async () => {
    const { answer } = await mountDemoTable();
    postDemoState(true);
    await flushPromises();
    answer('demo-stop', { success: false, error: 'No demo is running.' });
    await flushPromises();
    expect(shownToasts()).toEqual([['error', 'No demo is running.']]);
  });
});

describe('GameShell shows a host refusal of undo and the debug ops (#859)', () => {
  it('undo', async () => {
    const { wrapper, posted } = await mountTableWithDebugPanel(Board);
    mounted.push(wrapper);
    wrapper.findComponent(PlayShell).vm.$emit('undo');
    await flushPromises();
    answerer(posted)('undo', { success: false, error: 'Nothing to undo.' });
    await flushPromises();
    expect(shownToasts()).toEqual([['error', 'Nothing to undo.']]);
  });

  it.each([
    ['debug:switch-seat', 'switch-player', [2]],
    ['debug:restart', 'restart-game', []],
  ] as const)('%s', async (op, event, args) => {
    const { wrapper, debugPanel, posted } = await mountTableWithDebugPanel(Board);
    mounted.push(wrapper);
    debugPanel.vm.$emit(event, ...args);
    await flushPromises();
    answerer(posted)(op, { success: false, error: 'Debugging is off at this table.' });
    await flushPromises();
    expect(shownToasts()).toEqual([['error', 'Debugging is off at this table.']]);
  });
});
