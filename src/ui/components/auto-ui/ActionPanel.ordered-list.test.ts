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
import { nextTick, ref } from 'vue';
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
  mountOptions: { attachTo?: HTMLElement } = {},
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
  const wrapper = mountPanel(
    controller,
    { availableActions: ['repair'], playerSeat: 1, isMyTurn: true },
    mountOptions,
  );
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

  /**
   * A LIVE list whose remove actually removes, mounted INTO the document (#252).
   *
   * The focus assertions below need both halves to be real: a `removeListEntry`
   * that only records the call leaves the entry on screen, and a detached mount
   * has no `document.activeElement` for `focus()` to reach.
   */
  function mountLiveRepair(values: unknown[]) {
    const draft = ref({ selectionName: 'buildings', values: [...values] });
    const { wrapper } = mountRepair(
      values,
      { min: 1, max: 4 },
      {
        multiSelectDraft: draft,
        removeListEntry: (_name: string, index: number) => {
          draft.value = {
            selectionName: 'buildings',
            values: draft.value.values.filter((_, at) => at !== index),
          };
        },
      },
      { attachTo: document.body },
    );
    return { wrapper, draft };
  }

  /**
   * REACHABILITY OF THE TWO CONTROLS THE LIST IS BUILT WITH (#252).
   *
   * The Action Panel is the keyboard and screen-reader surface, and it is the
   * ONLY one: a custom board owns no commands of its own, so a control that
   * cannot be named or returned to here is a control those players do not have
   * (#167, #250). A list is worse than a single pick in this respect, because
   * building one is repeated gestures over a set of controls that keeps
   * changing underneath the player.
   */
  describe('reachability (#252)', () => {
    it('names the gesture on each Add button, not just the choice', () => {
      // The visible label is the choice, because a row of buttons reading
      // "Add University" twice over is unreadable. The ACCESSIBLE name has to
      // carry the verb anyway: announced on its own, "University" says nothing
      // about what pressing it does, and in a list it does not even mean
      // "choose" -- it means "again".
      const { wrapper } = mountRepair([]);

      const adds = wrapper.findAll('.ordered-list-add');
      expect(adds.map((b) => b.attributes('aria-label'))).toEqual([
        'Add University',
        'Add Shipyard',
      ]);
      wrapper.unmount();
    });

    it('names the entries list, so what it is a list OF is spoken', () => {
      const { wrapper } = mountRepair(['university', 'shipyard']);

      const list = wrapper.find('.ordered-list-entries');
      expect(list.attributes('aria-label')).toBe('Entries added so far, in order');
      wrapper.unmount();
    });

    it('announces the count, because pressing Add changes nothing else spoken', () => {
      // Focus stays on the Add button, whose name and state do not change; the
      // new entry is drawn somewhere the keyboard is not. Without a live region
      // a screen-reader player presses Add and is told nothing at all.
      const { wrapper } = mountRepair(['university']);

      const count = wrapper.find('.ordered-list-count');
      expect(count.attributes('aria-live')).toBe('polite');
      expect(count.text()).toBe('Added: 1/3');
      wrapper.unmount();
    });

    it('keeps the keyboard in the list when an entry is removed', async () => {
      // #228's stranding repair cannot see this: it is keyed on the STEP, and a
      // removal is the same action, the same pick and the same count of
      // accumulated answers. So the pressed button unmounted, focus fell to the
      // body, and removing a second entry meant tabbing in from the top of the
      // document again.
      const { wrapper } = mountLiveRepair(['university', 'shipyard', 'university']);

      const middle = wrapper.findAll('.ordered-list-remove')[1]!;
      (middle.element as HTMLElement).focus();
      await middle.trigger('click');
      await nextTick();

      const remaining = wrapper.findAll('.ordered-list-remove');
      expect(remaining).toHaveLength(2);
      // The entry that slid into the removed one's place is the nearest thing
      // to "where I was", and it is the one they are most likely to remove next.
      expect(document.activeElement).toBe(remaining[1]!.element);
      expect(remaining[1]!.attributes('aria-label')).toBe('Remove entry 2, University');
      wrapper.unmount();
    });

    it('falls back to the Add row when the last entry is removed', async () => {
      const { wrapper } = mountLiveRepair(['university']);

      const only = wrapper.find('.ordered-list-remove');
      (only.element as HTMLElement).focus();
      await only.trigger('click');
      await nextTick();

      expect(wrapper.findAll('.ordered-list-entry')).toHaveLength(0);
      expect(document.activeElement).toBe(wrapper.find('.ordered-list-add').element);
      wrapper.unmount();
    });

    it('leaves a player who tabbed elsewhere where they put themselves', async () => {
      // Narrow on purpose, exactly as #228's repair is: focus is placed only
      // when it was actually stranded. Yanking the keyboard back into the panel
      // from somewhere a player chose to be is its own bug.
      const { wrapper } = mountLiveRepair(['university', 'shipyard']);
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      elsewhere.focus();

      await wrapper.findAll('.ordered-list-remove')[0]!.trigger('click');
      await nextTick();

      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
      wrapper.unmount();
    });
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
