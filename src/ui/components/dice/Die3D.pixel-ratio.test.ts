// @vitest-environment jsdom
/**
 * A die's renderer caps the pixel ratio at 2 (#1612): a 3x phone screen would
 * otherwise draw 2.25 times the pixels of 2x for no visible gain.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const pixelRatios: number[] = [];
vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    setSize() {}
    setPixelRatio(ratio: number) { pixelRatios.push(ratio); }
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

afterEach(() => {
  pixelRatios.length = 0;
  vi.unstubAllGlobals();
});

describe('Die3D pixel ratio (#1612)', () => {
  it.each([[3, 2], [1.5, 1.5]])('a screen at %sx renders at %sx', async (screen, rendered) => {
    vi.stubGlobal('devicePixelRatio', screen);
    const wrapper = mount(Die3D, { props: { sides: 6, value: 3 } });
    await flushPromises();
    expect(pixelRatios).toEqual([rendered]);
    wrapper.unmount();
  });
});
