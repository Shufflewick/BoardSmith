// @vitest-environment jsdom
/**
 * Dice support can arrive after the overlay mounted: a game that imports
 * `boardsmith/ui/dice` only inside a lazily loaded dev UI registers Die3D once
 * that UI loads, long after GameShell mounted the overlay. The overlay must find
 * the renderer when a die preview is requested, not when it was set up, and must
 * not warn that dice support is missing (#599). Its own file because the die
 * registry is module state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import ZoomPreviewOverlay from './ZoomPreviewOverlay.vue';
import { getDiePreviewComponent, setDiePreviewComponent } from '../dice/die-preview-registry.js';
import type { PreviewState } from '../../composables/useZoomPreview.js';

const state = (dieData: PreviewState['dieData']): PreviewState => ({
  visible: dieData !== null,
  x: 100,
  y: 120,
  cardData: null,
  dieData,
  clonedElement: null,
  scale: 2.5,
  originalWidth: 60,
  originalHeight: 84,
});

const StubDie = defineComponent({
  props: { sides: Number, value: Number },
  setup: (props) => () => h('div', { class: 'stub-die' }, `d${props.sides}=${props.value}`),
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ZoomPreviewOverlay with dice registered after mount', () => {
  it('draws the die and does not warn', async () => {
    expect(getDiePreviewComponent()).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = mount(ZoomPreviewOverlay, {
      props: { previewState: state(null) },
      attachTo: document.body,
    });
    setDiePreviewComponent(StubDie);
    await wrapper.setProps({ previewState: state({ sides: 20, value: 17 }) });

    expect(document.querySelector('.zoom-preview-die .stub-die')?.textContent).toBe('d20=17');
    expect(warn.mock.calls.filter(([m]) => String(m).includes('boardsmith/ui/dice'))).toHaveLength(0);
  });
});
