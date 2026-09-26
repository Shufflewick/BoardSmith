// @vitest-environment jsdom
/**
 * `renderAsSeat` GIVES A WORLD'S BOARD WHAT WORLDSHELL GIVES IT (#413).
 *
 * #406 made a table seat mounted by `renderAsSeat` get everything GameShell
 * gives its board, built by the one function both call. A world seat was left
 * with board interaction and an inert controller carrying its offers' names, so
 * a world board that called `useWorld()` or read the play context threw inside
 * `setup()`, and `startAction` was refused because nothing could start.
 *
 * Both now build a world seat with `useWorldSeat`, and the last test here mounts
 * the real WorldShell and fails if it provides its board anything a board
 * mounted by `renderAsSeat` is not given.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, inject, type PropType } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

import type { ElementJSON } from '../engine/index.js';
import type { UseActionControllerReturn } from '../ui/composables/useActionControllerTypes.js';
import { GAME_CONTEXT_KEYS } from '../ui/composables/useGameContext.js';
import { useWorld } from '../ui/world/useWorld.js';
import WorldShell from '../ui/world/WorldShell.vue';
import { WORLD_HOST_SOURCE } from '../ui/world/worldProtocol.js';
import { defaultUI, defineGameUIs } from '../ui/game-uis.js';
import { createTestWorld, type TestWorld } from './test-world.js';
import { vaultBundle } from './test-world.test-helper.js';
import { TargetBoard } from './dom-leak.test-helper.js';
import { assertNoHiddenInfoLeak, preloadSeatRenderer, renderAsSeat } from './dom-leak.js';
import { expectSeatGetsWhatTheShellGives, KeyProbe, keysProbedIn } from './provided-keys.test-helper.js';

await preloadSeatRenderer();

/** The seat every render below is made as. */
const SEAT = 2;

const mounted: Array<{ unmount(): void }> = [];
const worlds: TestWorld[] = [];
afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  for (const world of worlds.splice(0)) await world.close();
});

async function vaultWorld(): Promise<TestWorld> {
  const world = await createTestWorld({ definition: vaultBundle() });
  worlds.push(world);
  return world;
}

async function render<W extends { unmount(): void }>(wrapper: Promise<W>): Promise<W> {
  const done = await wrapper;
  mounted.push(done);
  return done;
}

/** A board that reads the world through `useWorld()`, as a nested world UI does. */
const WorldBoard = defineComponent({
  name: 'WorldBoard',
  setup() {
    const world = useWorld();
    return () =>
      h('div', {
        class: 'board',
        'data-phase': world.phase.value,
        'data-seat': String(world.seat.value),
        'data-actions': world.actions.value.map((offer) => offer.name).join(','),
        'data-pending': String(world.offersPending.value),
        'data-notice': String(world.notice.value),
        'data-presence': (world.presence.value ?? []).join(','),
      });
  },
});

describe('renderAsSeat provides the world context WorldShell provides (#413)', () => {
  it("mounts a board that calls useWorld(), answered from the seat's own frame", async () => {
    const world = await vaultWorld();
    const board = (await render(renderAsSeat(world, SEAT, { component: WorldBoard }))).find('.board');

    expect(board.attributes('data-phase')).toBe('watching');
    expect(board.attributes('data-seat')).toBe(String(SEAT));
    expect(board.attributes('data-actions')).toBe('inspect,post,stash');
    expect(board.attributes('data-pending')).toBe('false');
    expect(board.attributes('data-notice')).toBe('null');
    expect(board.attributes('data-presence')).toBe('1,2,3');
  });

  it("refuses the board's own act() without changing the world, saying how to take the move", async () => {
    const world = await vaultWorld();
    let act: ReturnType<typeof useWorld>['act'] | undefined;
    const ActingBoard = defineComponent({
      name: 'ActingBoard',
      setup() {
        act = useWorld().act;
        return () => h('div', { class: 'board' });
      },
    });
    const before = JSON.stringify(await world.unredactedElements());

    await render(renderAsSeat(world, SEAT, { component: ActingBoard }));
    const outcome = await act!('stash');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain(`world.take(${SEAT}, 'stash'`);
    expect(JSON.stringify(await world.unredactedElements())).toBe(before);
  });
});

/** A board that reads the play context instead of its props. */
const PlayContextBoard = defineComponent({
  name: 'PlayContextBoard',
  props: {
    actionController: { type: Object as PropType<UseActionControllerReturn>, required: true },
  },
  setup(props) {
    const seat = inject(GAME_CONTEXT_KEYS.playerSeat);
    const mayAct = inject(GAME_CONTEXT_KEYS.isMyTurn);
    const actions = inject(GAME_CONTEXT_KEYS.availableActions);
    const me = inject(GAME_CONTEXT_KEYS.myPlayer);
    const view = inject(GAME_CONTEXT_KEYS.gameView);
    const controller = inject(GAME_CONTEXT_KEYS.actionController);
    return () =>
      h('div', {
        class: 'board',
        'data-seat': String(seat?.value),
        'data-may-act': String(mayAct?.value),
        'data-actions': actions?.value.join(','),
        'data-me': me?.value?.name ?? '',
        'data-view': (view?.value as ElementJSON | null)?.className ?? '',
        'data-same-controller': String(controller === props.actionController),
      });
  },
});

