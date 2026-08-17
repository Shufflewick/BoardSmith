// @vitest-environment jsdom
/**
 * ZoomPreviewOverlay renders whatever `useZoomPreview` put in its state. It has
 * three mutually exclusive modes — a cloned element, die data, and card data —
 * and picking the wrong one shows the player the wrong thing entirely.
 * `useZoomPreview.test.ts` covers the state machine that feeds this.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ZoomPreviewOverlay from './ZoomPreviewOverlay.vue';
import type { PreviewState } from '../../composables/useZoomPreview.js';

const state = (overrides: Partial<PreviewState> = {}): PreviewState => ({
  visible: true,
  x: 100,
  y: 120,
  cardData: null,
  dieData: null,
  clonedElement: null,
  scale: 2.5,
  originalWidth: 60,
  originalHeight: 84,
  ...overrides,
});

/** Teleports to body, so assertions read the document rather than the wrapper. */
const overlay = (previewState: PreviewState, props: Record<string, unknown> = {}) =>
  mount(ZoomPreviewOverlay, {
    props: { previewState, ...props },
    attachTo: document.body,
  });

const rendered = () => document.querySelector('.zoom-preview-overlay');

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ZoomPreviewOverlay', () => {
  describe('visibility', () => {
    it('renders nothing while the preview is hidden', () => {
      overlay(state({ visible: false, cardData: { rank: 'A', suit: 'H' } }));
      expect(rendered()).toBeNull();
    });

    it('renders nothing when visible with nothing to show', () => {
      overlay(state({ visible: true }));
      expect(rendered()).toBeNull();
    });

    it('renders once there is card data to show', () => {
      overlay(state({ cardData: { rank: 'A', suit: 'H' } }));
      expect(rendered()).not.toBeNull();
    });

    it('appears and disappears as the state changes', async () => {
      const wrapper = overlay(state({ visible: false, cardData: { rank: 'A' } }));
      expect(rendered()).toBeNull();
      await wrapper.setProps({ previewState: state({ visible: true, cardData: { rank: 'A' } }) });
      expect(rendered()).not.toBeNull();
    });
  });

  describe('positioning', () => {
    it('places the overlay at the coordinates the composable computed', () => {
      overlay(state({ cardData: { rank: 'A' }, x: 240, y: 360 }));
      const style = (rendered() as HTMLElement).getAttribute('style')!;
      expect(style).toContain('240px');
      expect(style).toContain('360px');
    });
  });

  describe('card-data mode', () => {
    it('shows the rank and suit for a text card', () => {
      overlay(state({ cardData: { rank: 'K', suit: 'S' } }));
      expect(rendered()!.textContent).toContain('K');
    });

    it('renders a URL face image as an <img>', () => {
      overlay(state({ cardData: { rank: 'A', suit: 'H', faceImage: '/ace.png' } }));
      const img = rendered()!.querySelector('img.preview-image') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('/ace.png');
    });

    it('renders a sprite face as a background-image div, not an <img>', () => {
      overlay(state({
        cardData: {
          rank: 'A', suit: 'H',
          faceImage: { sprite: '/cards.png', x: 0, y: 0, width: 238, height: 333 },
        },
      }));
      expect(rendered()!.querySelector('.preview-sprite')).not.toBeNull();
      expect(rendered()!.querySelector('img.preview-image')).toBeNull();
    });

    it('shows a card back rather than the face when the back is requested', () => {
      overlay(state({ cardData: { rank: 'A', suit: 'H', showBack: true } }));
      expect(rendered()!.querySelector('.preview-card-back')).not.toBeNull();
    });

    it('colours the fallback with the supplied suit-colour function', () => {
      overlay(
        state({ cardData: { rank: 'A', suit: 'H' } }),
        { getSuitColor: () => 'rgb(1, 2, 3)' },
      );
      const fallback = rendered()!.querySelector('.preview-fallback') as HTMLElement;
      expect(fallback.getAttribute('style')).toContain('rgb(1, 2, 3)');
    });

    it('falls back to its own suit colouring when none is supplied', () => {
      overlay(state({ cardData: { rank: 'A', suit: 'H' } }));
      const fallback = rendered()!.querySelector('.preview-fallback') as HTMLElement;
      expect(fallback.getAttribute('style')).toBeTruthy();
    });
  });

  describe('clone mode', () => {
    it('renders the cloned element rather than card markup', () => {
      const clone = document.createElement('div');
      clone.textContent = 'Cloned card';
      overlay(state({ clonedElement: clone }));
      expect(rendered()!.querySelector('.zoom-preview-clone')).not.toBeNull();
      expect(rendered()!.querySelector('.zoom-preview-card')).toBeNull();
    });

    it('sizes the wrapper to the original dimensions times the zoom scale', () => {
      // The wrapper reserves the ENLARGED footprint; the clone inside is what
      // gets transform-scaled. Sizing it to the original would clip the preview.
      const clone = document.createElement('div');
      overlay(state({ clonedElement: clone, originalWidth: 70, originalHeight: 100, scale: 2.5 }));
      const wrapper = rendered()!.querySelector('.zoom-preview-clone-wrapper') as HTMLElement;
      expect(wrapper.getAttribute('style')).toContain('width: 175px');
      expect(wrapper.getAttribute('style')).toContain('height: 250px');
    });

    it('tracks a different scale', () => {
      const clone = document.createElement('div');
      overlay(state({ clonedElement: clone, originalWidth: 40, originalHeight: 60, scale: 3 }));
      const wrapper = rendered()!.querySelector('.zoom-preview-clone-wrapper') as HTMLElement;
      expect(wrapper.getAttribute('style')).toContain('width: 120px');
    });

    it('takes precedence over card data if both somehow appear', () => {
      const clone = document.createElement('div');
      overlay(state({ clonedElement: clone, cardData: { rank: 'A' } }));
      expect(rendered()!.querySelector('.zoom-preview-clone')).not.toBeNull();
      expect(rendered()!.querySelector('.zoom-preview-card')).toBeNull();
    });
  });

  describe('die-data mode', () => {
    it('renders no die when the bundle carries no die renderer', () => {
      // A game without dice never imports `boardsmith/ui/dice`, so the preview
      // registry is empty — the overlay must degrade rather than throw, which
      // is what keeps three.js out of dice-free bundles.
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => overlay(state({ dieData: { sides: 20, value: 17 } }))).not.toThrow();
      expect(rendered()?.querySelector('.zoom-preview-die') ?? null).toBeNull();
    });

    it('tells the author how to get dice support instead of failing silently', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      overlay(state({ dieData: { sides: 20, value: 17 } }));
      const message = warn.mock.calls.flat().join(' ');
      expect(message).toContain("boardsmith/ui/dice");
      expect(message).toContain('Die3D');
    });

    it('does not fall through to card markup for die data', () => {
      overlay(state({ dieData: { sides: 6, value: 3 } }));
      expect(rendered()?.querySelector('.zoom-preview-card') ?? null).toBeNull();
    });
  });
});
