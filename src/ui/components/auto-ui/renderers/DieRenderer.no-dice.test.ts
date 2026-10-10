// @vitest-environment jsdom
/**
 * A game that never imported `boardsmith/ui/dice` has no die registered (#590):
 * the auto-UI draws only the die's label and, in dev, names the import that
 * fixes it, once per page load however many dice it draws. Its own file so the
 * registry singleton is empty and the warning has not fired yet; the registered
 * case is in DieRenderer.die-registry.test.ts.
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
  it('draws only the label, and names the import that fixes it, once, when no dice module registered a die', () => {
    expect(getDiePreviewComponent()).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = mount(DieRenderer, { props: { element, depth: 0 } });

    expect(wrapper.find('.die-label').text()).toBe('red-die');
    expect(wrapper.find('.die-container').element.children).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("import 'boardsmith/ui/dice';"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('If the auto-UI draws your dice in play'));

    // A second die and a remount must not repeat it: every game gets a dev auto-UI,
    // so a game with many dice and its own UI would otherwise flood the console.
    mount(DieRenderer, { props: { element: { ...element, id: 8, name: 'blue-die' }, depth: 0 } });
    wrapper.unmount();
    mount(DieRenderer, { props: { element, depth: 0 } });

    const diceWarnings = warn.mock.calls.filter(([message]) => String(message).includes('boardsmith/ui/dice'));
    expect(diceWarnings).toHaveLength(1);
  });
});
