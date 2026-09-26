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
import { defineComponent, h, nextTick, type Component, type PropType } from 'vue';
import { MoveGame } from '../session/move-game.test-helper.js';
import { buildPlayerState } from '../session/utils.js';
import type { UseActionControllerReturn } from '../ui/composables/useActionControllerTypes.js';
import { useGameContext } from '../ui/composables/useGameContext.js';
import { useAnnouncer } from '../ui/composables/useAnnouncer.js';
import { useAnimationEvents } from '../ui/composables/useAnimationEvents.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from '../ui/components/GameShell.platform-mount.test-helper.js';
import { TestGame } from './test-game.js';
import { preloadSeatRenderer, renderAsSeat } from './dom-leak.js';
import { expectSeatGetsWhatTheShellGives, KeyProbe, keysProbedIn } from './provided-keys.test-helper.js';

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
  const shell = mountPlatformShell({ gameType: 'render-as-seat-parity', board, stubLobby: true });
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

describe('renderAsSeat and GameShell give a board the same things (#406)', () => {
  it('provides every key GameShell provides to the board it mounts', async () => {
    const game = moveGame();
    const shellKeys = await keysInsideGameShell(game, 1);

    const seatKeys = await keysProbedIn('renderAsSeat', () => render(renderAsSeat(game, 1, { component: KeyProbe })));

    expectSeatGetsWhatTheShellGives(shellKeys, seatKeys, [
      'bs:gameState',
      'bs:actionController',
      'announcer',
      'animationEvents',
    ]);
  });
});
