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

declare global { var __scenesBuilt: number | undefined; var __liveContexts: number; var __mostLiveContexts: number; var __framesDrawn: string[] }
globalThis.__liveContexts = 0;
globalThis.__mostLiveContexts = 0;
globalThis.__framesDrawn = [];
interface DrawnScene { children: { type: string; rotation: { x: number; y: number; z: number } }[] }

vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WebGLRenderer: class {
    constructor() {
      globalThis.__scenesBuilt = (globalThis.__scenesBuilt ?? 0) + 1;
      globalThis.__mostLiveContexts = Math.max(globalThis.__mostLiveContexts, ++globalThis.__liveContexts);
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
      globalThis.__framesDrawn.push(`data:${this.drawn}`);
    }
    dispose() {}
    forceContextLoss() { globalThis.__liveContexts--; }
  },
}));

// jsdom draws nothing on a canvas; every 2D call is a no-op returning another no-op context.
const noOp2d: object = new Proxy({}, { get: () => () => noOp2d });
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  (() => noOp2d) as unknown as HTMLCanvasElement['getContext'],
);

const { Die3D } = await import('./index.js');
const { MAX_LIVE_DIE_CONTEXTS } = await import('./die3d-state.js');
const { reduceMotionPreference } = await import('../../composables/reducedMotion.js');
// Die3D is an async component; load it here so the mount below renders it at once.
await (Die3D as unknown as { __asyncLoader: () => Promise<unknown> }).__asyncLoader();

const mounted: VueWrapper[] = [];
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});

/** Mount a die and let every queued render and snapshot finish. */
async function settle(wrapper?: VueWrapper) {
  // A few seconds covers every queued render, scene init and roll.
  await vi.advanceTimersByTimeAsync(5000);
  await flushPromises();
  return wrapper?.find('img.die-snapshot').attributes('src');
}

/** Die3D is an async component, so a host passes it props that can change. */
function mountDie(value: number, dieId: string | number) {
  const props = reactive({ sides: 6 as const, value, dieId, rollCount: 0 });
  const wrapper = mount(defineComponent({ setup: () => () => h(Die3D, props) }));
  mounted.push(wrapper);
  return { wrapper, props };
}

/** Mount enough dice that their first renders take every WebGL slot, so the next render waits. */
function holdQueue(prefix: string) {
  for (let i = 0; i < MAX_LIVE_DIE_CONTEXTS; i++) mountDie(3, `${prefix}-${i}`);
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

  /** A rolled-to-4 die whose roll waits in the queue behind another die's first render. */
  async function queuedRoll(dieId: string) {
    const { wrapper, props } = mountDie(2, dieId);
    await settle();
    holdQueue(`${dieId}-busy`); // the roll waits behind their first renders
    await flushPromises();
    const scenesBefore = globalThis.__scenesBuilt!;
    props.rollCount = 1;
    props.value = 4;
    await flushPromises();
    return { wrapper, props, scenesBuilt: () => globalThis.__scenesBuilt! - scenesBefore };
  }

  it('ends on a value set while its roll is still queued, in the one scene the roll builds', async () => {
    vi.useFakeTimers();
    const faceSix = await stillOf(6);
    const { wrapper, props, scenesBuilt } = await queuedRoll('queued');

    props.value = 6;
    await flushPromises();

    expect(await settle(wrapper)).toBe(faceSix);
    expect(scenesBuilt()).toBe(1);
  });

  it('ends on a value set while it spins, steering the roll rather than rebuilding it', async () => {
    vi.useFakeTimers();
    const faceOne = await stillOf(1);
    const { wrapper, props, scenesBuilt } = await queuedRoll('spinning');
    // The roll starts after the holders' snapshots and its own scene init (50ms each), and spins for 800ms.
    await vi.advanceTimersByTimeAsync(600);

    props.value = 1;
    await flushPromises();

    expect(await settle(wrapper)).toBe(faceOne);
    expect(scenesBuilt()).toBe(1);
  });

  it('queues one redraw for several value changes while the queue is busy', async () => {
    vi.useFakeTimers();
    const faceFour = await stillOf(4);
    const { wrapper, props } = mountDie(2, 'busy-redraw');
    await settle();
    holdQueue('busy-redraw-holder'); // both changes wait behind their first renders
    await flushPromises();
    const scenesBefore = globalThis.__scenesBuilt!;

    props.value = 3;
    await flushPromises();
    props.value = 4;
    await flushPromises();

    expect(await settle(wrapper)).toBe(faceFour);
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

describe('Die3D rolls while its first still is still being drawn (#897)', () => {
  it('ends on the rolled face, not the face its first still was taking', async () => {
    vi.useFakeTimers();
    const faceFive = await stillOf(5);
    const { wrapper, props } = mountDie(2, 'rolled-mid-first-draw');
    await flushPromises(); // its first scene is live, its still not yet taken
    await vi.advanceTimersByTimeAsync(10);

    props.value = 5;
    props.rollCount = 1;

    expect(await settle(wrapper)).toBe(faceFive);
  });
});

describe('Die3D rolls a die whose id is 0 (#897)', () => {
  it('builds a scene to animate the roll of die 0', async () => {
    vi.useFakeTimers();
    const { props } = mountDie(2, 0);
    await settle();
    const scenesBefore = globalThis.__scenesBuilt!;

    props.rollCount = 1; // rolled the same face, so only the roll can build a scene
    await settle();

    expect(globalThis.__scenesBuilt! - scenesBefore).toBe(1);
  });
});

describe('Die3D draws several dice at once, within the WebGL context limit (#897)', () => {
  it('builds as many scenes as the cap allows, then one more for each context released', async () => {
    vi.useFakeTimers();
    await settle();
    const scenesBefore = globalThis.__scenesBuilt!;
    globalThis.__mostLiveContexts = 0;
    const scenesBuilt = () => globalThis.__scenesBuilt! - scenesBefore;

    for (let i = 0; i < 20; i++) mountDie((i % 6) + 1, `many-${i}`);
    await flushPromises();
    expect(scenesBuilt()).toBe(MAX_LIVE_DIE_CONTEXTS);

    await vi.runOnlyPendingTimersAsync(); // each drawn die snapshots and releases its context
    expect(scenesBuilt()).toBe(2 * MAX_LIVE_DIE_CONTEXTS);

    await settle();
    expect(scenesBuilt()).toBe(20);
    expect(globalThis.__mostLiveContexts).toBe(MAX_LIVE_DIE_CONTEXTS);
  });
});

describe('Die3D with Reduce motion on (#1447)', () => {
  it('draws only the rolled face, with no spin', async () => {
    vi.useFakeTimers();
    const reduceMotion = reduceMotionPreference().use('reduceMotion');
    reduceMotion.value = true;
    try {
      const faceFive = await stillOf(5);
      const { wrapper, props } = mountDie(2, 'reduced-motion');
      await settle();
      globalThis.__framesDrawn = [];

      props.value = 5;
      props.rollCount = 1;

      expect(await settle(wrapper)).toBe(faceFive);
      expect(new Set(globalThis.__framesDrawn)).toEqual(new Set([faceFive]));
    } finally {
      reduceMotion.value = false;
    }
  });
});
