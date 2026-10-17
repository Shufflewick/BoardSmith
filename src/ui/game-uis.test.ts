/**
 * `defaultUI()` takes the board component itself, never a loader (#1011).
 *
 * A plain function is a valid Vue component type (a functional component), so
 * `defaultUI(() => import('./Board.vue'))` used to compile and render nothing.
 * The `@ts-expect-error` below is checked by `boardsmith typecheck`; the runtime
 * assertion covers untyped JS and casts.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { defaultUI } from './game-uis.js';

const Board = defineComponent({ name: 'Board', render: () => h('div') });

describe('defaultUI', () => {
  it('takes a component', () => {
    expect(defaultUI(Board).component).toBe(Board);
  });

  it('refuses a lazy loader at compile time and at run time', () => {
    expect(() =>
      // @ts-expect-error -- a loader is not a board; import the component statically.
      defaultUI(() => Promise.resolve({ default: Board })),
    ).toThrow(/defaultUI\(\) takes the board component itself, not a function/);
  });
});
