// @vitest-environment jsdom
/**
 * `renderAsSeat` GIVES A TABLE'S BOARD WHAT GAMESHELL GIVES IT (#406).
 *
 * GameShell provides four things to the board it mounts: board interaction,
 * the game context, the announcer and animation events. `renderAsSeat` used to
 * provide only the first, so a board calling `useGameContext()` threw inside
 * `setup()`, one calling `useAnnouncer()` got a no-op, and one playing its
 * animations from `useAnimationEvents()` was handed nothing to play.
 *
 * Both now build all of it with `useTableSeat`, so the last test here mounts the
 * real GameShell and fails if it provides its board anything a board mounted by
 * `renderAsSeat` is not given.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component, type PropType } from 'vue';
import { mount } from '@vue/test-utils';
import { MoveGame } from '../session/move-game.test-helper.js';
import { buildPlayerState } from '../session/utils.js';
import type { UseActionControllerReturn } from '../ui/composables/useActionControllerTypes.js';
import { GAME_CONTEXT_KEYS, useGameContext } from '../ui/composables/useGameContext.js';
import { WORLD_CONTEXT_KEY } from '../ui/world/useWorld.js';
import { useAnnouncer } from '../ui/composables/useAnnouncer.js';
import { useAnimationEvents } from '../ui/composables/useAnimationEvents.js';
import { holdGameOverUntil } from '../ui/composables/useGameOverReveal.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from '../ui/components/GameShell.platform-mount.test-helper.js';
import { TestGame } from './test-game.js';
import { preloadSeatRenderer, renderAsSeat, shellProvidedKeys, tableShellContext } from './dom-leak.js';
import { expectSameKeysAsTheShell, KeyProbe, keysProbedIn, namesOf, refusal } from './provided-keys.test-helper.js';

await preloadSeatRenderer();

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
  leaveIframe();
});

function moveGame(): TestGame<MoveGame> {
  return TestGame.create(MoveGame, { playerCount: 2, seed: 'bs406' });
}

async function render<W extends { unmount(): void }>(wrapper: Promise<W>): Promise<W> {
  const done = await wrapper;
  mounted.push(done);
  return done;
}

/** A board that reads the game context instead of its props, as a custom UI may. */
const ContextBoard = defineComponent({
  name: 'ContextBoard',
  props: {
    actionController: { type: Object as PropType<UseActionControllerReturn>, required: true },
  },
  setup(props) {
    const context = useGameContext();
    return () =>
      h('div', {
        class: 'board',
        'data-seat': String(context.playerSeat.value),
        'data-my-turn': String(context.isMyTurn.value),
        'data-actions': context.availableActions.value.join(','),
        'data-due': context.dueSeats.value.join(','),
        'data-players': context.players.value.map((player) => player.name).join(','),
        'data-me': context.myPlayer.value?.name ?? '',
        'data-view': String((context.gameView.value as { id?: number } | null)?.id),
        'data-same-controller': String(context.actionController === props.actionController),
      });
  },
});

describe('renderAsSeat provides the game context GameShell provides (#406)', () => {
  it("mounts a board that calls useGameContext(), answered from the seat's own state", async () => {
    const game = moveGame();
    const wrapper = await render(renderAsSeat(game, 1, { component: ContextBoard }));
    const board = wrapper.find('.board');

    expect(board.attributes('data-seat')).toBe('1');
    expect(board.attributes('data-my-turn')).toBe('true');
    expect(board.attributes('data-actions')).toBe('move');
    expect(board.attributes('data-due')).toBe('1');
    expect(board.attributes('data-players')).toBe(game.game.players.map((player) => player.name).join(','));
    expect(board.attributes('data-me')).toBe(game.game.getPlayer(1)!.name);
    expect(board.attributes('data-view')).toBe(String(game.game.id));
    expect(board.attributes('data-same-controller')).toBe('true');
  });

  it('gives a seat that is not on move no actions (#408)', async () => {
    const board = (await render(renderAsSeat(moveGame(), 2, { component: ContextBoard }))).find('.board');

    expect(board.attributes('data-seat')).toBe('2');
    expect(board.attributes('data-my-turn')).toBe('false');
    expect(board.attributes('data-actions')).toBe('');
    expect(board.attributes('data-due')).toBe('1');
  });

  it("gives GameShell's board the seat's own actions, not the acting seat's (#408)", async () => {
    const game = moveGame();

    const onMove = (await renderInsideGameShell(game, 1, ContextBoard)).find('.board');
    expect(onMove.attributes('data-actions')).toBe('move');
    for (const wrapper of mounted.splice(0)) wrapper.unmount();

    const offMove = (await renderInsideGameShell(game, 2, ContextBoard)).find('.board');
    expect(offMove.attributes('data-my-turn')).toBe('false');
    expect(offMove.attributes('data-actions')).toBe('');
  });
});

