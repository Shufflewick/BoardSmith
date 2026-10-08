// @vitest-environment jsdom
/**
 * THE TABLE'S ENDING IS SHOWN WHEN THE BOARD SAYS IT IS ON SCREEN (#419).
 *
 * The flow completing ends the game; it does not put the result in front of
 * the player. A board that holds its result back -- until the player has
 * watched a replay of the deciding battle, say -- calls `holdGameOverUntil` in
 * its setup, and the shell's game-over card and its assertive "Game over"
 * announcement both wait for it. They are one decision: neither may run ahead
 * of the other, or of the board.
 *
 * Asserted on the REAL GameShell, driven by the `game_state` frames a platform
 * host sends.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, effectScope, h, nextTick, ref, watch } from 'vue';
import { useGameContext } from '../composables/useGameContext.js';
import { holdGameOverUntil } from '../composables/useGameOverReveal.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

const PLAYERS = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
];

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', ...data } }));
}

function playingFrame(): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      flowState: { awaitingInput: true, complete: false, currentPlayer: 1, availableActions: ['play'] },
      state: { view: {}, players: PLAYERS, currentPlayer: 1, isMyTurn: false, availableActions: [] },
    },
    winners: [],
  };
}

/** The frame that ends the game: Alice wins. */
function completeFrame(): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      flowState: { awaitingInput: false, complete: true, winners: [0] },
      state: { view: {}, players: PLAYERS, isMyTurn: false, availableActions: [] },
    },
    winners: [0],
  };
}

/**
 * The completing frame as the dev host sends it: the winners ride on the frame,
 * and the flow state carries none.
 */
function completeFrameWinnersOnFrameOnly(): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      flowState: { awaitingInput: false, complete: true },
      state: { view: {}, players: PLAYERS, isMyTurn: false, availableActions: [] },
    },
    winners: [0],
  };
}

/** Every assertive announcement the shell relayed to the host page, in order. */
function assertive(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .map(([message]) => message as { source?: string; type?: string; level?: string; text?: string })
    .filter((m) => m?.source === 'boardsmith-a11y' && m.type === 'announce' && m.level === 'assertive')
    .map((m) => m.text as string);
}

/** Let the frame land, render, and every post-render watcher run. */
async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

const mounted: Array<{ unmount(): void }> = [];

async function mountShell(board: ReturnType<typeof defineComponent>, props?: NonNullable<Parameters<typeof mountPlatformShell>[0]>['props']) {
  enterIframe();
  const wrapper = mountPlatformShell({ board, props });
  mounted.push(wrapper);
  await nextTick();
  post({ type: 'init', seat: 1 });
  await settle();
  post(playingFrame());
  await settle();
  const spy = vi.spyOn(window, 'postMessage');
  return { wrapper, spy };
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
  leaveIframe();
});

const PlainBoard = defineComponent({ name: 'PlainBoard', setup: () => () => h('div', 'board') });

/** A board whose ending is on screen when the test says so. */
function boardHeldBy(shown: { value: boolean }) {
  return defineComponent({
    name: 'HoldingBoard',
    setup() {
      holdGameOverUntil(() => shown.value);
      return () => h('div', 'board');
    },
  });
}

/**
 * A board that starts a replay when the completing frame arrives, the way a
 * game plays back the deciding battle, and shows its result once the replay
 * ends. Its hold only turns on in reaction to the same frame that ends the
 * game, so the shell must read it after the board has seen that frame.
 */
const replay = { playing: ref(false) };
const ReplayBoard = defineComponent({
  name: 'ReplayBoard',
  setup() {
    const { gameState } = useGameContext();
    watch(
      () => gameState.value?.flowState?.complete === true,
      (complete) => {
        if (complete) replay.playing.value = true;
      },
    );
    holdGameOverUntil(() => !replay.playing.value);
    return () => h('div', replay.playing.value ? 'replaying' : 'board');
  },
});

type Shell = Awaited<ReturnType<typeof mountShell>>;

const ALICE_WINS = 'Game over — Alice wins';
/** Nothing shown or said yet. */
const HELD = { announced: [], card: false };
/** The ending carded and announced once. */
const REVEALED = { announced: [ALICE_WINS], card: true };

/** What the shell has shown and said of the ending once `step` has run and settled. */
async function after({ wrapper, spy }: Shell, step: () => void) {
  step();
  await settle();
  return { announced: assertive(spy), card: wrapper.find('.game-over-card').exists() };
}

const complete = () => post(completeFrame());

describe('the table ending (#419)', () => {
  it('with no board holding it, is announced and carded as soon as the flow completes', async () => {
    const shell = await mountShell(PlainBoard);

    expect(await after(shell, complete)).toEqual(REVEALED);
  });

  it('waits for the board: neither the card nor the announcement comes before the board shows its result', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown));

    expect(await after(shell, complete)).toEqual(HELD);
    expect(await after(shell, () => { shown.value = true; })).toEqual(REVEALED);
  });

  it('is not announced early by a board whose hold starts in reaction to the completing frame', async () => {
    replay.playing.value = false;
    const shell = await mountShell(ReplayBoard);

    expect(await after(shell, complete)).toEqual(HELD);
    expect(shell.wrapper.text()).toContain('replaying');
    expect(await after(shell, () => { replay.playing.value = false; })).toEqual(REVEALED);
  });

  it('for a board that draws its own ending, is announced when the board shows it, with no shell card', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown), { providesOwnGameOverUi: true });

    expect(await after(shell, complete)).toEqual(HELD);
    expect(await after(shell, () => { shown.value = true; })).toEqual({ announced: [ALICE_WINS], card: false });
  });

  it('for a board that draws its own ending, draws no shell card when the prop is written in kebab-case (#433)', async () => {
    const shell = await mountShell(PlainBoard, { 'provides-own-game-over-ui': true });

    expect(await after(shell, complete)).toEqual({ announced: [ALICE_WINS], card: false });
  });

  it('says the result the card shows, from the winners the host sent', async () => {
    const shell = await mountShell(PlainBoard);

    expect(await after(shell, () => post(completeFrameWinnersOnFrameOnly()))).toEqual(REVEALED);
    expect(shell.wrapper.find('.game-over-title').text()).toBe('Alice wins');
  });

  it('is announced once, however often the board flips back and forth after showing it', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown));

    await after(shell, complete);
    for (const value of [true, false, true]) await after(shell, () => { shown.value = value; });

    expect(assertive(shell.spy)).toEqual([ALICE_WINS]);
  });
});

describe('holdGameOverUntil outside a table (#419)', () => {
  it('fails loudly, naming where it belongs', () => {
    const scope = effectScope();
    expect(() => scope.run(() => holdGameOverUntil(() => true))).toThrow(
      /holdGameOverUntil.*board.*GameShell/s,
    );
    scope.stop();
  });
});
