// @vitest-environment jsdom
/**
 * `renderAsSeat`/`assertNoHiddenInfoLeak` against a board that calls
 * `useBoardInteraction()`.
 *
 * A real custom board is driven by BOTH sibling injection APIs: the action
 * controller arrives as a prop, but board interaction arrives through a
 * `provide` that `<GameShell>` makes. Mounting with props only meant such a
 * board threw inside `setup()` — before a single node rendered — so the
 * hidden-info assertion never reached its own logic and a game got a bare
 * injection Error instead of a leak verdict (#260).
 *
 * These tests prove the scan now runs against a board that uses board
 * interaction, in BOTH directions: a correct board passes, and a deliberately
 * leaky one still fails by name, so the detector has a proven failing case.
 *
 * Cross-layer boundary: testing -> ui (board interaction provider) -> a game's
 * own UI.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, nextTick, type PropType } from 'vue';
import {
  useBoardInteraction,
  createBoardInteraction,
  BOARD_INTERACTION_KEY,
  anchorAttrs,
} from '../ui/composables/useBoardInteraction.js';
import { collectCards, makeSecretHandGame, type ViewNode } from './dom-leak.test-helper.js';
import { renderAsSeat, assertNoHiddenInfoLeak } from './dom-leak.js';

// The fixture (two seats, one owner-only secret card each) lives in
// ./dom-leak.test-helper.ts, shared with dom-leak-custom-ui.test.ts.
const makeGame = () => makeSecretHandGame('interaction-leak');

/**
 * A correct board wired the way a real one is: it asks for board interaction
 * in `setup()` and highlights whatever the panel says is selectable, while
 * rendering only what the per-seat view carries.
 */
const InteractiveBoard = defineComponent({
  name: 'InteractiveBoard',
  props: {
    gameView: { type: Object as PropType<ViewNode | null>, default: null },
    playerSeat: { type: Number, default: 0 },
  },
  setup(props) {
    const interaction = useBoardInteraction();
    return () =>
      h(
        'div',
        { class: 'board' },
        collectCards(props.gameView ?? {}).map((card) =>
          h('div', {
            ...anchorAttrs({ id: card.id, name: card.name }, 'card'),
            'aria-label': card.name ?? 'a face-down card',
            'data-selectable': String(interaction.isSelectableElement({ id: card.id })),
          }),
        ),
      );
  },
});

/**
 * The same interaction-driven board, but reading the authoritative tree it was
 * handed separately — the shape of a real bug (a board reading from a store
 * that was never redacted).
 */
const LeakyInteractiveBoard = defineComponent({
  name: 'LeakyInteractiveBoard',
  props: {
    gameView: { type: Object as PropType<ViewNode | null>, default: null },
    playerSeat: { type: Number, default: 0 },
    fullTree: { type: Object as PropType<ViewNode | null>, default: null },
  },
  setup(props) {
    const interaction = useBoardInteraction();
    return () =>
      h(
        'div',
        { class: 'board' },
        collectCards(props.fullTree ?? props.gameView ?? {}).map((card) =>
          h('div', {
            ...anchorAttrs({ id: card.id, name: card.name }, 'card'),
            'aria-label': card.name ?? '',
            'data-selectable': String(interaction.isSelectableElement({ id: card.id })),
          }),
        ),
      );
  },
});

// ---------------------------------------------------------------------------

describe('renderAsSeat — board interaction provider', () => {
  it('mounts a board that calls useBoardInteraction() with no wiring from the caller', async () => {
    const tg = makeGame();

    const wrapper = await renderAsSeat(tg, 1, { component: InteractiveBoard });

    // A rendered node at all is the proof: before the default provide, setup()
    // threw and nothing reached the DOM.
    expect(wrapper.find('.board').exists()).toBe(true);
    expect(wrapper.html()).toContain('1-secret-card');
    wrapper.unmount();
  });

  it('lets a caller hand the board its own interaction under the exported key', async () => {
    const tg = makeGame();

    const ownCard = collectCards(tg.getPlayerView(1).state as ViewNode).find(
      (card) => card.name === '1-secret-card',
    );
    expect(ownCard?.id).toBeDefined();
    const cardId = ownCard!.id as number;

    const interaction = createBoardInteraction();
    const wrapper = await renderAsSeat(tg, 1, {
      component: InteractiveBoard,
      provide: { [BOARD_INTERACTION_KEY]: interaction },
    });
    // A table seat's controller owns the interaction's targets, as it does in
    // GameShell, so they are set after the mount rather than pre-loaded.
    interaction.setValidElements([{ id: cardId, ref: { id: cardId } }], () => {});
    await nextTick();

    // The board reads the caller's interaction, not a fresh empty one.
    expect(wrapper.find(`[data-bs-el-id="${cardId}"]`).attributes('data-selectable')).toBe('true');
    wrapper.unmount();
  });
});

describe('assertNoHiddenInfoLeak — board that calls useBoardInteraction()', () => {
  it('reaches a leak verdict instead of an injection error', async () => {
    const tg = makeGame();

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: InteractiveBoard }),
    ).resolves.not.toThrow();
  });

  it('still catches a deliberately leaky interaction-driven board by name', async () => {
    const tg = makeGame();

    await expect(
      assertNoHiddenInfoLeak(tg, 1, {
        component: LeakyInteractiveBoard,
        componentProps: { fullTree: tg.game.toJSON() },
      }),
    ).rejects.toThrow(/2-secret-card/);
  });
});
