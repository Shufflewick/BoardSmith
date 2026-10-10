// @vitest-environment jsdom
/**
 * A game that never imported `boardsmith/ui/dice` has no die registered (#590):
 * the auto-UI draws only the die's label and, in dev, names the import that
 * fixes it. Its own file so the registry singleton is empty here; the
 * registered case is in DieRenderer.die-registry.test.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { getDiePreviewComponent } from '../../dice/die-preview-registry.js';
import DieRenderer from './DieRenderer.vue';

const element = { id: 7, className: 'Die', name: 'red-die', attributes: { $type: 'die', sides: 8, value: 5 } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DieRenderer without dice support', () => {
  it('draws only the label, and names the import that fixes it, when no dice module registered a die', () => {
    expect(getDiePreviewComponent()).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = mount(DieRenderer, { props: { element, depth: 0 } });

    expect(wrapper.find('.die-label').text()).toBe('red-die');
    expect(wrapper.find('.die-container').element.children).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("import 'boardsmith/ui/dice';"));
  });
});