describe('renderAsSeat provides the play context WorldShell provides (#413)', () => {
  it("answers the shared half of the game context from the seat's own frame", async () => {
    const world = await vaultWorld();
    const board = (await render(renderAsSeat(world, SEAT, { component: PlayContextBoard }))).find('.board');

    expect(board.attributes('data-seat')).toBe(String(SEAT));
    expect(board.attributes('data-may-act')).toBe('true');
    expect(board.attributes('data-actions')).toBe('inspect,post,stash');
    // The host names nobody, so the shell says the seat rather than inventing a person.
    expect(board.attributes('data-me')).toBe(`Seat ${SEAT}`);
    expect(board.attributes('data-view')).toBe((await world.getPlayerView(SEAT)).state.className);
    expect(board.attributes('data-same-controller')).toBe('true');
  });
});

/** The ids of the rooms seat {@link SEAT} can look in on: the commons and its own vault. */
async function roomIds(world: TestWorld): Promise<string[]> {
  const inspect = (await world.getPlayerView(SEAT)).offers.find((offer) => offer.name === 'inspect');
  const room = inspect?.selections.find((selection) => selection.name === 'room');
  return (room?.validElements ?? []).map((element) => String(element.id));
}

describe('startAction opens an action on a world seat (#413)', () => {
  it("draws the world's own targets for the open action", async () => {
    const world = await vaultWorld();
    const expected = await roomIds(world);
    expect(expected).toHaveLength(2);

    const wrapper = await render(
      renderAsSeat(world, SEAT, { component: TargetBoard, startAction: { name: 'inspect' } }),
    );

    expect(wrapper.findAll('.target').map((target) => target.attributes('data-element-id'))).toEqual(expected);
  });

  it("prices the draft with the world's own quote once its pick is filled", async () => {
    const world = await vaultWorld();
    const [commons] = await roomIds(world);
    const wrapper = await render(
      renderAsSeat(world, SEAT, {
        component: PlayContextBoard,
        startAction: { name: 'inspect', args: { room: Number(commons) } },
      }),
    );

    const controller = wrapper.props('actionController') as UseActionControllerReturn;
    expect(controller.currentAction.value).toBe('inspect');
    expect(controller.awaitingConfirmation.value).toBe(true);
    expect(controller.actionQuote.value).toEqual(['One look, free']);
  });

  it('scans a world board with the action open', async () => {
    const world = await vaultWorld();

    await expect(
      assertNoHiddenInfoLeak(world, SEAT, { component: TargetBoard, startAction: { name: 'inspect' } }),
    ).resolves.toBeUndefined();
  });

  it('refuses an action the seat was not offered, naming what it may take', async () => {
    const world = await vaultWorld();

    await expect(
      renderAsSeat(world, SEAT, { component: TargetBoard, startAction: { name: 'demolish' } }),
    ).rejects.toThrow(/could not open "demolish" for seat 2.*may take "inspect", "post", "stash"/s);
  });
});

// ---------------------------------------------------------------------------
// PARITY WITH THE REAL SHELL.
//
// The probe is mounted once inside the real WorldShell, told the frame a host
// would send for the same world and seat, and once by renderAsSeat; any key the
// shell's board can inject that renderAsSeat's cannot is a board that works in
// the shell and breaks in a test.
// ---------------------------------------------------------------------------

async function keysInsideWorldShell(world: TestWorld, seat: number): Promise<Set<PropertyKey>> {
  const frame = await world.getPlayerView(seat);
  return keysProbedIn('WorldShell', async () => {
    const shell = mount(WorldShell, {
      props: { uis: defineGameUIs({ KeyProbe: defaultUI(KeyProbe) }), displayName: 'Vault World' },
    });
    mounted.push(shell);
    const send = (data: unknown): void =>
      (shell.vm as unknown as { host: { handleMessage(event: MessageEvent): void } }).host.handleMessage(
        new MessageEvent('message', { data, origin: 'https://shufflewick.pub' }),
      );
    send({
      source: WORLD_HOST_SOURCE,
      type: 'world_state',
      phase: 'watching',
      view: frame.view,
      seat,
      revision: frame.revision,
      notice: null,
      worldName: 'Vault World',
      presence: frame.presence,
    });
    send({ source: WORLD_HOST_SOURCE, type: 'world_offers', revision: frame.revision, actions: frame.offers });
    await flushPromises();
  });
}

describe('renderAsSeat and WorldShell give a world board the same things (#413)', () => {
  it('provides every key WorldShell provides to the board it mounts', async () => {
    const world = await vaultWorld();
    const shellKeys = await keysInsideWorldShell(world, SEAT);

    const seatKeys = await keysProbedIn('renderAsSeat', () => render(renderAsSeat(world, SEAT, { component: KeyProbe })));

    expectSeatGetsWhatTheShellGives(shellKeys, seatKeys, [
      'boardsmith-world',
      'bs:gameView',
      'bs:actionController',
      'boardInteraction',
    ]);
  });
});
