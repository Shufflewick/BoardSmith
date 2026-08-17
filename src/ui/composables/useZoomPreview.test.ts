// @vitest-environment jsdom
/**
 * Alt+hover (and long-press) card zoom. GameShell mounts this for every game,
 * so the gating matters: nothing must appear unless Alt is held, and the
 * preview must stay inside the viewport wherever the cursor is.
 *
 * Mounted through a host component because the composable registers its DOM
 * listeners in onMounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useZoomPreview, type ZoomPreviewReturn } from './useZoomPreview.js';

function withPreview(options: Parameters<typeof useZoomPreview>[0] = {}) {
  let result!: ZoomPreviewReturn;
  const Host = defineComponent({
    setup() {
      result = useZoomPreview(options);
      return () => h('div');
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  return { preview: result, wrapper };
}

const mouseAt = (x: number, y: number) =>
  ({ clientX: x, clientY: y }) as MouseEvent;

/** Alt is global state shared by every instance; press/release it explicitly. */
const pressAlt = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }));
const releaseAlt = () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

afterEach(() => {
  releaseAlt();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useZoomPreview', () => {
  describe('initial state', () => {
    it('starts hidden with nothing to show', () => {
      const { preview, wrapper } = withPreview();
      expect(preview.previewState.visible).toBe(false);
      expect(preview.previewState.cardData).toBeNull();
      expect(preview.previewState.dieData).toBeNull();
      expect(preview.previewState.clonedElement).toBeNull();
      wrapper.unmount();
    });

    it('defaults to a 2.5x zoom', () => {
      const { preview, wrapper } = withPreview();
      expect(preview.previewState.scale).toBe(2.5);
      wrapper.unmount();
    });

    it('honours a custom scale', () => {
      const { preview, wrapper } = withPreview({ scale: 4 });
      expect(preview.previewState.scale).toBe(4);
      wrapper.unmount();
    });
  });

  describe('Alt key tracking', () => {
    it('follows the Alt key down and up', async () => {
      const { preview, wrapper } = withPreview();
      expect(preview.isAltPressed.value).toBe(false);
      pressAlt();
      await nextTick();
      expect(preview.isAltPressed.value).toBe(true);
      releaseAlt();
      await nextTick();
      expect(preview.isAltPressed.value).toBe(false);
      wrapper.unmount();
    });

    it('drops the Alt state when the window loses focus', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      window.dispatchEvent(new Event('blur'));
      await nextTick();
      expect(preview.isAltPressed.value).toBe(false);
      wrapper.unmount();
    });

    it('ignores other keys', async () => {
      const { preview, wrapper } = withPreview();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      await nextTick();
      expect(preview.isAltPressed.value).toBe(false);
      wrapper.unmount();
    });
  });

  describe('showPreview', () => {
    it('does nothing unless Alt is held', () => {
      const { preview, wrapper } = withPreview();
      preview.showPreview(mouseAt(100, 100), { rank: 'A', suit: 'H' });
      expect(preview.previewState.visible).toBe(false);
      wrapper.unmount();
    });

    it('shows the card data while Alt is held', () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      preview.showPreview(mouseAt(100, 100), { rank: 'A', suit: 'H' });
      expect(preview.previewState.visible).toBe(true);
      expect(preview.previewState.cardData).toEqual({ rank: 'A', suit: 'H' });
      wrapper.unmount();
    });

    it('positions the preview when it opens', () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      preview.showPreview(mouseAt(100, 120), { rank: 'A' });
      expect(preview.previewState.x).toBe(120);
      expect(preview.previewState.y).toBe(140);
      wrapper.unmount();
    });

    it('replaces any die preview that was showing', () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      preview.previewState.dieData = { sides: 6, value: 3 };
      preview.showPreview(mouseAt(10, 10), { rank: 'A' });
      expect(preview.previewState.dieData).toBeNull();
      wrapper.unmount();
    });
  });

  describe('hidePreview', () => {
    it('clears everything it was showing', () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      preview.showPreview(mouseAt(10, 10), { rank: 'A' });
      preview.hidePreview();
      expect(preview.previewState.visible).toBe(false);
      expect(preview.previewState.cardData).toBeNull();
      expect(preview.previewState.dieData).toBeNull();
      expect(preview.previewState.clonedElement).toBeNull();
      wrapper.unmount();
    });

    it('is safe to call when nothing is showing', () => {
      const { preview, wrapper } = withPreview();
      expect(() => preview.hidePreview()).not.toThrow();
      wrapper.unmount();
    });
  });

  describe('updatePosition', () => {
    const open = () => {
      const mounted = withPreview();
      pressAlt();
      mounted.preview.showPreview(mouseAt(0, 0), { rank: 'A' });
      return mounted;
    };

    it('offsets the preview down-right of the cursor by default', () => {
      const { preview, wrapper } = open();
      preview.updatePosition(mouseAt(300, 300));
      expect(preview.previewState.x).toBe(320);
      expect(preview.previewState.y).toBe(320);
      wrapper.unmount();
    });

    it('flips to the left of the cursor near the right edge', () => {
      const { preview, wrapper } = open();
      preview.updatePosition(mouseAt(980, 300));
      expect(preview.previewState.x).toBeLessThan(980);
      wrapper.unmount();
    });

    it('flips above the cursor near the bottom edge', () => {
      const { preview, wrapper } = open();
      preview.updatePosition(mouseAt(300, 790));
      expect(preview.previewState.y).toBeLessThan(790);
      wrapper.unmount();
    });

    it('never lets the preview run off the top-left corner', () => {
      const { preview, wrapper } = open();
      preview.updatePosition(mouseAt(0, 0));
      expect(preview.previewState.x).toBeGreaterThanOrEqual(10);
      expect(preview.previewState.y).toBeGreaterThanOrEqual(10);
      wrapper.unmount();
    });

    it('stays on screen from every corner of the viewport', () => {
      const { preview, wrapper } = open();
      for (const [x, y] of [[0, 0], [999, 0], [0, 799], [999, 799], [500, 400]]) {
        preview.updatePosition(mouseAt(x, y));
        expect(preview.previewState.x).toBeGreaterThanOrEqual(10);
        expect(preview.previewState.y).toBeGreaterThanOrEqual(10);
        expect(preview.previewState.x).toBeLessThan(1000);
        expect(preview.previewState.y).toBeLessThan(800);
      }
      wrapper.unmount();
    });

    it('does nothing while the preview is hidden', () => {
      const { preview, wrapper } = withPreview();
      preview.updatePosition(mouseAt(300, 300));
      expect(preview.previewState.x).toBe(0);
      expect(preview.previewState.y).toBe(0);
      wrapper.unmount();
    });
  });

  describe('hover detection', () => {
    const card = (setup: (el: HTMLElement) => void = () => {}) => {
      const element = document.createElement('div');
      element.classList.add('card');
      setup(element);
      document.body.appendChild(element);
      return element;
    };

    const hover = (element: HTMLElement) => {
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    };

    it('shows nothing when hovering a card without Alt', async () => {
      const { preview, wrapper } = withPreview();
      hover(card());
      await nextTick();
      expect(preview.previewState.visible).toBe(false);
      wrapper.unmount();
    });

    it('clones a hovered card when Alt is held', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      hover(card((el) => { el.textContent = 'Ace of Hearts'; }));
      await nextTick();
      expect(preview.previewState.visible).toBe(true);
      expect(preview.previewState.clonedElement?.textContent).toBe('Ace of Hearts');
      wrapper.unmount();
    });

    it('prefers explicit card data over cloning', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      hover(card((el) => el.setAttribute('data-card-preview', '{"rank":"K","suit":"S"}')));
      await nextTick();
      expect(preview.previewState.cardData).toEqual({ rank: 'K', suit: 'S' });
      expect(preview.previewState.clonedElement).toBeNull();
      wrapper.unmount();
    });

    it('falls back to a label when the card data is not valid JSON', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      hover(card((el) => el.setAttribute('data-card-preview', 'Just a label')));
      await nextTick();
      expect(preview.previewState.cardData).toEqual({ label: 'Just a label' });
      wrapper.unmount();
    });

    it('shows die data rather than cloning a WebGL canvas', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      hover(card((el) => el.setAttribute('data-die-preview', '{"sides":20,"value":17}')));
      await nextTick();
      expect(preview.previewState.dieData).toEqual({ sides: 20, value: 17 });
      expect(preview.previewState.clonedElement).toBeNull();
      wrapper.unmount();
    });

    it('recognises a card by data-card-id as well as by class', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      const element = document.createElement('div');
      element.setAttribute('data-card-id', '7');
      document.body.appendChild(element);
      hover(element);
      await nextTick();
      expect(preview.previewState.visible).toBe(true);
      wrapper.unmount();
    });

    it('ignores a hover over something that is not a card', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      const element = document.createElement('div');
      document.body.appendChild(element);
      hover(element);
      await nextTick();
      expect(preview.previewState.visible).toBe(false);
      wrapper.unmount();
    });

    it('finds the card when the hover lands on a child of it', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      const child = document.createElement('span');
      card((el) => el.appendChild(child));
      hover(child);
      await nextTick();
      expect(preview.previewState.visible).toBe(true);
      wrapper.unmount();
    });

    it('hides the preview when the cursor leaves the card', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      const element = card();
      hover(element);
      await nextTick();
      element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      await nextTick();
      expect(preview.previewState.visible).toBe(false);
      wrapper.unmount();
    });

    it('strips interactive state from the clone', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      hover(card((el) => el.classList.add('selectable', 'selected')));
      await nextTick();
      const clone = preview.previewState.clonedElement!;
      expect(clone.classList.contains('selectable')).toBe(false);
      expect(clone.classList.contains('selected')).toBe(false);
      expect(clone.style.pointerEvents).toBe('none');
      wrapper.unmount();
    });
  });

  describe('teardown', () => {
    it('stops responding to hovers after unmount', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      await nextTick();
      wrapper.unmount();

      const element = document.createElement('div');
      element.classList.add('card');
      document.body.appendChild(element);
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await nextTick();
      expect(preview.previewState.visible).toBe(false);
    });

    it('forgets a held Alt key, so the next mount does not start zoomed', async () => {
      // isAltPressed is module-global and survives unmount. With the listeners
      // detached nothing can observe the keyup, so a stale `true` would make
      // the next UI (a UI switch, a new game, an HMR reload) zoom the first
      // card the cursor touches.
      const first = withPreview();
      pressAlt();
      await nextTick();
      expect(first.preview.isAltPressed.value).toBe(true);
      first.wrapper.unmount();

      const second = withPreview();
      expect(second.preview.isAltPressed.value).toBe(false);

      const element = document.createElement('div');
      element.classList.add('card');
      document.body.appendChild(element);
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await nextTick();
      expect(second.preview.previewState.visible).toBe(false);
      second.wrapper.unmount();
    });

    it('hides any open preview on unmount', async () => {
      const { preview, wrapper } = withPreview();
      pressAlt();
      preview.showPreview(mouseAt(10, 10), { rank: 'A' });
      expect(preview.previewState.visible).toBe(true);
      wrapper.unmount();
      expect(preview.previewState.visible).toBe(false);
    });
  });

  describe('custom container', () => {
    it('listens on the container it was given', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const { preview, wrapper } = withPreview({ containerRef: ref(container) });
      pressAlt();
      await nextTick();

      const inside = document.createElement('div');
      inside.classList.add('card');
      container.appendChild(inside);
      inside.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await nextTick();
      expect(preview.previewState.visible).toBe(true);
      wrapper.unmount();
    });
  });
});
