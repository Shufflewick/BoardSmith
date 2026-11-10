// @vitest-environment jsdom
/**
 * A PICK SENT THROUGH THE SELECTION-STEP PATH MARKS THE PANEL SUBMITTING (#1595).
 *
 * A pick whose selection has an onSelect (or whose action is held on the
 * server, as a follow-up is) goes out as `selection_step`, not `action`, and
 * the panel showed it as settled until the reply: the old choices on screen,
 * no `data-bs-submitting`. The smoke walk read that as a settled panel and
 * pressed a second choice of the request already sent.
 *
 * Driven on the REAL GameShell, controller and transport.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

const frame = {
  type: 'game_state',
  view: {
    flowState: { awaitingInput: true, complete: false, awaitingPlayers: [{ playerIndex: 1, availableActions: ['collect', 'pass'], completed: false }] },
    state: {
      view: {},
      players: [{ seat: 1, name: 'P1' }],
      isMyTurn: true,
      // Two actions, so the panel waits for the player rather than auto-running a sole one.
      availableActions: ['collect', 'pass'],
      actionMetadata: {
        collect: { name: 'collect', prompt: 'Collect', selections: [{ name: 'item', type: 'choice', prompt: 'Which item?', hasOnSelect: true }] },
        pass: { name: 'pass', prompt: 'Pass', selections: [] },
      },
    },
  },
  winners: [],
};

const mounted: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  leaveIframe();
});

describe('GameShell sending a pick step (#1595)', () => {
  it('marks the panel submitting from the press until the step is answered', async () => {
    const posted = enterIframe() as Array<{ type?: string; op?: string; requestId?: string }>;
    const wrapper = mountPlatformShell();
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(frame);
    await flushPromises();

    const panel = () => wrapper.find('#bs-actionbar .action-panel-root');
    const button = (text: string) => panel().findAll('button').find((b) => b.text().includes(text));
    const requests = (op: string) => posted.filter((m) => m.type === 'server_request' && m.op === op);

    await button('Collect')!.trigger('click');
    await flushPromises();
    fromHost({
      type: 'server_response',
      requestId: requests('resolve_choices')[0].requestId,
      result: { success: true, choices: [{ value: 'kit', display: 'Medical Kit' }, { value: 'smaw', display: 'SMAW' }] },
    });
    await flushPromises();

    await button('Medical Kit')!.trigger('click');
    await flushPromises();
    expect(requests('selection_step')).toHaveLength(1);
    expect(panel().attributes('data-bs-submitting')).toBeDefined();

    fromHost({ type: 'server_response', requestId: requests('selection_step')[0].requestId, result: { success: true, actionComplete: true } });
    await flushPromises();
    expect(panel().attributes('data-bs-submitting')).toBeUndefined();
  });
});
