// @vitest-environment jsdom
/**
 * The auto-UI draws a die with whatever `boardsmith/ui/dice` registered (#590).
 *
 * DieRenderer is on every game's graph, so it must not import Die3D (which
 * needs the optional three.js peer). It reads the die registry instead: a game
 * that imported the dice entry gets the 3D die, and one that did not is told in
 * dev what to import. Fresh module graphs per test, because the registry is a
 * module singleton (see die-preview-registry.fresh.test.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

const element = { id: 7, className: 'Die', name: 'red-die', attributes: { $type: 'die', sides: 8, value: 5 } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DieRenderer and the die registry', () => {
  it('draws the registered die with the element\'s face', async () => {
    vi.resetModules();
    const registry = await import('../../dice/die-preview-registry.js');
    const RegisteredDie = defineComponent({
      props: { sides: Number, value: Number },
      setup: (props) => () => h('div', { class: 'registered-die' }, `d${props.sides}:${props.value}`),
    });
    registry.setDiePreviewComponent(RegisteredDie);
    const { default: DieRenderer } = await import('./DieRenderer.vue');

    const wrapper = mount(DieRenderer, { props: { element, depth: 0 } });

    expect(wrapper.find('.registered-die').text()).toBe('d8:5');
  });

  it('draws only the label, and names the import that fixes it, when no dice module registered a die', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: DieRenderer } = await import('./DieRenderer.vue');

    const wrapper = mount(DieRenderer, { props: { element, depth: 0 } });

    expect(wrapper.find('.die-label').text()).toBe('red-die');
    expect(wrapper.find('.die-container').element.children).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("import 'boardsmith/ui/dice';"));
  });
});
