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
import { defineComponent, getCurrentInstance, h, nextTick, type PropType } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
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

  it('answers a seat that is not on move the way the shell would', async () => {
    const board = (await render(renderAsSeat(moveGame(), 2, { component: ContextBoard }))).find('.board');

    expect(board.attributes('data-seat')).toBe('2');
    expect(board.attributes('data-my-turn')).toBe('false');
    // The flow's actions, as GameShell gives them; #408 flips this to none.
    expect(board.attributes('data-actions')).toBe('move');
    expect(board.attributes('data-due')).toBe('1');
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

let reached: Set<PropertyKey> | undefined;

const KeyProbe = defineComponent({
  name: 'KeyProbe',
  setup() {
    const keys = new Set<PropertyKey>();
    // A component's `provides` inherits from its parent's by prototype, down to
    // the app's own record, so walking the chain is every key it can inject.
    let provides: object | null = (getCurrentInstance() as unknown as { provides: object }).provides;
    while (provides) {
      for (const key of Reflect.ownKeys(provides)) keys.add(key);
      provides = Object.getPrototypeOf(provides) as object | null;
    }
    reached = keys;
    return () => h('div', { class: 'probe' });
  },
});

/**
 * What the shell provides only for itself. The board-region pin is how a board
 * tells the shell's auto-zoom that it scrolls instead of scaling; `renderAsSeat`
 * has no zoom to tell, and a board with no shell above it registers into nothing
 * (see boardRegionPin.ts).
 */
const SHELL_ONLY = new Set(['boardsmith:board-region-pin']);

function describeKey(key: PropertyKey): string {
  return typeof key === 'symbol' ? (key.description ?? key.toString()) : String(key);
}

async function keysInsideGameShell(game: TestGame<MoveGame>, seat: number): Promise<Set<PropertyKey>> {
  reached = undefined;
  enterIframe();
  const shell = mountPlatformShell({ gameType: 'render-as-seat-parity', board: KeyProbe, stubLobby: true });
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
  if (!reached) throw new Error('GameShell never mounted the probe board, so there is nothing to compare');
  return reached;
}

describe('renderAsSeat and GameShell give a board the same things (#406)', () => {
  it('provides every key GameShell provides to the board it mounts', async () => {
    const game = moveGame();
    const shellKeys = await keysInsideGameShell(game, 1);

    reached = undefined;
    const wrapper: VueWrapper = await render(renderAsSeat(game, 1, { component: KeyProbe }));
    expect(wrapper.find('.probe').exists()).toBe(true);
    const seatKeys = reached as Set<PropertyKey> | undefined;
    if (!seatKeys) throw new Error('renderAsSeat never mounted the probe board');

    const missing = [...shellKeys]
      .filter((key) => !seatKeys.has(key))
      .map(describeKey)
      .filter((name) => !SHELL_ONLY.has(name));
    expect(missing).toEqual([]);
    // The comparison is only worth something if the shell provided the four.
    expect([...shellKeys].map(describeKey)).toEqual(
      expect.arrayContaining(['bs:gameState', 'bs:actionController', 'announcer', 'animationEvents']),
    );
  });
});
