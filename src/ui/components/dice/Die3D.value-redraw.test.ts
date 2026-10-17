// @vitest-environment jsdom
/**
 * The still image of a die shows the face its value names, however the value
 * got there (#892). Only a roll used to redraw it, so setValue(), a flip and
 * undo left the old face on screen. jsdom has no WebGL, so the renderer is
 * replaced by one whose snapshot names the rotation of the die it last drew.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';

declare global { var __scenesBuilt: number | undefined }
interface DrawnScene { children: { type: string; rotation: { x: number; y: number; z: number } }[] }

vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WebGLRenderer: class {
    constructor() {
      globalThis.__scenesBuilt = (globalThis.__scenesBuilt ?? 0) + 1;
      this.domElement.toDataURL = () => `data:${this.drawn}`;
    }
    domElement = document.createElement('canvas');
    private drawn = '';
    setSize() {}
    setPixelRatio() {}
    setClearColor() {}
    render(scene: DrawnScene) {
      const { x, y, z } = scene.children.find((c) => c.type === 'Mesh')!.rotation;
      this.drawn = [x, y, z].map((n) => n.toFixed(4)).join(',');
    }
    dispose() {}
    forceContextLoss() {}
  },
}));

// jsdom draws nothing on a canvas; every 2D call is a no-op returning another no-op context.
const noOp2d: object = new Proxy({}, { get: () => () => noOp2d });
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  (() => noOp2d) as unknown as HTMLCanvasElement['getContext'],
);

const { Die3D } = await import('./index.js');
// Die3D is an async component; load it here so the mount below renders it at once.
await (Die3D as unknown as { __asyncLoader: () => Promise<unknown> }).__asyncLoader();

const mounted: VueWrapper[] = [];
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});

/** Mount a die and let every queued render and snapshot finish. */
async function settle(wrapper?: VueWrapper) {
  // The render queue spaces renders 300ms apart; a few seconds drains it.
  await vi.advanceTimersByTimeAsync(5000);
  await flushPromises();
  return wrapper?.find('img.die-snapshot').attributes('src');
}

/** Die3D is an async component, so a host passes it props that can change. */
function mountDie(value: number, dieId: string) {
  const props = reactive({ sides: 6 as const, value, dieId, rollCount: 0 });
  const wrapper = mount(defineComponent({ setup: () => () => h(Die3D, props) }));
  mounted.push(wrapper);
  return { wrapper, props };
}

async function stillOf(value: number) {
  return settle(mountDie(value, `still-${value}`).wrapper);
}

describe('Die3D redraws its still image when its value changes (#892)', () => {
  it('shows the new face after setValue without a roll', async () => {
    vi.useFakeTimers();
    const faceFive = await stillOf(5);
    const { wrapper, props } = mountDie(2, 'flipped');
    const faceTwo = await settle(wrapper);
    expect(faceTwo).not.toBe(faceFive);

    props.value = 5;

    expect(await settle(wrapper)).toBe(faceFive);
    expect(wrapper.find('[role=img]').attributes('aria-label')).toBe('d6 showing 5');
  });

  it('ends on the latest value when it changes again while a roll is queued or spinning', async () => {
    vi.useFakeTimers();
    const faceSix = await stillOf(6);
    const { wrapper, props } = mountDie(2, 'undone');
    await settle();
    mountDie(3, 'busy'); // its first render holds the queue, so the roll waits behind it
    await flushPromises();
    const scenesBefore = globalThis.__scenesBuilt!;

    props.rollCount = 1;
    props.value = 4;
    await flushPromises();
    props.value = 6; // undo lands before the queued roll has started
    await vi.advanceTimersByTimeAsync(400);
    props.value = 6;
    props.value = 1;
    props.value = 6; // and again while it spins

    expect(await settle(wrapper)).toBe(faceSix);
    // One scene for the roll: the later values steer it rather than rebuild it mid-spin.
    expect(globalThis.__scenesBuilt! - scenesBefore).toBe(1);
  });

  it('dims a never-rolled die and says it has no face yet', async () => {
    vi.useFakeTimers();
    const { wrapper, props } = mountDie(0, 'unrolled');
    await settle();
    const die = wrapper.find('[role=img]');
    expect(die.attributes('aria-label')).toBe('d6 not rolled yet');
    expect(die.classes()).toContain('die-unrolled');

    props.value = 3;
    await settle();
    expect(die.classes()).not.toContain('die-unrolled');
  });
});
