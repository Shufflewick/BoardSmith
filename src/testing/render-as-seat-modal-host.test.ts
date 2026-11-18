// @vitest-environment jsdom
/**
 * A BOARD'S MODAL HAS ITS HOST UNDER `renderAsSeat` (#1717): the shell gives a
 * board a `#bs-game-modal` host to Teleport a blocking modal into, so
 * `renderAsSeat` gives each seat's board one too, the modal it opens lands in
 * that seat's own host, and the hidden-information scan reads it.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, Teleport, type PropType } from 'vue';

import { assertNoHiddenInfoLeak, preloadSeatRenderer, renderAsSeat } from './dom-leak.js';
import { collectCards, makeSecretHandGame, type ViewNode } from './dom-leak.test-helper.js';

await preloadSeatRenderer();

const open = ref<Record<number, boolean>>({});
const line = ref('first');

/** A board whose modal opens only when the test says so, as a pop-up does. */
const PopUpBoard = defineComponent({
  name: 'PopUpBoard',
  props: { playerSeat: { type: Number, required: true } },
  setup(props) {
    return () =>
      h('div', { class: 'board' }, [
        open.value[props.playerSeat]
          ? h(Teleport, { to: '#bs-game-modal' }, [h('p', { class: 'modal', 'data-seat': String(props.playerSeat) }, line.value)])
          : null,
      ]);
  },
});

/** A board that shows every card it is handed in a modal open from the start. */
const ModalLeakBoard = defineComponent({
  name: 'ModalLeakBoard',
  props: { fullTree: { type: Object as PropType<ViewNode | null>, default: null } },
  setup(props) {
    return () =>
      h('div', { class: 'board' }, [
        h(Teleport, { to: '#bs-game-modal' }, [
          h('div', collectCards(props.fullTree ?? {}).map((card) => h('span', { 'aria-label': card.name ?? '' }))),
        ]),
      ]);
  },
});

/** The modal `seat` opened, which must sit alone in its own host. */
function modalOf(seat: number): Element {
  const modal = document.querySelector(`.modal[data-seat="${seat}"]`);
  expect(modal, `seat ${seat}'s modal is in the page`).not.toBeNull();
  expect(modal!.parentElement!.querySelectorAll('.modal'), `seat ${seat}'s modal has its host to itself`).toHaveLength(1);
  return modal!;
}

describe('renderAsSeat gives the board a #bs-game-modal host (#1717)', () => {
  it('renders a modal opened after mount, and keeps patching it', async () => {
    const wrapper = await renderAsSeat(makeSecretHandGame('modal-host'), 1, { component: PopUpBoard });
    open.value = { 1: true };
    await wrapper.vm.$nextTick();
    expect(modalOf(1).textContent).toBe('first');

    line.value = 'second';
    await wrapper.vm.$nextTick();
    expect(modalOf(1).textContent).toBe('second');

    wrapper.unmount();
    open.value = {};
    line.value = 'first';
    expect(document.getElementById('bs-game-modal')).toBeNull();
  });

  it("sends each seat's modal to its own host while two seats are mounted", async () => {
    const game = makeSecretHandGame('two-hosts');
    const first = await renderAsSeat(game, 1, { component: PopUpBoard });
    const second = await renderAsSeat(game, 2, { component: PopUpBoard });

    open.value = { 2: true };
    await second.vm.$nextTick();
    open.value = { 1: true, 2: true };
    await first.vm.$nextTick();

    modalOf(2);
    modalOf(1);
    first.unmount();
    second.unmount();
    open.value = {};
  });

  it("scans the modal for a hidden card", async () => {
    const game = makeSecretHandGame('modal-leak');
    await expect(
      assertNoHiddenInfoLeak(game, 2, { component: ModalLeakBoard, componentProps: { fullTree: game.game.toJSON() } }),
    ).rejects.toThrow(/1-secret-card/);
  });
});
