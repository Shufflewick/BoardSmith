// @vitest-environment jsdom
/**
 * "Rewind Here" must confirm through an IN-PANEL dialog, never `window.confirm`.
 *
 * Bug: the rewind control called `window.confirm`. A native modal dialog is the
 * wrong tool inside this shell for three independent reasons, and each one broke
 * the control in a different way:
 *
 *  1. It BLOCKS the renderer. The game holds a live WebSocket and renders
 *     continuously; while the dialog is up the whole tab is frozen — including
 *     the debug panel that raised it. Reproduced: clicking "Rewind Here" in
 *     `boardsmith dev` wedged the page until the dialog was dismissed by hand.
 *  2. The game runs INSIDE AN IFRAME in platform mode, and Chrome blocks modal
 *     dialogs from cross-origin iframes outright — `confirm()` returns false
 *     without showing anything, so the button silently did nothing at all.
 *  3. Chrome's "prevent this page from creating additional dialogs" box makes
 *     every later `confirm()` return false, permanently disabling the control.
 *
 * This file guards the fix at both levels: the behaviour (confirm before the
 * request, cancel sends nothing) and the mechanism (no native dialog API is
 * reachable from the UI at all). `restartConfirming` in this same component was
 * already doing in-panel confirmation for the other destructive debug action —
 * rewind was the odd one out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DebugPanel from './DebugPanel.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ACTION_HISTORY = [
  { name: 'move', player: 1, args: {}, timestamp: 1 },
  { name: 'endTurn', player: 1, args: {}, timestamp: 2 },
  { name: 'move', player: 2, args: {}, timestamp: 3 },
];

function mountPanel() {
  const platformRequest = vi.fn(async (op: string) => {
    if (op === 'debug:history') return { success: true, actionHistory: ACTION_HISTORY };
    if (op === 'debug:state-at') return { success: true, state: { phase: 'test' } };
    if (op === 'debug:state-diff') return { success: true, diff: null };
    if (op === 'debug:rewind') return { success: true };
    return { success: true };
  });

  const wrapper = mount(DebugPanel, {
    props: {
      state: { phase: 'test', round: 1 },
      playerSeat: 1,
      playerCount: 2,
      gameId: 'test-game',
      expanded: true,
    },
    global: { provide: { platformRequest } },
    attachTo: document.body,
  });

  return { wrapper, platformRequest };
}

/** Open the History tab, load actions, and select one so "Rewind Here" renders. */
async function openRewindableHistory(wrapper: ReturnType<typeof mountPanel>['wrapper']) {
  const vm = wrapper.vm as unknown as {
    activeTab: string;
    selectedActionIndex: number | null;
    actionHistory: unknown[];
  };
  vm.activeTab = 'history';
  await nextTick();
  vm.actionHistory = ACTION_HISTORY;
  vm.selectedActionIndex = 1;
  await nextTick();
}

function rewindButton(wrapper: ReturnType<typeof mountPanel>['wrapper']) {
  return wrapper.findAll('button').find((b) => b.text().startsWith('Rewind Here'));
}

function dialogConfirmButton(wrapper: ReturnType<typeof mountPanel>['wrapper']) {
  const dialog = wrapper.find('.debug-dialog-footer');
  if (!dialog.exists()) return undefined;
  return dialog.findAll('button').find((b) => b.text() === 'Rewind');
}

describe('DebugPanel rewind confirmation', () => {
  let native: { confirm: unknown; alert: unknown; prompt: unknown };

  beforeEach(() => {
    // Fail LOUD if the component reaches for a native dialog: a stub returning
    // `true` would let the old code path pass this whole file silently.
    native = { confirm: window.confirm, alert: window.alert, prompt: window.prompt };
    window.confirm = () => { throw new Error('window.confirm must never be called from the UI'); };
    window.alert = () => { throw new Error('window.alert must never be called from the UI'); };
    window.prompt = () => { throw new Error('window.prompt must never be called from the UI'); };
  });

  afterEach(() => {
    window.confirm = native.confirm as typeof window.confirm;
    window.alert = native.alert as typeof window.alert;
    window.prompt = native.prompt as typeof window.prompt;
  });

  it('opens an in-panel dialog instead of a native one, and sends nothing yet', async () => {
    const { wrapper, platformRequest } = mountPanel();
    await openRewindableHistory(wrapper);

    const btn = rewindButton(wrapper);
    expect(btn).toBeDefined();
    await btn!.trigger('click');

    expect(wrapper.find('.debug-dialog-overlay').exists()).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    // The rewind is irreversible — nothing may reach the host on the first click.
    expect(platformRequest.mock.calls.some(([op]) => op === 'debug:rewind')).toBe(false);

    wrapper.unmount();
  });

  it('names exactly how many actions the rewind would discard', async () => {
    const { wrapper } = mountPanel();
    await openRewindableHistory(wrapper);
    await rewindButton(wrapper)!.trigger('click');

    // 3 recorded actions, rewinding to index 1 → 2 discarded.
    expect(wrapper.find('.debug-dialog-body').text()).toContain('2 action');

    wrapper.unmount();
  });

  it('sends debug:rewind for the selected index only after confirming', async () => {
    const { wrapper, platformRequest } = mountPanel();
    await openRewindableHistory(wrapper);
    await rewindButton(wrapper)!.trigger('click');

    await dialogConfirmButton(wrapper)!.trigger('click');
    await nextTick();

    const call = platformRequest.mock.calls.find(([op]) => op === 'debug:rewind');
    expect(call).toBeDefined();
    expect((call as unknown as [string, { actionIndex: number }])[1]).toEqual({ actionIndex: 1 });
    // Dialog closes once the request is on its way.
    expect(wrapper.find('.debug-dialog-overlay').exists()).toBe(false);

    wrapper.unmount();
  });

  it('cancelling closes the dialog and rewinds nothing', async () => {
    const { wrapper, platformRequest } = mountPanel();
    await openRewindableHistory(wrapper);
    await rewindButton(wrapper)!.trigger('click');

    const cancel = wrapper.find('.debug-dialog-footer').findAll('button').find((b) => b.text() === 'Cancel');
    await cancel!.trigger('click');
    await nextTick();

    expect(wrapper.find('.debug-dialog-overlay').exists()).toBe(false);
    expect(platformRequest.mock.calls.some(([op]) => op === 'debug:rewind')).toBe(false);

    wrapper.unmount();
  });
});

describe('no native modal dialogs anywhere in the UI', () => {
  // The mechanism guard. Any `window.confirm/alert/prompt` in a shipped UI file
  // freezes the renderer, and silently returns false inside the platform iframe
  // — so the control it guards does nothing, with no error to explain it.
  const UI_DIR = path.join(HERE, '..');

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        sourceFiles(full, acc);
      } else if (/\.(vue|ts)$/.test(entry.name) && !entry.name.includes('.test.')) {
        acc.push(full);
      }
    }
    return acc;
  }

  it('src/ui contains no window.confirm / alert / prompt call', () => {
    const offenders = sourceFiles(UI_DIR)
      .filter((file) => /\bwindow\.(confirm|alert|prompt)\s*\(/.test(fs.readFileSync(file, 'utf-8')))
      .map((file) => path.relative(UI_DIR, file));

    expect(offenders).toEqual([]);
  });
});
