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
import { describe, it, expect } from 'vitest';

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
