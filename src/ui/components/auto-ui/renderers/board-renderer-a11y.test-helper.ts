/**
 * Mounting a board renderer with a real `BoardInteraction`, for the two a11y
 * suites that assert the same keyboard contract on it (#238).
 *
 * `GridBoardRenderer.a11y.test.ts` and `HexBoardRenderer.a11y.test.ts` had
 * byte-identical copies of the element shape and the mounting wrapper,
 * differing only in which component they named. They are the pair that has to
 * stay in parity -- HexBoardRenderer.a11y's own #190 comment says the roving
 * cursor wiring is shared, so a bug found against one is reachable in the other
 * -- and two copies of the mount is how the two drift apart.
 *
 * `CardRenderer.a11y.test.ts` and `HandRenderer.a11y.test.ts` deliberately do
 * NOT use this. Their wrappers look similar but are not the same thing: the
 * hand's mount supplies a `playerSeat` provide and takes extra ones, and the
 * card's takes an arbitrary props bag and does not attach to the document.
 * Folding three different mounts into one parameterised mount would make each
 * call site harder to read to remove a similarity that is incidental.
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { Component } from 'vue';
import {
  createBoardInteraction,
  provideBoardInteraction,
} from '../../../composables/useBoardInteraction.js';
import type { BoardInteraction } from '../../../composables/useBoardInteraction.js';

/** The element shape both board renderers read, mirrored from them. */
export interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
}

/**
 * Mount `component` inside a wrapper that provides board interaction.
 *
 * `tryUseBoardInteraction()` injects a non-exported Symbol, so
 * `provideBoardInteraction()` in a parent's `setup()` is the only way to wire
 * it. The mount attaches to the document because these suites assert on
 * `document.activeElement`, which is meaningless detached.
 */
export function mountBoardRenderer(
  component: Component,
  element: GameElement,
  interaction: BoardInteraction = createBoardInteraction(),
) {
  const Wrapper = defineComponent({
    setup() {
      provideBoardInteraction(interaction);
    },
    render() {
      return h(component, { element, depth: 0 });
    },
  });
  return {
    wrapper: mount(Wrapper, { attachTo: document.body }),
    interaction,
  };
}
