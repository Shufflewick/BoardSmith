// @vitest-environment jsdom
/**
 * The compact log toggle says there is something behind it (#22).
 *
 * Below the compact breakpoint the players panel and the log collapse behind a
 * single icon-only chevron. It rendered identically whether the log held zero
 * entries or two hundred, and identically whether they were new since the
 * player last opened it — so a player who takes damage at a round boundary sees
 * their health fall with no on-screen cue that an explanation exists.
 *
 * These test the derivation, which is the part with the rules in it: the count
 * comes from the log the shell already renders, and "read" means the player had
 * the panel open.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import PlayShell from './PlayShell.vue';
import GameHistory from './GameHistory.vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

/**
 * Mirrors GameShell's unread derivation. Kept beside the component in the same
 * canary style as GameShell.join-fallthrough.test.ts — if the shell changes the
 * rule, this mirror must receive the same change.
 */
function unreadCount(messageCount: number, watermark: number): number {
  return Math.max(0, messageCount - watermark);
}

function toggleLabel(expanded: boolean, unread: number): string {
  if (expanded) return 'Hide players and log';
  return unread > 0 ? `Show players and log, ${unread} new` : 'Show players and log';
}

describe('unread count', () => {
  it('is every entry when the player has never opened the log', () => {
    expect(unreadCount(210, 0)).toBe(210);
  });

  it('is zero on an empty log, so a badge never appears for nothing', () => {
    expect(unreadCount(0, 0)).toBe(0);
  });

  it('counts only what arrived since the player last had it open', () => {
    expect(unreadCount(216, 210)).toBe(6);
  });

  it('never goes negative when history is rewound below the watermark', () => {
    // Undo and time-travel both shorten the log the shell renders.
    expect(unreadCount(4, 210)).toBe(0);
  });
});

describe('toggle label', () => {
  it('names the unread count, so the control is self-describing to a screen reader', () => {
    expect(toggleLabel(false, 6)).toBe('Show players and log, 6 new');
  });

  it('says nothing about a count there is none of', () => {
    expect(toggleLabel(false, 0)).toBe('Show players and log');
  });

  it('drops the count once the panel is open — it is no longer unread', () => {
    expect(toggleLabel(true, 6)).toBe('Hide players and log');
  });
});

/**
 * The REAL shell, fed a game that prunes its log (#903): `messageOffset` is the
 * seat's line number of its first line, so the count is of lines, not of the
 * window's length, which stops growing at the cap.
 */
describe('unread count on the mounted shell (#903)', () => {
  afterEach(leaveIframe);

  async function post(messages: string[], messageOffset: number, gameInstanceId = 'game-1'): Promise<void> {
    window.dispatchEvent(new MessageEvent('message', {
      source: window.parent,
      data: {
        source: 'shufflewick',
        type: 'game_state',
        view: {
          flowState: { currentPlayer: 1, awaitingInput: true, availableActions: [] },
          state: {
            view: {}, players: [{ name: 'P1', seat: 1 }], currentPlayer: 1, isMyTurn: true,
            messages: messages.map((text) => ({ text })), messageOffset, gameInstanceId,
          },
        },
        winners: [],
      },
    }));
    await nextTick();
    await nextTick();
  }

  async function mounted() {
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();
    window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', type: 'init', seat: 1 } }));
    return wrapper;
  }

  const unread = (wrapper: Awaited<ReturnType<typeof mounted>>) => wrapper.findComponent(PlayShell).props('unreadLogCount');

  it('counts new lines while the log sits at its cap', async () => {
    const wrapper = await mounted();
    await post(['a', 'b', 'c'], 0);
    expect(unread(wrapper)).toBe(3);

    await post(['b', 'c', 'd'], 1);
    await post(['c', 'd', 'e'], 2);

    expect(unread(wrapper)).toBe(5);
    expect(wrapper.findComponent(GameHistory).props('messageOffset')).toBe(2);
    wrapper.unmount();
  });

  it("counts a restarted game's lines even when its log is shorter than the last game's", async () => {
    const wrapper = await mounted();
    await post(['a', 'b', 'c', 'd'], 0, 'game-1');
    wrapper.findComponent(PlayShell).vm.$emit('update:mobileExpanded', true);
    await nextTick();
    wrapper.findComponent(PlayShell).vm.$emit('update:mobileExpanded', false);
    await nextTick();
    expect(unread(wrapper)).toBe(0);

    await post(['new game'], 0, 'game-2');

    expect(unread(wrapper)).toBe(1);
    wrapper.unmount();
  });

  it('counts a line that replaces one an undo took back', async () => {
    const wrapper = await mounted();
    await post(['a', 'b'], 0);
    wrapper.findComponent(PlayShell).vm.$emit('update:mobileExpanded', true);
    await nextTick();
    wrapper.findComponent(PlayShell).vm.$emit('update:mobileExpanded', false);
    await nextTick();

    await post(['a'], 0);
    await post(['a', 'b again'], 0);

    expect(unread(wrapper)).toBe(1);
    wrapper.unmount();
  });
});
