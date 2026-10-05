// @vitest-environment node
/**
 * Behavioral tests for GameShell live-region announcement mapping.
 *
 * Instead of mounting the full GameShell component (which requires
 * extensive mocking of the game client and composables), we test the
 * pure announce-mapping helper extracted from GameShell. This verifies
 * the watcher logic without touching the DOM and satisfies the
 * "behavioral mapping must NOT be grep-only" gate (101-05-PLAN.md Task 1).
 */
import { describe, it, expect } from 'vitest';
import {
  announceTurnChange,
  announceGameOver,
  describePlaying,
} from '../composables/liveRegionAnnouncer.js';

// ── isMyTurn → polite region ─────────────────────────────────────────────────

describe('announceTurnChange', () => {
  it('returns "Your move", the words the players panel prints, when isMyTurn becomes true', () => {
    expect(announceTurnChange(true)).toBe('Your move');
  });

  it('returns empty string when isMyTurn becomes false (turn passed)', () => {
    expect(announceTurnChange(false)).toBe('');
  });
});

// ── flowState.complete → assertive region ────────────────────────────────────

describe('announceGameOver', () => {
  it('includes the winner name in the announcement', () => {
    expect(announceGameOver(['Alice'])).toBe('Game over — Alice wins');
  });

  it('includes multiple winner names', () => {
    expect(announceGameOver(['Alice', 'Bob'])).toBe('Game over — Alice and Bob win');
  });

  it('announces game over without a winner name when there are none', () => {
    expect(announceGameOver([])).toBe('Game over');
  });
});

// ── Phase 157 (D10/ENDGAME-01): draw vs unknown announcement ────────────────
// PROC-01: written against CURRENT source. announceGameOver has no isDraw
// parameter yet, so a genuine draw (winners=[], isDraw=true) collapses into
// the same "Game over" text as the unknown/degrade case — the RED failure.
describe('announceGameOver — draw vs unknown (D10)', () => {
  it('announces "Draw" for a genuine draw (winners=[], isDraw=true)', () => {
    expect(announceGameOver([], true)).toContain('Draw');
    expect(announceGameOver([], true)).not.toBe('Game over');
  });

  it('still announces "Game over" (not "Draw") when winner data is unavailable (isDraw=false)', () => {
    // Negative control: must pass today and keep passing post-fix.
    expect(announceGameOver([], false)).toBe('Game over');
  });
});

// ── other acting seats → polite region and players panel ─────────────────────

describe('describePlaying', () => {
  it('names one acting player', () => {
    expect(describePlaying(['Bob'])).toBe('Bob is playing');
  });

  it('names every acting player, not only the first', () => {
    expect(describePlaying(['Carol', 'Dave'])).toBe('Carol and Dave are playing');
    expect(describePlaying(['Bob', 'Carol', 'Dave'])).toBe('Bob, Carol and Dave are playing');
  });

  it('returns empty string when nobody else is acting', () => {
    expect(describePlaying([])).toBe('');
  });
});

// ── mount-time invariant ─────────────────────────────────────────────────────
// The watchers in GameShell.vue use { immediate: false } which means the
// mapping functions are NEVER called at mount. We document this invariant
// here: announceTurnChange(false) === '' (the initial value of isMyTurn is
// false; even if the watcher fired it would produce no text).
describe('mount-time invariant', () => {
  it('produces no announcement for the default isMyTurn=false state at mount', () => {
    // Simulates initial watcher call if it were immediate (it is not — this
    // proves the empty-at-mount requirement cannot be violated by logic).
    expect(announceTurnChange(false)).toBe('');
  });
});
