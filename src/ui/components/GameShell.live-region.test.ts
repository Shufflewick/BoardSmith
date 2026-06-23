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
  announceConnectionChange,
  announceGameOver,
  announceOpponentTurn,
} from '../composables/liveRegionAnnouncer.js';

// ── isMyTurn → polite region ─────────────────────────────────────────────────

describe('announceTurnChange', () => {
  it('returns "Your turn" when isMyTurn becomes true', () => {
    expect(announceTurnChange(true)).toBe('Your turn');
  });

  it('returns empty string when isMyTurn becomes false (turn passed)', () => {
    expect(announceTurnChange(false)).toBe('');
  });
});

// ── connectionStatus → polite region ─────────────────────────────────────────

describe('announceConnectionChange', () => {
  it('returns "Reconnecting…" when status transitions to disconnected', () => {
    expect(announceConnectionChange('disconnected', 'connected')).toBe('Reconnecting…');
  });

  it('returns "Reconnecting…" when status transitions to reconnecting', () => {
    expect(announceConnectionChange('reconnecting', 'connected')).toBe('Reconnecting…');
  });

  it('returns "Reconnected" when status transitions from disconnected to connected', () => {
    expect(announceConnectionChange('connected', 'disconnected')).toBe('Reconnected');
  });

  it('returns "Reconnected" when status transitions from reconnecting to connected', () => {
    expect(announceConnectionChange('connected', 'reconnecting')).toBe('Reconnected');
  });

  it('returns empty string when status is unchanged', () => {
    expect(announceConnectionChange('connected', 'connected')).toBe('');
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

// ── awaitingPlayers → polite region (opponent turn) ──────────────────────────

describe('announceOpponentTurn', () => {
  it('announces the first waiting player by name', () => {
    expect(announceOpponentTurn(['Bob'])).toBe('Bob is playing…');
  });

  it('announces the first name even when multiple players are waiting', () => {
    expect(announceOpponentTurn(['Carol', 'Dave'])).toBe('Carol is playing…');
  });

  it('returns empty string when nobody is waiting', () => {
    expect(announceOpponentTurn([])).toBe('');
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
