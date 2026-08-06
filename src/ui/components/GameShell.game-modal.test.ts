// @vitest-environment jsdom
/**
 * GameShell #bs-game-modal teleport host — the `shellMounted` mount gate.
 *
 * Uses a minimal harness component mirroring GameShell.vue's exact template
 * wiring (same pattern as GameShell.test.ts / GameShell.devtools.test.ts —
 * the full GameShell is WebSocket-dependent and is not mounted in unit tests).
 * If GameShell changes the modal-host/gate wiring, this harness must receive
 * the same change.
 *
 * Production wiring under test (GameShell.vue):
 *
 *   <div class="game-shell__game-modal-host" id="bs-game-modal"></div>
 *   <div class="game-shell__zoom-container">
 *     <template v-if="shellMounted">   ← the gate
 *       <slot name="game-board" ... />
 *     </template>
 *   </div>
 *
 *   const shellMounted = ref(false);
 *   onMounted(() => { shellMounted.value = true; });
 *
 * Why the gate exists (the cribbage round-summary wedge, 2026-07-02):
 * on a fresh page load the whole app tree is built detached and inserted into
 * the document at the end of the root mount. A game component that mounts in
 * the same pass as the shell resolves `<Teleport to="#bs-game-modal">` via
 * document.querySelector and finds nothing; Vue mounts the Teleport with a
 * null target, and the game component's FIRST re-render then throws mid-patch
 * ("Cannot read properties of null"), aborting the flush queue and wedging
 * every other pending component update (dead Action Panel, stale board, no
 * round summary). The gate defers the game UI by one tick — mounted hooks run
 * after the tree is in the document — so the target always resolves.
 *
 * Behaviors under test:
 *   GM-1: WITHOUT the gate, a slotted board's plain Teleport fails to resolve
 *         `#bs-game-modal` on a same-pass mount (Vue warns "Failed to locate
 *         Teleport target") — the precondition of the wedge the gate prevents.
 *         (The wedge itself — a mid-patch throw on the first re-render — is
 *         deliberately not triggered here: it aborts Vue's scheduler flush in
 *         a way no errorHandler can intercept, which is exactly why it must be
 *         prevented rather than handled.)
 *   GM-2: WITH the gate, the board mounts cleanly, the teleported modal
 *         renders into #bs-game-modal when toggled, and sibling components
 *         keep updating throughout.
 */

import { describe, it, expect } from 'vitest';
import { createApp, defineComponent, h, ref, nextTick, onMounted, Teleport } from 'vue';

/** A game board that (like cribbage's RoundSummary) always renders a Teleport
 *  to the shell's modal host, with the visible content gated by `active`. */
function makeBoard(active: import('vue').Ref<boolean>, renderCount: import('vue').Ref<number>) {
  return defineComponent({
    name: 'FakeBoard',
    setup() {
      return () =>
        h('div', { class: 'board' }, [
          h('div', { class: 'cards' }, `render:${renderCount.value}`),
          h(Teleport, { to: '#bs-game-modal' }, [
            active.value ? h('div', { class: 'round-summary' }, 'ROUND SUMMARY') : null,
          ]),
        ]);
    },
  });
}

/** Shell harness mirroring GameShell.vue: modal host div, then the board
 *  (gated or not), then a sibling "action panel" that must keep updating. */
function makeShell(opts: {
  gated: boolean;
  board: ReturnType<typeof makeBoard>;
  actionPanelValue: import('vue').Ref<number>;
}) {
  return defineComponent({
    name: 'FakeShell',
    setup() {
      const shellMounted = ref(!opts.gated);
      onMounted(() => {
        shellMounted.value = true;
      });
      return () =>
        h('div', { class: 'shell' }, [
          h('div', { class: 'game-shell__game-modal-host', id: 'bs-game-modal' }),
          h('div', { class: 'game-shell__zoom-container' }, [
            shellMounted.value ? h(opts.board) : null,
          ]),
          h('div', { class: 'action-panel-probe' }, `action-panel:${opts.actionPanelValue.value}`),
        ]);
    },
  });
}

function mountShell(gated: boolean, warnings: string[]) {
  const active = ref(false);
  const renderCount = ref(0);
  const actionPanelValue = ref(0);
  const board = makeBoard(active, renderCount);
  const Shell = makeShell({ gated, board, actionPanelValue });

  document.body.innerHTML = '<div id="app"></div>';
  const app = createApp(Shell);
  app.config.warnHandler = (msg) => {
    warnings.push(msg);
  };
  app.mount('#app');

  return { active, renderCount, actionPanelValue };
}

describe('GameShell #bs-game-modal mount gate', () => {
  it('GM-1: without the gate, a plain Teleport in the board cannot resolve #bs-game-modal at mount', async () => {
    const warnings: string[] = [];
    // The ungated mount may throw outright: after the "Failed to locate
    // Teleport target" warning, Vue's follow-up "Invalid Teleport target on
    // mount: null" warning crashes while formatting the null target. Either
    // way the app is broken — GM-1 only pins that the target didn't resolve.
    try {
      mountShell(false, warnings);
    } catch {
      /* expected on some Vue builds — see above */
    }
    await nextTick();

    // The board mounted in the same pass as the shell, while the whole tree was
    // still detached — the Teleport target lookup came up empty. From here, the
    // board's first re-render would throw mid-patch and wedge the app: the
    // failure mode the shellMounted gate exists to prevent.
    expect(warnings.join(' ')).toMatch(/Failed to locate Teleport target/);
  });

  it('GM-2: with the gate, the teleported modal renders into #bs-game-modal and updates keep flowing', async () => {
    const warnings: string[] = [];
    const { active, renderCount, actionPanelValue } = mountShell(true, warnings);
    await nextTick(); // shellMounted flips true → board mounts with host in document
    await nextTick();

    expect(document.querySelector('.board')).toBeTruthy();
    // No "Failed to locate Teleport target" / "Invalid Teleport target" warnings.
    expect(warnings.join(' ')).not.toMatch(/Teleport target/);

    // Round boundary: summary shows INSIDE the modal host, siblings keep updating.
    active.value = true;
    renderCount.value = 1;
    actionPanelValue.value = 1;
    await nextTick();
    expect(document.querySelector('#bs-game-modal .round-summary')).toBeTruthy();
    expect(document.querySelector('.cards')!.textContent).toBe('render:1');
    expect(document.querySelector('.action-panel-probe')!.textContent).toBe('action-panel:1');

    // Dismiss and keep playing: everything still updates.
    active.value = false;
    renderCount.value = 2;
    actionPanelValue.value = 2;
    await nextTick();
    expect(document.querySelector('.round-summary')).toBeNull();
    expect(document.querySelector('.cards')!.textContent).toBe('render:2');
    expect(document.querySelector('.action-panel-probe')!.textContent).toBe('action-panel:2');
  });
});