/** A board that announces on mount, as a board announcing its own changes does. */
const AnnouncingBoard = defineComponent({
  name: 'AnnouncingBoard',
  setup() {
    const { announce } = useAnnouncer();
    announce('The pawn is on the bridge');
    return () => h('div', { class: 'board' });
  },
});

describe('renderAsSeat provides the announcer GameShell provides (#406)', () => {
  it("gives the board the shell's announcer, which relays what it says", async () => {
    const posted = vi.spyOn(window, 'postMessage');

    await render(renderAsSeat(moveGame(), 1, { component: AnnouncingBoard }));

    const relayed = posted.mock.calls
      .map(([message]) => message as { source?: string; type?: string; text?: string })
      .filter((message) => message?.source === 'boardsmith-a11y' && message.type === 'announce');
    expect(relayed.map((message) => message.text)).toEqual(['The pawn is on the bridge']);
  });
});

/** A board that holds the table's ending back, as a board replaying the final battle does. */
const HoldingBoard = defineComponent({
  name: 'HoldingBoard',
  setup() {
    holdGameOverUntil(() => false);
    return () => h('div', { class: 'board' });
  },
});

describe('renderAsSeat provides the game-over hold GameShell provides (#419)', () => {
  it('mounts a board that holds the ending back, as the shell does', async () => {
    const wrapper = await render(renderAsSeat(moveGame(), 1, { component: HoldingBoard }));

    expect(wrapper.find('.board').exists()).toBe(true);
  });
});

/** A board that plays the seat's `flash` events, recording each one it is handed. */
const played: unknown[] = [];
const AnimatedBoard = defineComponent({
  name: 'AnimatedBoard',
  setup() {
    const animations = useAnimationEvents();
    if (!animations) throw new Error('AnimatedBoard was given no animation events');
    animations.registerHandler('flash', async (event) => void played.push(event.data), { skip: 'run' });
    return () => h('div', { class: 'board' });
  },
});

describe('renderAsSeat provides the animation events GameShell provides (#406)', () => {
  it("plays the seat's pending animation events to the board's own handler", async () => {
    played.length = 0;
    const game = moveGame();
    game.game.animate('flash', { room: 'bridge' });

    await render(renderAsSeat(game, 1, { component: AnimatedBoard }));

    expect(played).toEqual([{ room: 'bridge' }]);
  });
});

// ---------------------------------------------------------------------------
// PARITY WITH THE REAL SHELL.
//
// The probe records every injection key its component can reach. It is mounted
// once inside the real GameShell, fed a frame built from the same game, and once
// by renderAsSeat; any key the shell's board can inject that renderAsSeat's
// cannot is a board that works in the shell and breaks in a test.
// ---------------------------------------------------------------------------

/**
 * Mount the real GameShell as `seat`, with `board` as its one UI, and post it
 * the frame a session publishes for that seat.
 */
