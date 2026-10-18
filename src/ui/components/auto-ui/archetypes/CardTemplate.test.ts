// @vitest-environment jsdom
/**
 * CardTemplate puts in its hand zone exactly what the archetype selector counts
 * as a hand: an element the engine marks `$type: 'hand'` (#897).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import CardTemplate from './CardTemplate.vue';

const ElementRenderer = defineComponent({
  props: { element: { type: Object, required: true } },
  setup: (props) => () => h('span', { class: 'el' }, String(props.element.name)),
});

function zones(topLevelChildren: { id: number; name: string; className: string; attributes: Record<string, unknown> }[]) {
  const wrapper = mount(CardTemplate, {
    props: { topLevelChildren },
    global: { stubs: { ElementRenderer } },
  });
  const names = (zone: string) => wrapper.findAll(`.card-template__${zone} .el`).map((e) => e.text());
  return { hands: names('hands'), peripheral: names('peripheral') };
}

describe('CardTemplate hand zone (#897)', () => {
  it('treats only $type hand as a hand, whatever the class is called', () => {
    expect(zones([
      { id: 1, name: 'marked', className: 'PlayerCards', attributes: { $type: 'hand' } },
      { id: 2, name: 'named', className: 'Hand', attributes: {} },
    ])).toEqual({ hands: ['marked'], peripheral: ['named'] });
  });
});
