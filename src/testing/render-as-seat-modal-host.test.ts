// @vitest-environment jsdom
/**
 * A BOARD'S MODAL HAS ITS HOST UNDER `renderAsSeat` (#1717): the shell gives a
 * board a `#bs-game-modal` host to Teleport a blocking modal into, so
 * `renderAsSeat` gives each seat's board one too, the modal it opens lands in
 * that seat's own host, and the hidden-information scan reads it.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { defineComponent, h, onBeforeUnmount, ref, Teleport, type PropType } from 'vue';
import type { VueWrapper } from '@vue/test-utils';

import { assertNoHiddenInfoLeak, preloadSeatRenderer, renderAsSeat } from './dom-leak.js';
import { collectCards, makeSecretHandGame, type ViewNode } from './dom-leak.test-helper.js';

await preloadSeatRenderer();

const open = ref<Record<number, boolean>>({});
const line = ref('first');
const deferred = ref(false);
/** Which seat's modal each board found in `#bs-game-modal` as it unmounted. */
const seenOnUnmount: Array<string | null> = [];
const mounted: VueWrapper[] = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  open.value = {};
  line.value = 'first';
  deferred.value = false;
  seenOnUnmount.length = 0;
});

async function seat(game: ReturnType<typeof makeSecretHandGame>, seatNumber: number): Promise<VueWrapper> {
  const wrapper = (await renderAsSeat(game, seatNumber, { component: PopUpBoard })) as unknown as VueWrapper;
  mounted.push(wrapper);
  return wrapper;
}

function unmount(wrapper: VueWrapper): void {
  mounted.splice(mounted.indexOf(wrapper), 1);
  wrapper.unmount();
}

/** A board whose modal opens only when the test says so, as a pop-up does. */
const PopUpBoard = defineComponent({
  name: 'PopUpBoard',
  props: { playerSeat: { type: Number, required: true } },
  setup(props) {
    onBeforeUnmount(() => seenOnUnmount.push(document.querySelector('#bs-game-modal .modal')?.getAttribute('data-seat') ?? null));
    return () =>
      h('div', { class: 'board' }, [
        open.value[props.playerSeat]
          ? h(Teleport, { to: '#bs-game-modal', defer: deferred.value }, [h('p', { class: 'modal', 'data-seat': String(props.playerSeat) }, line.value)])
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
    const wrapper = await seat(makeSecretHandGame('modal-host'), 1);
    open.value = { 1: true };
    await wrapper.vm.$nextTick();
    expect(modalOf(1).textContent).toBe('first');

    line.value = 'second';
    await wrapper.vm.$nextTick();
    expect(modalOf(1).textContent).toBe('second');

    unmount(wrapper);
    expect(document.getElementById('bs-game-modal')).toBeNull();
  });

  it("sends each seat's modal to its own host while two seats are mounted", async () => {
    const game = makeSecretHandGame('two-hosts');
    const first = await seat(game, 1);
    const second = await seat(game, 2);

    open.value = { 2: true };
    await second.vm.$nextTick();
    open.value = { 1: true, 2: true };
    await first.vm.$nextTick();

    modalOf(2);
    modalOf(1);
  });

  it("sends each seat's deferred modal to its own host when both open in one tick (#1717 review F1)", async () => {
    const game = makeSecretHandGame('deferred-hosts');
    const first = await seat(game, 1);
    await seat(game, 2);

    deferred.value = true;
    open.value = { 1: true, 2: true };
    await first.vm.$nextTick();

    modalOf(1);
    modalOf(2);
  });

  it('gives the id back to a seat still mounted when the seat holding it unmounts (#1717 review F2)', async () => {
    const game = makeSecretHandGame('id-back');
    const first = await seat(game, 1);
    open.value = { 1: true };
    await first.vm.$nextTick();
    unmount(await seat(game, 2));

    expect(document.querySelector('#bs-game-modal .modal')?.getAttribute('data-seat')).toBe('1');
  });

  it("lets a board find its own modal host while it unmounts (#1717 review F3)", async () => {
    const game = makeSecretHandGame('teardown');
    const first = await seat(game, 1);
    const second = await seat(game, 2);
    open.value = { 1: true, 2: true };
    await second.vm.$nextTick();

    unmount(first);

    expect(seenOnUnmount).toEqual(['1']);
  });

  it("scans the modal for a hidden card", async () => {
    const game = makeSecretHandGame('modal-leak');
    await expect(
      assertNoHiddenInfoLeak(game, 2, { component: ModalLeakBoard, componentProps: { fullTree: game.game.toJSON() } }),
    ).rejects.toThrow(/1-secret-card/);
  });

  it("says a modal surface with no data-element-id has no owner, and how to give it one (#1717 review F5)", async () => {
    const game = makeSecretHandGame('modal-owner');
    await expect(
      assertNoHiddenInfoLeak(game, 2, { component: ModalLeakBoard, componentProps: { fullTree: game.game.toJSON() } }),
    ).rejects.toThrow(/seat's modal.*data-element-id/);
  });
});
