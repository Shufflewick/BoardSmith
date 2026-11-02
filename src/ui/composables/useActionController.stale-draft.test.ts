// @vitest-environment jsdom
/**
 * #1575: A MULTISELECT DRAFT NEVER HOLDS AN ENTRY THE PICK NO LONGER OFFERS.
 *
 * The draft names each held entry by its value and which copy of that value it
 * is (#1574). The pick's list can change while the draft is open: the panel
 * draws the action's static choices until the fetched ones land. A held copy
 * the new list no longer offers, or offers disabled, would be counted and
 * submitted but drawn nowhere, so it is taken out and the player is told.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, provide, ref } from 'vue';
import ActionPanel from '../components/auto-ui/ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from './useGameContext.js';
import { settle } from './table-wiring.test-helper.js';
import { useActionController, type EnrichedActionMetadata } from './useActionController.js';
import type { PickChoicesResult } from './useActionControllerTypes.js';
import { createMockSendAction } from './useActionController.test-helper.js';

const basic = (disabled?: string) => ({ value: 'basic', display: 'Basic', ...(disabled && { disabled }) });

const METADATA: Record<string, EnrichedActionMetadata> = {
  allocate: {
    name: 'allocate',
    prompt: 'Allocate',
    selections: [{
      name: 'allocations',
      type: 'choice',
      prompt: 'Allocate hits',
      multiSelect: { min: 1, max: 3 },
      choices: [basic(), basic(), basic(), { value: 'm1', display: 'M1' }],
    }],
  },
};

/** A controller whose choice fetch for the open pick lands when the test says. */
function controllerWithHeldFetch() {
  let land!: (result: PickChoicesResult) => void;
  const controller = useActionController({
    sendAction: createMockSendAction(),
    availableActions: ref(['allocate']),
    actionMetadata: ref(METADATA),
    isMyTurn: ref(true),
    autoExecute: false,
    autoFill: false,
    fetchPickChoices: () => new Promise((resolve) => { land = resolve; }),
  });
  // The server answers a multiSelect pick with its bounds as well as its list.
  return { controller, land: (choices: PickChoicesResult['choices']) => land({ success: true, choices, multiSelect: { min: 1, max: 3 } }) };
}

describe('a multiSelect draft whose list changes mid-pick (#1575)', () => {
  it('drops a held copy the new list no longer offers, and says so', async () => {
    const { controller, land } = controllerWithHeldFetch();
    const started = controller.start('allocate');
    await controller.toggleMultiSelect('allocations', 'basic', 2);
    await controller.toggleMultiSelect('allocations', 'm1');

    land([basic(), basic(), { value: 'm1', display: 'M1' }]);
    await started;

    expect(controller.multiSelectDraft.value).toEqual({ selectionName: 'allocations', values: ['m1'], copies: [0] });
    expect(controller.lastError.value).toBe('Basic is no longer on offer, so it was taken out of your selection.');
  });

  it('drops a held copy the new list offers disabled, and says so', async () => {
    const { controller, land } = controllerWithHeldFetch();
    const started = controller.start('allocate');
    await controller.toggleMultiSelect('allocations', 'basic', 0);
    await controller.toggleMultiSelect('allocations', 'basic', 2);

    // Enabled copies count first, so copy 2 is now the disabled entry.
    land([basic(), basic('spent'), basic()]);
    await started;

    expect(controller.multiSelectDraft.value).toEqual({ selectionName: 'allocations', values: ['basic'], copies: [0] });
    expect(controller.lastError.value).toBe('Basic can no longer be chosen (spent), so it was taken out of your selection.');
  });

  it('names a value the new list dropped altogether by its label', async () => {
    const { controller, land } = controllerWithHeldFetch();
    const started = controller.start('allocate');
    await controller.toggleMultiSelect('allocations', 'basic', 0);

    land([{ value: 'm1', display: 'M1' }]);
    await started;

    expect(controller.multiSelectDraft.value).toEqual({ selectionName: 'allocations', values: [], copies: [] });
    expect(controller.lastError.value).toBe('Basic is no longer on offer, so it was taken out of your selection.');
  });

  it('keeps every held copy the new list still offers, and says nothing', async () => {
    const { controller, land } = controllerWithHeldFetch();
    const started = controller.start('allocate');
    await controller.toggleMultiSelect('allocations', 'basic', 1);

    land([basic(), basic()]);
    await started;

    expect(controller.multiSelectDraft.value).toEqual({ selectionName: 'allocations', values: ['basic'], copies: [1] });
    expect(controller.lastError.value).toBeNull();
  });

  it('leaves the Action Panel ticking and counting what the draft holds', async () => {
    const { controller, land } = controllerWithHeldFetch();
    const Host = defineComponent({
      setup() {
        provide(GAME_CONTEXT_KEYS.actionController, controller);
        return () => h(ActionPanel, { availableActions: ['allocate'], actionMetadata: METADATA, isMyTurn: true });
      },
    });
    const panel = mount(Host);
    const started = controller.start('allocate');
    await settle();
    await panel.findAll('.multi-select-choice input')[2]!.trigger('click');
    await settle();
    expect(panel.find('.multi-select-count').text()).toBe('Selected: 1/3');

    land([basic(), basic(), { value: 'm1', display: 'M1' }]);
    await started;
    await settle();

    const ticked = panel.findAll('.multi-select-choice input').map((box) => (box.element as HTMLInputElement).checked);
    expect(ticked).toEqual([false, false, false]);
    expect(panel.find('.multi-select-count').text()).toBe('Selected: 0/3');
    panel.unmount();
  });

  it('names the copy of every entry a custom UI writes into the draft (#1575 review F1)', async () => {
    const { controller } = controllerWithHeldFetch();
    void controller.start('allocate');
    // @ts-expect-error A draft without copies would be counted but ticked nowhere, so the type refuses it.
    const unnumbered: typeof controller.multiSelectDraft.value = { selectionName: 'allocations', values: ['basic'] };
    expect(unnumbered).not.toBeNull();

    controller.multiSelectDraft.value = { selectionName: 'allocations', values: ['basic'], copies: [1] };
    expect(controller.isMultiSelectSelected('allocations', 'basic', 1)).toBe(true);
    expect(controller.lastError.value).toBeNull();
  });
});