async function renderInsideGameShell(game: TestGame<MoveGame>, seat: number, board: Component) {
  enterIframe();
  const shell = mountPlatformShell({ board });
  mounted.push(shell);
  await nextTick();
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', type: 'init', seat } }));
  await nextTick();
  const names = game.game.players.map((player) => player.name ?? `Player ${player.seat}`);
  const frame = {
    flowState: game.runner.getFlowState(),
    state: buildPlayerState(game.runner, names, seat, { includeActionMetadata: true }),
  };
  window.dispatchEvent(
    new MessageEvent('message', { data: { source: 'shufflewick', type: 'game_state', view: frame, winners: [] } }),
  );
  for (let i = 0; i < 3; i++) await nextTick();
  return shell;
}

async function keysInsideGameShell(game: TestGame<MoveGame>, seat: number): Promise<Set<PropertyKey>> {
  return keysProbedIn('GameShell', async () => {
    await renderInsideGameShell(game, seat, KeyProbe);
  });
}

/** Keys GameShell must be seen to provide, so a comparison is against something. */
const TABLE_SHELL_PROVIDES = ['bs:gameState', 'bs:actionController', 'announcer', 'animationEvents', 'boardsmith:game-over-holds'];

describe('renderAsSeat and GameShell give a board the same things (#406, #453)', () => {
  it('provides exactly the keys GameShell provides to the board it mounts, no more and no fewer', async () => {
    const game = moveGame();
    const shellKeys = await keysInsideGameShell(game, 1);

    const seatKeys = await keysProbedIn('renderAsSeat', () => render(renderAsSeat(game, 1, { component: KeyProbe })));

    expectSameKeysAsTheShell(shellKeys, seatKeys, TABLE_SHELL_PROVIDES);
  });

  it("refuses a provided key only a world's shell gives, since a board reading it would pass here and throw in play", async () => {
    expect(await refusal(renderAsSeat(moveGame(), 1, { component: KeyProbe, provide: { [WORLD_CONTEXT_KEY as symbol]: {} } }))).toMatch(/boardsmith-world.*GameShell never provides/s);
  });
});

describe('tableShellContext: the table stub is what GameShell provides, built the same way (#453)', () => {
  it('provides exactly the keys GameShell provides, no more and no fewer', async () => {
    const game = moveGame();
    const shellKeys = await keysInsideGameShell(game, 1);

    const stub = await tableShellContext(game, 1);
    const stubKeys = await keysProbedIn('tableShellContext', async () => {
      mounted.push(mount(KeyProbe, { global: { provide: stub.provide } }));
    });

    expectSameKeysAsTheShell(shellKeys, stubKeys, TABLE_SHELL_PROVIDES);
    expect(namesOf(Object.getOwnPropertySymbols(stub.provide))).toEqual(namesOf((await shellProvidedKeys()).table));
    stub.stop();
  });

  it("answers useGameContext() from the seat's own state, with the seat's own controller", async () => {
    const game = moveGame();
    const stub = await tableShellContext(game, 1);
    const wrapper = mount(ContextBoard, { props: { actionController: stub.actionController }, global: { provide: stub.provide } });
    mounted.push(wrapper);

    expect(wrapper.find('.board').attributes('data-actions')).toBe('move');
    expect(wrapper.find('.board').attributes('data-same-controller')).toBe('true');
    stub.stop();
  });

  it("refuses a key only a world's shell gives, naming it, and keeps one GameShell gives replaced", async () => {
    const game = moveGame();

    expect(await refusal(tableShellContext(game, 1, { provide: { [WORLD_CONTEXT_KEY as symbol]: {} } }))).toMatch(
      /tableShellContext was asked to provide boardsmith-world, which GameShell never provides.*worldShellContext/s,
    );

    const presentation = ref('replaced');
    const stub = await tableShellContext(game, 1, { provide: { [GAME_CONTEXT_KEYS.presentation as symbol]: presentation } });
    expect(stub.provide[GAME_CONTEXT_KEYS.presentation as symbol]).toBe(presentation);
    stub.stop();
  });
});
