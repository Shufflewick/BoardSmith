// @vitest-environment jsdom
/**
 * A die zoom-preview in a bundle with no dice support tells the author, in dev,
 * which import fixes it, once per page load however many previews are requested
 * (#597). Its own file so the warning has not fired yet when this test starts;
 * ZoomPreviewOverlay.test.ts mounts die previews too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ZoomPreviewOverlay from './ZoomPreviewOverlay.vue';
import { getDiePreviewComponent } from '../dice/die-preview-registry.js';
import type { PreviewState } from '../../composables/useZoomPreview.js';

const state = (dieData: PreviewState['dieData']): PreviewState => ({
  visible: true,
  x: 100,
  y: 120,
  cardData: null,
  dieData,
  clonedElement: null,
  scale: 2.5,
  originalWidth: 60,
  originalHeight: 84,
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ZoomPreviewOverlay without dice support', () => {
  it('names the import that fixes it, once, however many die previews are requested', async () => {
    expect(getDiePreviewComponent()).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = mount(ZoomPreviewOverlay, {
      props: { previewState: state({ sides: 20, value: 17 }) },
      attachTo: document.body,
    });
    const message = warn.mock.calls.flat().join(' ');
    expect(message).toContain('boardsmith/ui/dice');
    expect(message).toContain('Die3D');

    // A second preview and a remount must not repeat it: an author hovering over
    // dice would otherwise flood the console.
    await wrapper.setProps({ previewState: state({ sides: 6, value: 3 }) });
    wrapper.unmount();
    mount(ZoomPreviewOverlay, {
      props: { previewState: state({ sides: 8, value: 5 }) },
      attachTo: document.body,
    });

    const diceWarnings = warn.mock.calls.filter(([m]) => String(m).includes('boardsmith/ui/dice'));
    expect(diceWarnings).toHaveLength(1);
  });
});
