// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, nextTick } from 'vue';
import type { AnnotationTarget } from '../../engine/tutorial/types.js';
import { useOverlayTracking } from './useOverlayTracking.js';

const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(function () {
    const o = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    observers.push(o);
    return o;
  }),
);

function mountTracked(targets: AnnotationTarget[]) {
  const region = document.createElement('div');
  region.className = 'boardregion';
  region.innerHTML = '<div data-bs-el-id="1"></div>';
  document.body.appendChild(region);
  const measure = vi.fn();
  const content = ref<readonly AnnotationTarget[]>(targets);
  const Host = defineComponent({
    setup() {
      const root = ref<HTMLElement | null>(null);
      useOverlayTracking({ root, content, targetOf: (t) => t, measure });
      // Like the overlays: the root exists only while there is content.
      return () => (content.value.length > 0 ? h('div', { ref: root }) : null);
    },
  });
  const wrapper = mount(Host, { attachTo: region });
  return { wrapper, region, measure, content };
}

describe('useOverlayTracking', () => {
  afterEach(() => {
    observers.length = 0;
    document.body.innerHTML = '';
  });

  it('observes the board region and each found target', async () => {
    const { wrapper, region } = mountTracked([{ kind: 'element', ref: { id: 1 } }]);
    await nextTick();
    const last = observers[observers.length - 1];
    expect(last.observe).toHaveBeenCalledWith(region);
    expect(last.observe).toHaveBeenCalledWith(region.querySelector('[data-bs-el-id="1"]'));
    wrapper.unmount();
  });

  it('observes its own root, which is fixed to the screen and so resizes with the window, board or no board (#1300)', async () => {
    const { wrapper, region } = mountTracked([{ kind: 'element', ref: { id: 1 } }]);
    await nextTick();
    expect(observers[observers.length - 1].observe).toHaveBeenCalledWith(wrapper.element);
    wrapper.unmount();
    region.remove();

    const boardless = mountTracked([]);
    boardless.region.classList.remove('boardregion');
    const addListener = vi.spyOn(boardless.region, 'addEventListener');
    boardless.content.value = [{ kind: 'element', ref: { id: 1 } }];
    await nextTick();
    await nextTick();
    const observer = observers[observers.length - 1];
    expect(observer.observe).toHaveBeenCalledWith(boardless.wrapper.element);
    expect(addListener).not.toHaveBeenCalledWith('scroll', expect.anything(), expect.anything());

    // A resize of the root, which the window's resize is, re-measures with no board.
    boardless.measure.mockClear();
    const ResizeObserverMock = vi.mocked(globalThis.ResizeObserver);
    const onResize = ResizeObserverMock.mock.calls[ResizeObserverMock.mock.calls.length - 1]![0];
    onResize([], observer as unknown as ResizeObserver);
    await nextTick();
    expect(boardless.measure).toHaveBeenCalledWith(null);
    boardless.wrapper.unmount();
  });

  it('re-measures when the board region scrolls', async () => {
    const { wrapper, region, measure } = mountTracked([{ kind: 'element', ref: { id: 1 } }]);
    await nextTick();
    measure.mockClear();
    region.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(measure).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('on unmount disconnects every observer and removes the scroll listener from the region it was added to (#749)', async () => {
    const { wrapper, region, measure } = mountTracked([{ kind: 'element', ref: { id: 1 } }]);
    await nextTick();
    // The region stops matching `.boardregion` before unmount, so a re-query cannot find it.
    region.classList.remove('boardregion');
    wrapper.unmount();
    for (const o of observers) expect(o.disconnect).toHaveBeenCalled();

    measure.mockClear();
    region.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(measure).not.toHaveBeenCalled();
  });

  it('when the content clears, disconnects the observer and removes the scroll listener', async () => {
    const { wrapper, region, measure, content } = mountTracked([{ kind: 'element', ref: { id: 1 } }]);
    await nextTick();
    content.value = [];
    await nextTick();
    await nextTick();
    for (const o of observers) expect(o.disconnect).toHaveBeenCalled();

    measure.mockClear();
    region.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(measure).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
