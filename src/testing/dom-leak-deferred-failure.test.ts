// @vitest-environment jsdom
/**
 * A FAILURE THIS GATE CANNOT REPORT IS WORSE THAN NO GATE (#267).
 *
 * `assertNoHiddenInfoLeak` mounts a board and hands back a clean result. Until
 * this file, anything the mount raised AFTER `mount()` returned -- an async
 * lifecycle hook, a watcher, a promise the board kicked off in `setup()` --
 * escaped to the process as an unhandled rejection. The assertion had already
 * resolved, so vitest attributed it to nothing and the test itself PASSED: a
 * suite calling the platform's own hidden-information gate was green while
 * checking nothing.
 *
 * ## THE TRAP THIS FILE IS ABOUT, AND HOW IT IS AVOIDED HERE
 *
 * A test that merely CALLS the gate against such a board goes green whichever
 * way the failure travels, which is precisely how the defect survived. So every
 * case below asserts on the two things that actually distinguish them:
 *
 *   1. `await expect(...).rejects` -- the failure reached the CALLER. If the
 *      throw ever becomes asynchronous again the promise resolves, `.rejects`
 *      has nothing to catch, and this file goes red.
 *   2. Nothing reached the process. `unhandledRejections()` records what
 *      escaped while the case ran, and every case asserts that it recorded
 *      nothing -- so a fix that raises to the caller AND still leaks a stray
 *      rejection is caught too.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, onMounted, type PropType } from 'vue';

import { createTestWorld, type TestWorld } from './test-world.js';
import { assertNoHiddenInfoLeak, renderAsSeat } from './dom-leak.js';
import { vaultBundle } from './test-world.test-helper.js';
import { makeSecretHandGame } from './dom-leak.test-helper.js';
import { rejectionMessage } from './rejection.test-helper.js';
import type { ElementJSON } from '../engine/index.js';

/** The sentence the board below fails with, once the assertion has resolved. */
const LATE_FAILURE = 'the board asked the store for a partition it was never sent';

/**
 * Record every rejection that escapes to the process while a case runs.
 *
 * Node's own `unhandledRejection` event is the only place a deferred failure is
 * observable at all -- which is the whole point: the bug is that this is where
 * the failure went instead of to the caller.
 */
function unhandledRejections(): { seen: unknown[]; stop: () => void } {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  return { seen, stop: () => process.off('unhandledRejection', onRejection) };
}

/** Let anything the mount deferred actually arrive, so a leak has a chance to
 *  be recorded before a case asserts that nothing leaked. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * A BOARD THAT FAILS AFTER IT HAS RENDERED.
 *
 * The shape of a real world board's bug: it paints its frame, then reaches for
 * something asynchronously and that read fails. The mount succeeds, the markup
 * is there, and the error arrives one microtask later.
 */
const LateFailingBoard = defineComponent({
  name: 'LateFailingBoard',
  props: {
    gameView: { type: Object as PropType<ElementJSON | null>, default: null },
    playerSeat: { type: Number, default: 0 },
  },
  setup() {
    onMounted(async () => {
      await Promise.resolve();
      throw new Error(LATE_FAILURE);
    });
    return () => h('div', { class: 'board' }, 'painted');
  },
});

describe('a board that fails after it rendered', () => {
  const escaped = unhandledRejections();
  afterEach(() => {
    escaped.seen.length = 0;
  });

  /** Both halves of the claim, for whichever call the case is about: the
   *  failure reached THIS caller, and none of it reached the process. */
  async function reachesTheCaller(call: (world: TestWorld) => Promise<unknown>): Promise<string> {
    const world = await createTestWorld({ definition: vaultBundle() });
    const failure = await rejectionMessage(call(world));

    await settle();
    expect(escaped.seen).toEqual([]);
    await world.close();
    return failure;
  }

  it('renderAsSeat raises it to the caller rather than to the process', async () => {
    const failure = await reachesTheCaller((world) =>
      renderAsSeat(world, 2, { component: LateFailingBoard }),
    );

    expect(failure).toContain(LATE_FAILURE);
  });

  it('assertNoHiddenInfoLeak fails the assertion rather than resolving clean', async () => {
    const failure = await reachesTheCaller((world) =>
      assertNoHiddenInfoLeak(world, 2, { component: LateFailingBoard }),
    );

    expect(failure).toContain(LATE_FAILURE);
  });

  it('says what happened and why it is being raised here', async () => {
    const failure = await reachesTheCaller((world) =>
      assertNoHiddenInfoLeak(world, 2, { component: LateFailingBoard }),
    );

    expect(failure).toContain('seat 2');
    expect(failure).toContain('after it rendered');
    expect(failure).toContain('unhandled rejection');
  });

  it('carries the same deferred failure on a table, not only on a world', async () => {
    const game = makeSecretHandGame('bs267-deferred-failure');

    await expect(
      assertNoHiddenInfoLeak(game, 1, { component: LateFailingBoard }),
    ).rejects.toThrow(new RegExp(LATE_FAILURE));

    await settle();
    expect(escaped.seen).toEqual([]);
  });

  it('leaves a board that renders cleanly alone', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    const Clean = defineComponent({
      name: 'CleanBoard',
      props: { gameView: { type: Object as PropType<ElementJSON | null>, default: null } },
      setup: () => () => h('div', { class: 'board' }, 'painted'),
    });

    const wrapper = await renderAsSeat(world, 2, { component: Clean });
    expect(wrapper.find('.board').exists()).toBe(true);
    wrapper.unmount();

    await settle();
    expect(escaped.seen).toEqual([]);
    await world.close();
  });
});

describe('a subject that holds nothing', () => {
  it('is refused rather than reported clean', async () => {
    /** Answers a frame and an empty world -- the shape a subject takes when the
     *  thing it was meant to read never got built. */
    const empty = {
      getPlayerView: () => ({ state: { id: 0, className: 'Nothing' } }),
      unredactedElements: () => [],
    };

    await expect(assertNoHiddenInfoLeak(empty, 1)).rejects.toThrow(/holds no elements/);
  });
});
