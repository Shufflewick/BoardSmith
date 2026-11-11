// @vitest-environment jsdom
/**
 * THE ONE READING OF THE LAYOUT SIZE BOTH SHELLS USE (#1610).
 *
 * The form factor follows `BREAKPOINTS` (compact below 640px, medium below
 * 1024px, wide from there), the orientation follows the viewport's shape, and
 * both update when the viewport is resized or rotated.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { effectScope } from 'vue';
import { useLayoutSize } from './useLayoutSize.js';
import { fakeViewport } from './fake-viewport.test-helper.js';

let viewport: ReturnType<typeof fakeViewport> | null = null;
afterEach(() => viewport?.restore());

function measure(size: { width: number; height: number }) {
  viewport = fakeViewport(size);
  const scope = effectScope();
  const layout = scope.run(() => useLayoutSize())!;
  return { layout, scope };
}

describe('useLayoutSize (#1610)', () => {
  it('reads the size tier at each breakpoint edge', () => {
    for (const [width, formFactor] of [[390, 'compact'], [639, 'compact'], [640, 'medium'], [1023, 'medium'], [1024, 'wide'], [1440, 'wide']] as const) {
      const { layout, scope } = measure({ width, height: 900 });
      expect(layout.formFactor.value, `at ${width}px`).toBe(formFactor);
      scope.stop();
      viewport!.restore();
    }
  });

  it('reads the orientation from the viewport shape', () => {
    expect(measure({ width: 390, height: 844 }).layout.orientation.value).toBe('portrait');
    viewport!.restore();
    expect(measure({ width: 844, height: 390 }).layout.orientation.value).toBe('landscape');
  });

  it('updates on resize and rotation, and stops listening when its scope ends', () => {
    const { layout, scope } = measure({ width: 390, height: 844 });
    viewport!.resize({ width: 844, height: 390 });
    expect(layout.formFactor.value).toBe('medium');
    expect(layout.orientation.value).toBe('landscape');
    viewport!.resize({ width: 1440, height: 900 });
    expect(layout.formFactor.value).toBe('wide');
    scope.stop();
    expect(viewport!.listening()).toBe(0);
  });
});
