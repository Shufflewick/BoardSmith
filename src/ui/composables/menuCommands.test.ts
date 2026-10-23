// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createMenuCommands, MENU_COMMANDS_KEY, useMenuCommands } from './menuCommands.js';

describe('menu commands (#1448)', () => {
  it('lists what each registration returns now, and drops it when released', () => {
    const menu = createMenuCommands();
    const enabled = ref(false);
    const run = () => {};
    const release = menu.register(() => [{ label: 'Watch the last battle', enabled: enabled.value, run }]);
    menu.register(() => [{ label: 'Show the map', run }]);
    expect(menu.commands.value.map((c) => [c.label, c.enabled])).toEqual([['Watch the last battle', false], ['Show the map', undefined]]);
    enabled.value = true;
    expect(menu.commands.value[0].enabled).toBe(true);
    release();
    expect(menu.commands.value.map((c) => c.label)).toEqual(['Show the map']);
  });

  it('is registered by a board mounted under the shell', () => {
    const menu = createMenuCommands();
    const Board = defineComponent({
      setup() {
        useMenuCommands(() => [{ label: 'Watch the last battle', run: () => {} }]);
        return () => h('div');
      },
    });
    const wrapper = mount(Board, { global: { provide: { [MENU_COMMANDS_KEY]: menu } } });
    expect(menu.commands.value.map((c) => c.label)).toEqual(['Watch the last battle']);
    wrapper.unmount();
    expect(menu.commands.value).toEqual([]);
  });

  it('names the fix when called outside a shell', () => {
    const Board = defineComponent({
      setup() {
        useMenuCommands(() => []);
        return () => h('div');
      },
    });
    expect(() => mount(Board)).toThrow(/useMenuCommands\(\) was called outside a board/);
  });
});
