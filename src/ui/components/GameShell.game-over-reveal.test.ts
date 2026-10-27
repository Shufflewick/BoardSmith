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
import { watchLiveRegion } from '../../testing/live-region.js';

const PLAYERS = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
];

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
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

/** Let the frame land, render, and every post-render watcher run. */
async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

const mounted: Array<{ unmount(): void }> = [];

type ShellOptions = NonNullable<Parameters<typeof mountPlatformShell>[0]>;

async function mountShell(
  board: ReturnType<typeof defineComponent>,
  props?: ShellOptions['props'],
  slots?: ShellOptions['slots'],
  firstFrame: Record<string, unknown> = playingFrame(),
  attachTo?: HTMLElement,
) {
  const posted = enterIframe();
  const wrapper = mountPlatformShell({ board, props, slots, attachTo });
  mounted.push(wrapper);
  await nextTick();
  post({ type: 'init', seat: 1 });
  await settle();
  post(firstFrame);
  await settle();
  const shownSignals = () => posted.filter((m) => (m as { type?: unknown }).type === 'game_over_shown');
  return { wrapper, posted, shownSignals, assertive: watchLiveRegion(wrapper, 'assertive') };
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
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
async function after({ wrapper, assertive }: Shell, step: () => void) {
  step();
  await settle();
  return { announced: await assertive(), card: wrapper.find('.game-over-card').exists() };
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

  it('marks the shell data-bs-game-over once the ending is on screen, card or not, so the smoke walk sees it (#1463)', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown), { providesOwnGameOverUi: true });
    const marked = () => shell.wrapper.find('.game-shell').attributes('data-bs-game-over') !== undefined;

    expect(marked()).toBe(false);
    await after(shell, complete);
    expect(marked()).toBe(false);
    await after(shell, () => { shown.value = true; });
    expect(marked()).toBe(true);
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

    expect(await shell.assertive()).toEqual([ALICE_WINS]);
  });
});

describe('telling the host page the ending is on screen (#1507)', () => {
  const SHOWN = { source: 'shufflewick-game', type: 'game_over_shown' };

  it('game_ready says this shell sends game_over_shown, so the host waits for it', async () => {
    const shell = await mountShell(PlainBoard);

    expect(shell.posted).toContainEqual({ source: 'shufflewick-game', type: 'game_ready', revealsGameOver: true });
  });

  it('posts game_over_shown at once on completion when no board holds the ending', async () => {
    const shell = await mountShell(PlainBoard);
    await after(shell, complete);

    expect(shell.shownSignals()).toEqual([SHOWN]);
  });

  it('never posts it while a hold is closed, and posts it exactly once after the hold releases', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown));

    await after(shell, complete);
    expect(shell.shownSignals()).toEqual([]);
    for (const value of [true, false, true]) await after(shell, () => { shown.value = value; });

    expect(shell.shownSignals()).toEqual([SHOWN]);
  });

  it('posts it once the first frame the shell draws is already complete (a reload of a finished table)', async () => {
    const shell = await mountShell(PlainBoard, undefined, undefined, completeFrame());

    expect(shell.shownSignals()).toEqual([SHOWN]);
  });

  it('posts it when the finale throws, since the shell replaces the broken board and its hold goes with it', async () => {
    const broken = ref(false);
    const FinaleBoard = defineComponent({
      name: 'FinaleBoard',
      setup() {
        holdGameOverUntil(() => false);
        return () => {
          if (broken.value) throw new Error('finale failed');
          return h('div', 'board');
        };
      },
    });
    const shell = await mountShell(FinaleBoard);
    await after(shell, complete);
    expect(shell.shownSignals()).toEqual([]);

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await after(shell, () => { broken.value = true; });
    quiet.mockRestore();

    expect(shell.shownSignals()).toEqual([SHOWN]);
  });

  it('posts it when the finale is interrupted, since an unmounted finale releases its hold', async () => {
    const playing = ref(true);
    const Finale = defineComponent({
      name: 'Finale',
      setup() {
        holdGameOverUntil(() => false);
        return () => h('div', 'finale');
      },
    });
    const board = defineComponent({ name: 'InterruptedBoard', setup: () => () => (playing.value ? h(Finale) : h('div', 'board')) });
    const shell = await mountShell(board);
    await after(shell, complete);
    expect(shell.shownSignals()).toEqual([]);

    await after(shell, () => { playing.value = false; });

    expect(shell.shownSignals()).toEqual([SHOWN]);
  });
});

describe('the player can show a held result themselves', () => {
  const SHOWN = { source: 'shufflewick-game', type: 'game_over_shown' };
  // A hold that never releases (a stuck replay) must not hide the result for good.
  const showResult = (shell: Shell) => shell.wrapper.find('button[data-testid="bs-show-result"]');

  it('offers Show result only while a hold is closed on a finished game', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown));
    expect(showResult(shell).exists()).toBe(false);

    await after(shell, complete);
    expect(showResult(shell).text()).toBe('Show result');

    await after(shell, () => { shown.value = true; });
    expect(showResult(shell).exists()).toBe(false);
  });

  it('is not offered when no board holds the ending', async () => {
    const shell = await mountShell(PlainBoard);
    await after(shell, complete);

    expect(showResult(shell).exists()).toBe(false);
  });

  it('reveals the result and tells the host once, and a later release of the hold says nothing more', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown));
    await after(shell, complete);

    expect(await after(shell, () => { void showResult(shell).trigger('click'); })).toEqual(REVEALED);
    expect(shell.shownSignals()).toEqual([SHOWN]);
    expect(showResult(shell).exists()).toBe(false);

    expect(await after(shell, () => { shown.value = true; })).toEqual(REVEALED);
    expect(shell.shownSignals()).toEqual([SHOWN]);
  });

  it('moves keyboard focus to the board, since the button it was on goes away', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const shell = await mountShell(boardHeldBy(ref(false)), { providesOwnGameOverUi: true }, undefined, playingFrame(), host);
    await after(shell, complete);
    (showResult(shell).element as HTMLElement).focus();

    await after(shell, () => { void showResult(shell).trigger('click'); });

    expect(document.activeElement).toBe(shell.wrapper.find('[data-testid="bs-board"]').element);
    host.remove();
  });

  it('holds the next game again after a restart', async () => {
    const shown = ref(false);
    const shell = await mountShell(boardHeldBy(shown));
    await after(shell, complete);
    await after(shell, () => { void showResult(shell).trigger('click'); });

    await after(shell, () => post(playingFrame()));
    await after(shell, complete);

    expect(shell.wrapper.find('.game-over-card').exists()).toBe(false);
    expect(showResult(shell).exists()).toBe(true);
  });
});

describe('the ending offers no restart (#902)', () => {
  // A deployed host has no restart op, so a New Game or Rematch here could only fail.
  it('the card offers only Close', async () => {
    const shell = await mountShell(PlainBoard);
    await after(shell, complete);

    const labels = shell.wrapper.findAll('.game-over-card button').map((b) => b.attributes('aria-label') ?? b.text());
    expect(labels).toEqual(['Close']);
  });

  it('a #game-over slot is handed winners, players, isDraw and dismiss, and nothing that restarts', async () => {
    let handed: Record<string, unknown> = {};
    const shell = await mountShell(PlainBoard, undefined, {
      'game-over': (slotProps) => { handed = slotProps; return h('div', 'custom ending'); },
    });
    await after(shell, complete);

    // `key` is Vue's own, added to a slot rendered under v-if.
    expect(Object.keys(handed).filter((k) => k !== 'key').sort()).toEqual(['dismiss', 'isDraw', 'players', 'winners']);
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
