// @vitest-environment jsdom
/**
 * A Die3D clears its own scene-init timer on unmount (#749). The timer runs 50ms
 * after the scene is built to start the roll or take the snapshot, and must not
 * reach a die that is gone. jsdom has no WebGL, so only the renderer is replaced.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    setSize() {}
    setPixelRatio() {}
    setClearColor() {}
    render() {}
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

const SCENE_INIT_MS = 50;

afterEach(() => {
  vi.useRealTimers();
});

describe('Die3D unmount (#749)', () => {
  it('clears the pending scene-init timer', async () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const wrapper = mount(Die3D, { props: { sides: 6, value: 3 } });
    await flushPromises();
    const sceneInits = setSpy.mock.calls.flatMap((call, i) =>
      call[1] === SCENE_INIT_MS ? [setSpy.mock.results[i]!.value] : [],
    );
    expect(sceneInits).toHaveLength(1);

    wrapper.unmount();

    expect(clearSpy.mock.calls.map(([id]) => id)).toContain(sceneInits[0]);
  });
});
