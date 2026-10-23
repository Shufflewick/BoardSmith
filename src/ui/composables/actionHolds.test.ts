// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { ACTION_HOLDS_KEY, createActionHolds, useActionHolds, withHolds } from './actionHolds.js';

const WAIT = 'Placing packs waits until the battle playback ends.';

describe('action holds (#1450)', () => {
  it('holds what each registration returns now, and drops it when released', () => {
    const holds = createActionHolds();
    const replaying = ref(true);
    const release = holds.register(() => (replaying.value ? { placePack: WAIT } : null));
    holds.register(() => ({ scout: 'Scouting waits too.' }));
    expect(holds.held.value).toEqual({ placePack: WAIT, scout: 'Scouting waits too.' });
    replaying.value = false;
    expect(holds.held.value).toEqual({ scout: 'Scouting waits too.' });
    release();
    replaying.value = true;
    expect(holds.held.value).toEqual({ scout: 'Scouting waits too.' });
  });

  it("adds the holds to the rules' disabled actions, and the rules' own reason wins", () => {
    const holds = createActionHolds();
    const rules = ref<Record<string, string> | undefined>({ pass: 'You must place first.' });
    const disabled = withHolds(computed(() => rules.value), holds);
    expect(disabled.value).toEqual({ pass: 'You must place first.' });
    holds.register(() => ({ placePack: WAIT, pass: 'Passing waits too.' }));
    expect(disabled.value).toEqual({ placePack: WAIT, pass: 'You must place first.' });
    rules.value = undefined;
    expect(disabled.value).toEqual({ placePack: WAIT, pass: 'Passing waits too.' });
  });

  it('keeps the same disabled actions while a hold reads state that leaves it unchanged', () => {
    const holds = createActionHolds();
    const frame = ref(0);
    const disabled = withHolds(computed(() => ({ pass: 'You must place first.' })), holds);
    holds.register(() => (frame.value >= 0 ? { placePack: WAIT } : null));
    const held = holds.held.value;
    const before = disabled.value;
    frame.value++;
    expect(holds.held.value).toBe(held);
    expect(disabled.value).toBe(before);
  });

  it('is placed by a board mounted under the shell, and lifted when it unmounts', () => {
    const holds = createActionHolds();
    const Board = defineComponent({
      setup() {
        useActionHolds(() => ({ placePack: WAIT }));
        return () => h('div');
      },
    });
    const wrapper = mount(Board, { global: { provide: { [ACTION_HOLDS_KEY]: holds } } });
    expect(holds.held.value).toEqual({ placePack: WAIT });
    wrapper.unmount();
    expect(holds.held.value).toEqual({});
  });

  it('names the fix when called outside a shell', () => {
    const Board = defineComponent({
      setup() {
        useActionHolds(() => ({}));
        return () => h('div');
      },
    });
    expect(() => mount(Board)).toThrow(/useActionHolds\(\) was called outside a board/);
  });
});
