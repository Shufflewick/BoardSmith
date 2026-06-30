// @vitest-environment jsdom
/**
 * ActionPanel interaction tests — prove Bug C and D-02 footer-presence semantics.
 *
 * These tests mount the REAL ActionPanel with a REAL useActionController to exercise
 * the full fetch→snapshotVersion→computed→render chain that controller-unit tests
 * cannot catch (because those tests never mount a component).
 *
 * Test C1: Bug C reactivity
 *   The mounted footer must re-render choice buttons when async-fetched choices
 *   arrive. Without the fix, filteredChoices calls the non-reactive getCurrentChoices()
 *   and the panel stays blank ("No options available") even after choices land.
 *
 *   Reproduction: mount the panel WHILE the destination pick is active but choices
 *   haven't arrived yet, then resolve the deferred fetch and assert re-render.
 *
 * Test D1: D-02 footer-presence rule
 *   allCurrentChoicesAnchored must be FALSE for a choice-type pick (even if choices
 *   carry notation refs). Under the old notation-walking implementation, notation
 *   choices returned TRUE (footer suppressed). Under D-02 the computed becomes
 *   `validElements.value.length > 0`, which is always 0 for choice picks → false.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { useActionController } from '../../composables/useActionController.js';
import type { ActionMetadata } from '../../composables/useActionController.js';
import ActionPanel from './ActionPanel.vue';

// ── Fixture: two-step move ────────────────────────────────────────────────
// Step 1: element pick (piece)
// Step 2: choice pick (destination) — choices arrive async, no refs so they
//         appear in the ActionPanel (not filtered by filterAnchoredChoices).
const twoStepMoveAction: ActionMetadata = {
  name: 'twoStepMove',
  prompt: 'Move',
  selections: [
    { name: 'piece', type: 'element', prompt: 'Pick a piece' },
    {
      name: 'destination',
      type: 'choice',
      prompt: 'Pick destination',
      filterBy: { key: 'pieceId', selectionName: 'piece' },
    },
  ],
};

// Fixture: notation-anchored choice action (used for D-02 test)
// All destination choices carry notation refs — under the OLD allCurrentChoicesAnchored
// impl (notation-walking), this returns TRUE (footer suppressed). Under D-02 it must
// return FALSE (choice picks never suppress footer because validElements is always []).
const notationChoiceAction: ActionMetadata = {
  name: 'notationChoice',
  prompt: 'Place',
  selections: [
    {
      name: 'destination',
      type: 'choice',
      prompt: 'Pick destination',
      choices: [
        {
          value: { toNotation: 'a5' },
          display: 'a5',
          refs: [{ ref: { notation: 'a5' }, role: 'target' as const }],
        },
        {
          value: { toNotation: 'c5' },
          display: 'c5',
          refs: [{ ref: { notation: 'c5' }, role: 'target' as const }],
        },
      ],
    },
  ],
};

describe('ActionPanel interaction tests', () => {
  let sendAction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendAction = vi.fn().mockResolvedValue({ success: true });
  });

  // ── Test C1: Bug C — async choices never appear ─────────────────────────
  it('C1: ActionPanel re-renders destination choices after async fetch (Bug C reactivity)', async () => {
    // The deferred promise lets us control EXACTLY when destination choices land —
    // we mount the panel WHILE the destination pick is active but choices haven't
    // arrived yet. Then we resolve, which increments snapshotVersion. The reactive
    // currentChoices.value updates; the non-reactive getCurrentChoices() path (Bug C)
    // never triggers a re-render.
    let resolveDestination!: (result: { success: boolean; choices: Array<{ value: unknown; display: string }> }) => void;
    const destinationFetchPromise = new Promise<{ success: boolean; choices: Array<{ value: unknown; display: string }> }>(
      resolve => { resolveDestination = resolve; }
    );

    const fetchPickChoices = vi.fn((_action: string, selectionName: string) => {
      if (selectionName === 'piece') {
        return Promise.resolve({ success: true, validElements: [{ id: 77 }, { id: 78 }] });
      }
      // destination fetch is deferred — won't resolve until resolveDestination() is called
      return destinationFetchPromise;
    });

    const controller = useActionController({
      sendAction,
      availableActions: ref(['twoStepMove']),
      actionMetadata: ref({ twoStepMove: twoStepMoveAction }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
      fetchPickChoices,
    });

    // Start with piece pre-filled (simulates board click). start() sets up the
    // reactive state synchronously, then suspends at `await fetchChoicesForPick(destination)`.
    // We deliberately do NOT await start() so that the destination fetch hasn't resolved
    // yet when we mount the panel.
    void controller.start('twoStepMove', { args: { piece: 77 } });

    // Flush Vue's scheduler: watcher(currentPick) fires, sees destination already
    // marked as fetched (fetchedSelections set before the await in fetchAndAutoFill),
    // skips double-fetch. currentPick.value is now 'destination'.
    await nextTick();

    // Mount with destination as the active pick but NO choices in the snapshot yet.
    // filteredChoices evaluates: getCurrentChoices() reads snapshot → [] → "No options available".
    const wrapper = mount(ActionPanel, {
      global: {
        provide: { actionController: controller },
      },
      props: {
        availableActions: ['twoStepMove'],
        playerSeat: 1,
        isMyTurn: true,
      },
    });

    // Sanity: confirm we're actually at the destination choice pick
    expect(controller.currentPick.value?.name).toBe('destination');

    // Now resolve the deferred fetch — choices land, snapshotVersion++.
    // currentChoices.value (reactive) is marked dirty.
    // filteredChoices (non-reactive via getCurrentChoices() — Bug C) is NOT marked dirty.
    resolveDestination({
      success: true,
      choices: [
        { value: { pieceId: 77, toNotation: 'a5' }, display: 'a5' },
        { value: { pieceId: 77, toNotation: 'c5' }, display: 'c5' },
      ],
    });
    await nextTick(); // fetch resolves, snapshotVersion++
    await nextTick(); // Vue re-renders (if any computed is dirty)

    // Bug C (pre-fix): filteredChoices never re-runs → "No options available" remains.
    // Post-fix: filteredChoices reads currentChoices.value (reactive to snapshotVersion)
    //           → re-runs → choices appear.
    expect(wrapper.text()).not.toContain('No options available');
    expect(wrapper.text()).toContain('a5');
    expect(wrapper.text()).toContain('c5');
  });

  // ── Test C2: R-06b — filterBy choice pick whose choices are ALL board-anchored ──
  it('C2: filterBy destination with all notation-anchored choices does not claim "No options available"', async () => {
    // Reproduces the checkers multi-jump continuation case: the destination is a
    // `filterBy` choice pick, and EVERY choice is a board square carrying a notation
    // ref. splitAnchoredChoices routes all of them into anchoredChoices (the "Select
    // on board or choose here" list), leaving filteredChoices (primary) empty.
    //
    // Bug R-06b (pre-fix): the filterBy/dependsOn template's empty-state checks only
    // filteredChoices.length === 0 → renders "No options available" even though the
    // anchored buttons are right there. Post-fix: the empty-state also requires
    // anchoredChoices.length === 0, so the false message is gone and the anchored
    // choices render normally.
    let resolveDestination!: (result: { success: boolean; choices: Array<{ value: unknown; display: string; refs: Array<{ ref: { notation: string }; role: 'target' }> }> }) => void;
    const destinationFetchPromise = new Promise<{ success: boolean; choices: Array<{ value: unknown; display: string; refs: Array<{ ref: { notation: string }; role: 'target' }> }> }>(
      resolve => { resolveDestination = resolve; }
    );

    const fetchPickChoices = vi.fn((_action: string, selectionName: string) => {
      if (selectionName === 'piece') {
        return Promise.resolve({ success: true, validElements: [{ id: 77 }] });
      }
      return destinationFetchPromise;
    });

    const controller = useActionController({
      sendAction,
      availableActions: ref(['twoStepMove']),
      actionMetadata: ref({ twoStepMove: twoStepMoveAction }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
      fetchPickChoices,
    });

    void controller.start('twoStepMove', { args: { piece: 77 } });
    await nextTick();

    const wrapper = mount(ActionPanel, {
      global: { provide: { actionController: controller } },
      props: { availableActions: ['twoStepMove'], playerSeat: 1, isMyTurn: true },
    });

    expect(controller.currentPick.value?.name).toBe('destination');

    // Resolve with choices that ALL carry notation refs → all land in anchoredChoices.
    resolveDestination({
      success: true,
      choices: [
        { value: { pieceId: 77, toNotation: 'a5' }, display: 'a5', refs: [{ ref: { notation: 'a5' }, role: 'target' }] },
        { value: { pieceId: 77, toNotation: 'c5' }, display: 'c5', refs: [{ ref: { notation: 'c5' }, role: 'target' }] },
      ],
    });
    await nextTick();
    await nextTick();

    // Pre-fix: "No options available" rendered (filteredChoices empty, anchored ignored).
    // Post-fix: the false message is gone and the anchored choices are shown.
    expect(wrapper.text()).not.toContain('No options available');
    expect(wrapper.text()).toContain('a5');
    expect(wrapper.text()).toContain('c5');
  });

  // ── Test C3: clicking an anchored destination button submits that choice ──
  it('C3: clicking an anchored destination button resolves THAT choice and submits the action', async () => {
    // Regression for the dock destination-click bug: the anchored-choice button used
    // to call boardInteraction.triggerElementSelect on `refs.find(first notation)`,
    // which for a checkers destination is the SOURCE square — shared by every
    // destination from the same piece, so it could never disambiguate the target and
    // (with no boardInteraction, e.g. AutoUI without a custom board) was a silent
    // no-op: clicking did nothing. The fix routes the button through executeChoice,
    // identical to the primary choice buttons, so it resolves the exact choice and
    // submits the action.
    let resolveDestination!: (result: { success: boolean; choices: Array<{ value: unknown; display: string; refs: Array<{ ref: { notation: string }; role: 'target' }> }> }) => void;
    const destinationFetchPromise = new Promise<{ success: boolean; choices: Array<{ value: unknown; display: string; refs: Array<{ ref: { notation: string }; role: 'target' }> }> }>(
      resolve => { resolveDestination = resolve; }
    );

    const fetchPickChoices = vi.fn((_action: string, selectionName: string) => {
      if (selectionName === 'piece') {
        return Promise.resolve({ success: true, validElements: [{ id: 77 }] });
      }
      return destinationFetchPromise;
    });

    const controller = useActionController({
      sendAction,
      availableActions: ref(['twoStepMove']),
      actionMetadata: ref({ twoStepMove: twoStepMoveAction }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: true,
      fetchPickChoices,
    });

    // Piece pre-filled (board click); destination is the active pick. Deliberately
    // NO boardInteraction provided — proves the button no longer depends on it.
    void controller.start('twoStepMove', { args: { piece: 77 } });
    await nextTick();

    const wrapper = mount(ActionPanel, {
      global: { provide: { actionController: controller } },
      props: { availableActions: ['twoStepMove'], playerSeat: 1, isMyTurn: true },
    });

    expect(controller.currentPick.value?.name).toBe('destination');

    resolveDestination({
      success: true,
      choices: [
        { value: { pieceId: 77, toNotation: 'a5' }, display: 'a5', refs: [{ ref: { notation: 'f6' }, role: 'source' }, { ref: { notation: 'a5' }, role: 'target' }] },
        { value: { pieceId: 77, toNotation: 'c5' }, display: 'c5', refs: [{ ref: { notation: 'f6' }, role: 'source' }, { ref: { notation: 'c5' }, role: 'target' }] },
      ] as never,
    });
    await nextTick();
    await nextTick();

    // Click the anchored 'c5' destination button.
    const c5Button = wrapper.findAll('button.anchored-choice-btn').find(b => b.text() === 'c5');
    expect(c5Button, 'c5 anchored destination button should render').toBeTruthy();
    await c5Button!.trigger('click');
    await nextTick();
    await nextTick();

    // Pre-fix (no boardInteraction → triggerElementSelect no-op): sendAction never called.
    // Post-fix: the choice resolves, both selections are filled, the action auto-executes.
    expect(sendAction).toHaveBeenCalledTimes(1);
    const [, submittedArgs] = sendAction.mock.calls[0];
    expect(submittedArgs.piece).toBe(77);
    expect((submittedArgs.destination as { toNotation: string }).toNotation).toBe('c5');
  });

  // ── Test D1: D-02 — notation choice picks should NOT suppress footer ─────
  it('D1: allCurrentChoicesAnchored is false for choice picks (D-02 footer stays present)', async () => {
    // This action has choice picks with notation refs. Under the OLD allCurrentChoicesAnchored
    // implementation, notation refs make the computed return TRUE (footer suppressed).
    // Under D-02 the rule is: choice picks ALWAYS keep the footer (validElements is [] for
    // choice types), so allCurrentChoicesAnchored must be FALSE regardless of ref type.
    const controller = useActionController({
      sendAction,
      availableActions: ref(['notationChoice']),
      actionMetadata: ref({ notationChoice: notationChoiceAction }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
    });

    await controller.start('notationChoice');
    await nextTick();

    expect(controller.currentPick.value?.type).toBe('choice');

    // D-02 assertion: choice picks must NOT anchor the footer, regardless of notation refs.
    // RED before D-02 fix: the old notation-walking impl returns true here.
    // GREEN after D-02 fix: validElements.value.length === 0 → false.
    expect(controller.allCurrentChoicesAnchored.value).toBe(false);

    // Mount to verify the panel is renderable (smoke-level check: no throw)
    const wrapper = mount(ActionPanel, {
      global: {
        provide: { actionController: controller },
      },
      props: {
        availableActions: ['notationChoice'],
        playerSeat: 1,
        isMyTurn: true,
      },
    });

    expect(wrapper.exists()).toBe(true);
  });
});
