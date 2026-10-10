// @vitest-environment jsdom
/**
 * The auto-UI draws a die with whatever `boardsmith/ui/dice` registered (#590).
 *
 * DieRenderer is on every game's graph, so it must not import Die3D (which
 * needs the optional three.js peer). It reads the die registry instead, so a
 * game that imported the dice entry gets the 3D die. The registry is a module
 * singleton and Vitest gives each file its own module graph, so the case where
 * nothing registered a die lives in DieRenderer.no-dice.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { setDiePreviewComponent } from '../../dice/die-preview-registry.js';
import DieRenderer from './DieRenderer.vue';

const element = { id: 7, className: 'Die', name: 'red-die', attributes: { $type: 'die', sides: 8, value: 5 } };

describe('DieRenderer and the die registry', () => {
  it('draws the registered die with the element\'s face', () => {
    const RegisteredDie = defineComponent({
      props: { sides: Number, value: Number },
      setup: (props) => () => h('div', { class: 'registered-die' }, `d${props.sides}:${props.value}`),
    });
    setDiePreviewComponent(RegisteredDie);

    const wrapper = mount(DieRenderer, { props: { element, depth: 0 } });

    expect(wrapper.find('.registered-die').text()).toBe('d8:5');
  });
});
