import { describe, it, expect } from 'vitest';
import {
  describeMoveDestination,
  describeMoveForNarration,
  describeMoveForHint,
} from './move-summary.js';

describe('move-summary', () => {
  describe('describeMoveDestination', () => {
    it('formats a from→to capture object (checkers move destination)', () => {
      const args = { piece: 93, destination: { pieceId: 93, fromNotation: 'c5', toNotation: 'a3', isCapture: true } };
      expect(describeMoveDestination(args)).toBe('c5 → a3 (capture)');
    });

    it('formats a to-only object (no capture, no from)', () => {
      expect(describeMoveDestination({ destination: { toNotation: 'f4' } })).toBe('f4');
    });

    it('formats a plain notation string under a destination-like key', () => {
      expect(describeMoveDestination({ to: 'e5' })).toBe('e5');
    });

    it('returns null when only a raw element id is present (never leaks ids)', () => {
      expect(describeMoveDestination({ piece: 93 })).toBeNull();
      expect(describeMoveDestination({ card: { id: 7 } })).toBeNull();
    });

    it('returns null for no args', () => {
      expect(describeMoveDestination({})).toBeNull();
    });
  });

  describe('describeMoveForNarration', () => {
    it('produces a readable move line, not JSON', () => {
      const args = { piece: 93, destination: { fromNotation: 'c5', toNotation: 'a3', isCapture: true } };
      expect(describeMoveForNarration(1, 'move', args)).toBe('Player 1: move c5 → a3 (capture)');
    });

    it('falls back to "Player N: <action>" when no readable destination exists', () => {
      expect(describeMoveForNarration(2, 'pass', { piece: 93 })).toBe('Player 2: pass');
    });
  });

  describe('describeMoveForHint', () => {
    it('produces "Suggested: <dest>" when a destination is readable', () => {
      expect(describeMoveForHint({ destination: { toNotation: 'a3', isCapture: true } })).toBe('Suggested: a3 (capture)');
    });

    it('falls back to "Suggested move" when no readable destination exists', () => {
      expect(describeMoveForHint({ piece: 93 })).toBe('Suggested move');
    });
  });
});
