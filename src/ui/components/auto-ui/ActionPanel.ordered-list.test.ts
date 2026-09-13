// @vitest-environment jsdom
/**
 * THE PANEL'S OWN WAY TO BUILD AN ORDERED, REPEATABLE LIST (#249).
 *
 * The Action Panel is on at all times and is the keyboard/screen-reader path, so
 * a selection shape the panel cannot draw is a selection shape no player can
 * reach (#167). A checkbox set cannot draw one: a second press of a checked box
 * means "not that one after all", and a list needs it to mean "again".
 *
 * So the list pick draws differently -- a row of ADD buttons over an ordered,
 * numbered list of the entries so far, each removable -- and every gesture goes
 * through the shared controller draft, which is what keeps a custom board and
 * this panel showing one selection rather than two.
 */

import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mountPanel, stubActionController } from './action-panel-controller.test-helper.js';

const mockToast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../composables/useToast', () => ({
  useToast: () => mockToast,
}));

/** The repair pick, with whatever entries the player has built so far. */
function mountRepair(
  values: unknown[],
  bounds: { min?: number; max?: number } = { min: 1, max: 3 },
  overrides: Record<string, unknown> = {},
) {
  const controller = stubActionController({
    currentAction: ref('repair'),
    currentPick: ref({
      name: 'buildings',
      type: 'choice',
      prompt: 'Repair, in order',
      orderedList: bounds,
    }),
    currentChoices: ref([
      { value: 'university', display: 'University' },
      { value: 'shipyard', display: 'Shipyard' },
    ]),
    multiSelectDraft: ref({ selectionName: 'buildings', values }),
    ...overrides,
  });
  const wrapper = mountPanel(controller, {
    availableActions: ['repair'],
    playerSeat: 1,
    isMyTurn: true,
  });
  return { wrapper, controller };
}

describe('ActionPanel ordered lists (#249)', () => {
  it('draws an ADD button per choice rather than a checkbox', () => {
    const { wrapper } = mountRepair([]);

    const adds = wrapper.findAll('.ordered-list-add');
    expect(adds.map((b) => b.text())).toEqual(['University', 'Shipyard']);
    expect(wrapper.findAll('.multi-select-choice')).toHaveLength(0);
    wrapper.unmount();
  });

  it('appends on every press, so the same choice can be added TWICE', async () => {
    const appendListEntry = vi.fn(async () => {});
    const { wrapper } = mountRepair([], { min: 1, max: 3 }, { appendListEntry });

    const university = wrapper.findAll('.ordered-list-add')[0]!;
    await university.trigger('click');
    await university.trigger('click');

    expect(appendListEntry.mock.calls).toEqual([
      ['buildings', 'university'],
      ['buildings', 'university'],
    ]);
    wrapper.unmount();
  });

  it('shows the entries IN ORDER, numbered, repeats and all', () => {
    const { wrapper } = mountRepair(['shipyard', 'university', 'shipyard']);

    const entries = wrapper.findAll('.ordered-list-entry');
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.text())).toEqual([
      expect.stringContaining('1'),
      expect.stringContaining('2'),
      expect.stringContaining('3'),
    ]);
    expect(entries[0]!.text()).toContain('Shipyard');
    expect(entries[1]!.text()).toContain('University');
    expect(entries[2]!.text()).toContain('Shipyard');
    wrapper.unmount();
  });

  it('removes the entry the player pointed at, BY INDEX, not by value', async () => {
    const removeListEntry = vi.fn();
    const { wrapper } = mountRepair(
      ['university', 'shipyard', 'university'],
      { min: 1, max: 3 },
      { removeListEntry },
    );

    await wrapper.findAll('.ordered-list-remove')[2]!.trigger('click');

    expect(removeListEntry).toHaveBeenCalledWith('buildings', 2);
    wrapper.unmount();
  });

  it('counts ENTRIES against the cap and explains a full list rather than going quiet', () => {
    const { wrapper } = mountRepair(['university', 'university', 'university']);

    expect(wrapper.text()).toContain('3/3');
    const add = wrapper.findAll('.ordered-list-add')[0]!;
    expect(add.attributes('aria-disabled')).toBe('true');
    expect(add.attributes('data-bs-disabled-reason')).toBeTruthy();
    wrapper.unmount();
  });

  it('keeps a choice with its OWN disabled reason unpressable, with that reason', () => {
    const { wrapper } = mountRepair([], { min: 1, max: 3 }, {
      currentChoices: ref([
        { value: 'university', display: 'University' },
        { value: 'shipyard', display: 'Shipyard', disabled: 'Already at full condition.' },
      ]),
    });

    const shipyard = wrapper.findAll('.ordered-list-add')[1]!;
    expect(shipyard.attributes('aria-disabled')).toBe('true');
    expect(shipyard.attributes('data-bs-disabled-reason')).toBe('Already at full condition.');
    wrapper.unmount();
  });

  it('holds Done until the minimum number of ENTRIES is reached, and says how many short', async () => {
    const confirmMultiSelect = vi.fn(async () => {});
    const { wrapper } = mountRepair([], { min: 2, max: 3 }, { confirmMultiSelect });

    const done = wrapper.find('.done-button');
    expect(done.attributes('aria-disabled')).toBe('true');
    // The wording counts ENTRIES, which is the whole difference from a set: two
    // repeats of one building satisfy "at least 2".
    expect(done.attributes('data-bs-disabled-reason')).toBe(
      'Add 2 more to continue (at least 2 required).',
    );
    wrapper.unmount();
  });

  it('submits the list through the shared confirm once the minimum is met', async () => {
    const confirmMultiSelect = vi.fn(async () => {});
    const { wrapper } = mountRepair(
      ['university', 'university'],
      { min: 2, max: 3 },
      { confirmMultiSelect },
    );

    const done = wrapper.find('.done-button');
    expect(done.attributes('aria-disabled')).toBeUndefined();
    await done.trigger('click');

    expect(confirmMultiSelect).toHaveBeenCalled();
    wrapper.unmount();
  });
});
