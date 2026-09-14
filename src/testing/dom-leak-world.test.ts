// @vitest-environment jsdom
/**
 * THE HIDDEN-INFORMATION DOM GATE, AIMED AT A PERSISTENT WORLD (#262).
 *
 * This is the surface the gate most needed to reach and could not. A table's
 * hidden information is a redaction inside one resident tree; a world's is
 * per-partition and per-seat on EVERY frame, and a world was not constructible
 * from a test at all -- so `assertNoHiddenInfoLeak` took a `TestGame` and there
 * was nothing to hand it.
 *
 * Both directions are proven here, because a detector with no failing case is
 * not a detector:
 *
 *   1. A world board that reaches past its `gameView` for a whole-world digest
 *      IS caught, by the name of the secret it painted.
 *   2. The same world, scanned through a board that renders only what its frame
 *      carries, passes.
 *
 * And the board is a real one: it calls `useBoardInteraction()` in `setup()`,
 * which is what `<GameShell>` provides and what `renderAsSeat` stands in for
 * (#260). A board that could not mount would make every verdict here vacuous.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, type PropType } from 'vue';

import { createTestWorld } from './test-world.js';
import { assertNoHiddenInfoLeak, renderAsSeat } from './dom-leak.js';
import { codewordOf, keeperOf, vaultBundle } from './test-world.test-helper.js';
import { useBoardInteraction } from '../ui/composables/useBoardInteraction.js';
import type { ElementJSON } from '../engine/index.js';

/** The seat every scan below is run as. Its own secret is legitimately on its
 *  own screen; seats 1 and 3 are what must never be. */
const WATCHER = 2;

/** Every node of a tree, depth first -- what a board walks to render. */
function nodesOf(node: ElementJSON | null | undefined): ElementJSON[] {
  if (!node) return [];
  return [node, ...(node.children ?? []).flatMap((child) => nodesOf(child))];
}

/**
 * ONE ROOM, AS A BOARD PAINTS IT. Both boards below render through this, so the
 * only difference between them is WHICH TREE they are handed -- which is the
 * shape a real leak takes.
 */
function room(node: ElementJSON) {
  const attributes = (node.attributes ?? {}) as { codeword?: string; keeper?: string };
  return h('div', {
    class: 'room',
    'data-element-id': String(node.id),
    'aria-label': attributes.codeword ?? node.name ?? 'a locked room',
    title: attributes.keeper ?? '',
  });
}

/** A correct world board: renders ONLY what its own frame carries. */
const VaultBoard = defineComponent({
  name: 'VaultBoard',
  props: {
    gameView: { type: Object as PropType<ElementJSON | null>, default: null },
    playerSeat: { type: Number, default: 0 },
    isMyTurn: { type: Boolean, default: false },
    availableActions: { type: Array as PropType<string[]>, default: () => [] },
  },
  setup(props) {
    // THE SHELL'S INJECTION, asked for the way a real board asks for it. It
    // throws when nothing provides it, which is what made this whole scan
    // unreachable for a custom board before #260.
    const interaction = useBoardInteraction();
    return () =>
      h('div', { class: 'board', 'data-open-action': interaction.currentAction ?? 'none' }, [
        ...nodesOf(props.gameView).map(room),
        h('ul', props.availableActions.map((name) => h('li', { 'data-action': name }, name))),
      ]);
  },
});

/**
 * A LEAKING WORLD BOARD.
 *
 * It renders its own frame correctly and then paints a "world digest" beside
 * it -- the shape of a real bug, and the one a world makes easy: a board handed
 * a whole-world summary by a store that was never pruned per seat.
 */
const LeakyVaultBoard = defineComponent({
  name: 'LeakyVaultBoard',
  props: {
    gameView: { type: Object as PropType<ElementJSON | null>, default: null },
    playerSeat: { type: Number, default: 0 },
    worldDigest: { type: Array as PropType<ElementJSON[]>, default: () => [] },
  },
  setup(props) {
    useBoardInteraction();
    return () =>
      h('div', { class: 'board' }, [
        ...nodesOf(props.gameView).map(room),
        // ONE SURFACE, ONE SECRET, so the assertion can name the string it
        // expects to be told about rather than whichever marker the scan
        // happened to reach first. The `keeper` a room also carries has its own
        // case below.
        h(
          'aside',
          { class: 'digest' },
          props.worldDigest.map((node) =>
            h('div', {
              'data-element-id': String(node.id),
              'aria-label': String((node.attributes as { codeword?: string }).codeword ?? ''),
            }),
          ),
        ),
      ]);
  },
});

describe('assertNoHiddenInfoLeak, aimed at a persistent world', () => {
  it('catches a world board that paints another seat’s vault, by the secret’s own name', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    await world.take(1, 'stash');

    await expect(
      assertNoHiddenInfoLeak(world, WATCHER, {
        component: LeakyVaultBoard,
        componentProps: { worldDigest: await world.unredactedElements() },
      }),
    ).rejects.toThrow(new RegExp(`Hidden-info leak: "${codewordOf(1)}"`));

    await world.close();
  });

  it('catches it through a second surface too, so one board’s habit is not the whole proof', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });

    // `keeper` rides a `title`, not an `aria-label`. A gate that only read one
    // attribute would pass a board that leaked through the other.
    const KeeperOnlyBoard = defineComponent({
      name: 'KeeperOnlyBoard',
      props: { gameView: { type: Object as PropType<ElementJSON | null>, default: null } },
      setup() {
        return () =>
          h('div', { class: 'board' }, [
            h('span', { title: keeperOf(3) }, 'the far vault'),
          ]);
      },
    });

    await expect(
      assertNoHiddenInfoLeak(world, WATCHER, { component: KeeperOnlyBoard }),
    ).rejects.toThrow(new RegExp(`Hidden-info leak: "${keeperOf(3)}"`));

    await world.close();
  });

  it('passes the same world when the board renders only what its frame carries', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    await world.take(1, 'stash');
    await world.take(WATCHER, 'stash');
    await world.take(3, 'post');

    await expect(
      assertNoHiddenInfoLeak(world, WATCHER, { component: VaultBoard }),
    ).resolves.toBeUndefined();

    await world.close();
  });

  it('mounts the real board with the shell’s board interaction and this seat’s own frame', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    await world.take(WATCHER, 'stash');

    const wrapper = await renderAsSeat(world, WATCHER, { component: VaultBoard });
    try {
      // The board rendered -- so `useBoardInteraction()` was provided, which is
      // the seam #260 added and the one every verdict above rests on.
      expect(wrapper.find('.board').exists()).toBe(true);
      // ITS OWN SECRET IS ON ITS OWN SCREEN, which is what makes a green scan
      // mean something: the frame is not empty.
      expect(wrapper.html()).toContain(codewordOf(WATCHER));
      expect(wrapper.html()).not.toContain(codewordOf(1));
      // And the scaffold props came from the world's own offers rather than
      // from a flow state a world does not have.
      expect(wrapper.props('availableActions')).toEqual(
        expect.arrayContaining(['stash', 'post']),
      );
      expect(wrapper.props('isMyTurn')).toBe(true);
    } finally {
      wrapper.unmount();
    }

    await world.close();
  });
});
