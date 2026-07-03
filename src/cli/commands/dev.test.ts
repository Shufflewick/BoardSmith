import { describe, it, expect } from 'vitest';
import {
  DevFlagError,
  parsePositiveInt,
  parseAiSeats,
  resolveEffectivePlayerCount,
  validateAiSeats,
  resolveHost,
  multiplayerBannerLine,
  formatUnknownKeyWarnings,
} from './dev.js';

/**
 * PROC-02 regressions for CLIX-01/CLIX-02/CLIX-04/CLIX-06 (135-06-PLAN.md).
 *
 * These tests exercise pure helpers extracted from `devCommand` so the
 * fail-fast / host-resolution / unknown-key behavior is asserted without
 * binding any real socket (no Vite server, no WebSocketServer) — matching
 * simulate.test.ts's arg-validation style (135-06-PLAN.md read_first).
 */

describe('parsePositiveInt (CLIX-06: fail-fast numeric flags)', () => {
  it('throws an actionable DevFlagError on a non-numeric --players value', () => {
    expect(() => parsePositiveInt('players', 'abc')).toThrow(DevFlagError);
    expect(() => parsePositiveInt('players', 'abc')).toThrow(/--players/);
    expect(() => parsePositiveInt('players', 'abc')).toThrow(/"abc"/);
  });

  it('throws an actionable DevFlagError on a non-numeric --port value', () => {
    expect(() => parsePositiveInt('port', 'xyz')).toThrow(DevFlagError);
    expect(() => parsePositiveInt('port', 'xyz')).toThrow(/--port/);
  });

  it('throws on zero/negative values (not a positive integer)', () => {
    expect(() => parsePositiveInt('players', '0')).toThrow(DevFlagError);
    expect(() => parsePositiveInt('players', '-1')).toThrow(DevFlagError);
  });

  it('returns the parsed integer for valid input', () => {
    expect(parsePositiveInt('players', '3')).toBe(3);
    expect(parsePositiveInt('port', '5173')).toBe(5173);
  });
});

describe('parseAiSeats (CLIX-06: fail-fast --ai parsing, no silent filtering)', () => {
  it('throws an actionable DevFlagError on a non-numeric --ai value instead of silently dropping it', () => {
    expect(() => parseAiSeats(['abc'])).toThrow(DevFlagError);
    expect(() => parseAiSeats(['abc'])).toThrow(/--ai/);
  });

  it('throws when any comma-separated entry is non-numeric', () => {
    expect(() => parseAiSeats(['1,abc,3'])).toThrow(DevFlagError);
  });

  it('parses comma-separated and repeated --ai flags into a flat seat list', () => {
    expect(parseAiSeats(['1,2'])).toEqual([1, 2]);
    expect(parseAiSeats(['1', '2'])).toEqual([1, 2]);
  });

  it('returns an empty list when --ai was not passed', () => {
    expect(parseAiSeats(undefined)).toEqual([]);
  });
});

describe('resolveEffectivePlayerCount (CLIX-06: error, not clamp, on out-of-range --players)', () => {
  it('errors naming the game max when --players exceeds maxPlayers (no silent clamp)', () => {
    expect(() => resolveEffectivePlayerCount(6, 2, 4)).toThrow(DevFlagError);
    expect(() => resolveEffectivePlayerCount(6, 2, 4)).toThrow(/4/);
  });

  it('errors naming the game min when --players is below minPlayers', () => {
    expect(() => resolveEffectivePlayerCount(1, 2, 4)).toThrow(DevFlagError);
    expect(() => resolveEffectivePlayerCount(1, 2, 4)).toThrow(/2/);
  });

  it('returns playerCount unchanged when it is within [minPlayers, maxPlayers]', () => {
    expect(resolveEffectivePlayerCount(3, 2, 4)).toBe(3);
  });
});

describe('validateAiSeats (CLIX-06/F34: validated against the effective post-resolution count)', () => {
  it('accepts AI seats within the effective player count', () => {
    expect(() => validateAiSeats([1, 2], 2)).not.toThrow();
  });

  it('rejects AI seats beyond the effective (not a stale raw) player count', () => {
    // Pitfall 3 regression: a seat that would have passed against a raw
    // pre-clamp playerCount must still be rejected once validated against
    // the effective (post-resolution) count.
    expect(() => validateAiSeats([5], 2)).toThrow(DevFlagError);
    expect(() => validateAiSeats([5], 2)).toThrow(/1 to 2/);
  });
});

describe('resolveHost (CLIX-04: default 127.0.0.1, --lan/--host 0.0.0.0 opts into LAN exposure)', () => {
  it('defaults to 127.0.0.1 (local-only) when neither --host nor --lan is passed', () => {
    const { host, isNonLocal } = resolveHost({});
    expect(host).toBe('127.0.0.1');
    expect(isNonLocal).toBe(false);
  });

  it('resolves --lan to 0.0.0.0 and flags it as non-local', () => {
    const { host, isNonLocal } = resolveHost({ lan: true });
    expect(host).toBe('0.0.0.0');
    expect(isNonLocal).toBe(true);
  });

  it('resolves an explicit --host 0.0.0.0 as non-local', () => {
    const { host, isNonLocal } = resolveHost({ host: '0.0.0.0' });
    expect(host).toBe('0.0.0.0');
    expect(isNonLocal).toBe(true);
  });

  it('does not flag an explicit --host 127.0.0.1 as non-local', () => {
    const { host, isNonLocal } = resolveHost({ host: '127.0.0.1' });
    expect(host).toBe('127.0.0.1');
    expect(isNonLocal).toBe(false);
  });

  it('errors when --lan and --host are combined instead of silently dropping --lan (WR-04)', () => {
    // Pre-fix, `--lan --host 127.0.0.1` bound local-only and dropped the
    // security-relevant --lan without any notice — the same silent-ignore
    // class of defect this phase removed from --ai/--players.
    expect(() => resolveHost({ lan: true, host: '127.0.0.1' })).toThrow(DevFlagError);
    expect(() => resolveHost({ lan: true, host: '127.0.0.1' })).toThrow(/--lan/);
    expect(() => resolveHost({ lan: true, host: '127.0.0.1' })).toThrow(/--host/);
  });

  it('errors even when --lan and --host agree — pass one or the other', () => {
    expect(() => resolveHost({ lan: true, host: '0.0.0.0' })).toThrow(DevFlagError);
  });
});

describe('multiplayerBannerLine (WR-01: banner must not tell local-only users to join from another computer)', () => {
  it('points local-only binds at --lan instead of the impossible "another computer" instruction', () => {
    const line = multiplayerBannerLine(false);
    expect(line).toContain('--lan');
    expect(line).not.toContain('another computer to join');
  });

  it('keeps the join-from-another-computer instruction for non-local binds', () => {
    expect(multiplayerBannerLine(true)).toContain('open the page on another computer to join');
  });
});

describe('formatUnknownKeyWarnings (CLIX-02: dev startup warns loudly, does not exit)', () => {
  it('returns a warning naming the unknown key and its suggestion', () => {
    const warnings = formatUnknownKeyWarnings({ name: 'x', displayName: 'X', description: 'd', gameOption: [] });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/gameOption/);
    expect(warnings[0]).toMatch(/gameOptions/);
  });

  it('returns no warnings for a clean config with only allowed keys', () => {
    const warnings = formatUnknownKeyWarnings({ name: 'x', displayName: 'X', description: 'd' });
    expect(warnings).toEqual([]);
  });
});
