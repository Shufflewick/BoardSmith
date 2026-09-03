import { describe, it, expect } from 'vitest';
import { DEFAULT_COLOR_PALETTE } from '../../engine/index.js';
import {
  DevFlagError,
  parsePositiveInt,
  parseBotSeats,
  resolveEffectivePlayerCount,
  validateBotSeats,
  validateBotLevel,
  resolveHost,
  multiplayerBannerLine,
  formatUnknownKeyWarnings,
  shouldOpenBrowser,
  resolvePlayerCount,
  resolveColorPalette,
  parseGameOptionFlags,
  mergeGameOptionDefinitions,
  resolvePreset,
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

describe('validateBotLevel (--bot-level names a real preset or a real count)', () => {
  it.each(['easy', 'medium', 'hard'])('accepts the preset %s', (level) => {
    expect(() => validateBotLevel(level)).not.toThrow();
  });

  it('accepts an explicit iteration count', () => {
    expect(() => validateBotLevel('750')).not.toThrow();
  });

  it('rejects expert, which reads like a preset but never was one', () => {
    expect(() => validateBotLevel('expert')).toThrow(DevFlagError);
    expect(() => validateBotLevel('expert')).toThrow(/--bot-level/);
    expect(() => validateBotLevel('expert')).toThrow(/easy, medium, hard/);
  });

  it('rejects a nonsensical count rather than starting at some other strength', () => {
    expect(() => validateBotLevel('0')).toThrow(DevFlagError);
    expect(() => validateBotLevel('-5')).toThrow(DevFlagError);
  });
});

describe('parseBotSeats (CLIX-06: fail-fast --bot parsing, no silent filtering)', () => {
  it('throws an actionable DevFlagError on a non-numeric --bot value instead of silently dropping it', () => {
    expect(() => parseBotSeats(['abc'])).toThrow(DevFlagError);
    expect(() => parseBotSeats(['abc'])).toThrow(/--bot/);
  });

  it('throws when any comma-separated entry is non-numeric', () => {
    expect(() => parseBotSeats(['1,abc,3'])).toThrow(DevFlagError);
  });

  it('parses comma-separated and repeated --bot flags into a flat seat list', () => {
    expect(parseBotSeats(['1,2'])).toEqual([1, 2]);
    expect(parseBotSeats(['1', '2'])).toEqual([1, 2]);
  });

  it('returns an empty list when --bot was not passed', () => {
    expect(parseBotSeats(undefined)).toEqual([]);
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

describe('validateBotSeats (CLIX-06/F34: validated against the effective post-resolution count)', () => {
  it('accepts bot seats within the effective player count', () => {
    expect(() => validateBotSeats([1, 2], 2)).not.toThrow();
  });

  it('rejects bot seats beyond the effective (not a stale raw) player count', () => {
    // Pitfall 3 regression: a seat that would have passed against a raw
    // pre-clamp playerCount must still be rejected once validated against
    // the effective (post-resolution) count.
    expect(() => validateBotSeats([5], 2)).toThrow(DevFlagError);
    expect(() => validateBotSeats([5], 2)).toThrow(/1 to 2/);
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
    // class of defect this phase removed from --bot/--players.
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
    expect(formatUnknownKeyWarnings({ name: 'x', displayName: 'X', description: 'd', asyncPlay: true })).toEqual([]);
  });
});

describe('resolvePlayerCount (D14/DEVHOST-02: default --players to gameDefinition.minPlayers, not a literal 2)', () => {
  it('defaults to minPlayers=1 for a solo game when --players is unset (bare `dev` on minPlayers=1,maxPlayers=1 must NOT error)', () => {
    expect(resolvePlayerCount(undefined, 1, 1)).toBe(1);
  });

  it('defaults to minPlayers=2 when --players is unset on a min=2 game', () => {
    expect(resolvePlayerCount(undefined, 2, 4)).toBe(2);
  });

  it('still ERRORS naming the bound when an EXPLICIT --players is out of range (range-check not weakened)', () => {
    expect(() => resolvePlayerCount('5', 1, 1)).toThrow(DevFlagError);
    expect(() => resolvePlayerCount('5', 1, 1)).toThrow(/1/);
  });
});

describe('resolveColorPalette (D16/DEVHOST-04: gameDefinition.colorPalette -> boardsmith.json -> engine default)', () => {
  it('honors gameDefinition.colorPalette when config has none', () => {
    const palette = resolveColorPalette(
      { colorPalette: [{ id: 'a', hex: '#111111', label: 'A' }] },
      {},
    );
    expect(palette).toEqual([{ value: '#111111', label: 'A' }]);
  });

  it('prefers gameDefinition.colorPalette over boardsmith.json config.colorPalette', () => {
    const palette = resolveColorPalette(
      { colorPalette: [{ id: 'a', hex: '#222222', label: 'A' }] },
      { colorPalette: [{ value: '#999999', label: 'Config' }] },
    );
    expect(palette).toEqual([{ value: '#222222', label: 'A' }]);
  });

  it('falls back to the engine DEFAULT_COLOR_PALETTE when neither source declares a palette', () => {
    const palette = resolveColorPalette({}, {});
    expect(palette.map((p) => p.value)).toEqual([...DEFAULT_COLOR_PALETTE]);
  });
});

describe('parseGameOptionFlags (D13/DEVHOST-01: repeatable `--game-option key=value`)', () => {
  it('splits each entry on the FIRST "=" into a flat record', () => {
    expect(parseGameOptionFlags(['difficulty=hard', 'rounds=5'])).toEqual({
      difficulty: 'hard',
      rounds: '5',
    });
  });

  it('splits only on the first "=" (value may itself contain "=")', () => {
    expect(parseGameOptionFlags(['note=a=b'])).toEqual({ note: 'a=b' });
  });

  it('throws an actionable DevFlagError on an entry missing "="', () => {
    expect(() => parseGameOptionFlags(['difficulty'])).toThrow(DevFlagError);
    expect(() => parseGameOptionFlags(['difficulty'])).toThrow(/--game-option/);
    expect(() => parseGameOptionFlags(['difficulty'])).toThrow(/"difficulty"/);
  });

  it('returns an empty record when no flags were passed', () => {
    expect(parseGameOptionFlags(undefined)).toEqual({});
    expect(parseGameOptionFlags([])).toEqual({});
  });
});

describe('mergeGameOptionDefinitions (D13: gameDefinition.gameOptions merged with boardsmith.json, gameDefinition authoritative)', () => {
  it('keeps both keys when the two sources are disjoint', () => {
    const merged = mergeGameOptionDefinitions(
      { fromGameDef: { type: 'boolean', label: 'From Game Def', default: true } },
      { fromConfig: { type: 'boolean', label: 'From Config', default: false } },
    );
    expect(Object.keys(merged).sort()).toEqual(['fromConfig', 'fromGameDef']);
  });

  it('the gameDefinition definition wins on a key conflict', () => {
    const merged = mergeGameOptionDefinitions(
      { difficulty: { type: 'select', label: 'GameDef', default: 'hard', choices: [{ value: 'hard', label: 'Hard' }] } },
      { difficulty: { type: 'select', label: 'Config', default: 'easy', choices: [{ value: 'easy', label: 'Easy' }] } },
    );
    expect(merged.difficulty.label).toBe('GameDef');
    expect(merged.difficulty.default).toBe('hard');
  });

  it('handles either source being undefined', () => {
    expect(mergeGameOptionDefinitions(undefined, undefined)).toEqual({});
    expect(Object.keys(mergeGameOptionDefinitions({ a: { type: 'boolean', label: 'A' } }, undefined))).toEqual(['a']);
  });

  it('adversarial: a game-definition-only option survives even when boardsmith.json declares a DIFFERENT set', () => {
    // Regression for the old replace-not-merge spread (`...(gameOptions &&
    // { gameOptions })`) at dev.ts:557 — a boardsmith.json declaring ANY
    // gameOptions used to silently drop every gameDefinition-only option.
    const merged = mergeGameOptionDefinitions(
      { onlyInGameDef: { type: 'boolean', label: 'Only game-def', default: true } },
      { onlyInConfig: { type: 'boolean', label: 'Only config', default: false } },
    );
    expect(merged.onlyInGameDef).toBeDefined();
    expect(merged.onlyInConfig).toBeDefined();
  });
});

describe('resolvePreset (D13: applying a preset returns its options bundle + optional player count)', () => {
  const presets = [
    { name: 'advanced', description: 'Advanced setup', options: { difficulty: 'hard', rounds: 5 }, players: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }] },
    { name: 'quick', options: { rounds: 1 } },
  ];

  it('returns the named preset\'s options bundle', () => {
    expect(resolvePreset(presets, 'quick').options).toEqual({ rounds: 1 });
  });

  it('returns the preset\'s player count when it declares `players`', () => {
    const resolved = resolvePreset(presets, 'advanced');
    expect(resolved.options).toEqual({ difficulty: 'hard', rounds: 5 });
    expect(resolved.playerCount).toBe(3);
  });

  it('omits playerCount when the preset does not declare `players`', () => {
    expect(resolvePreset(presets, 'quick').playerCount).toBeUndefined();
  });

  it('throws an actionable DevFlagError naming the unknown preset and the declared names', () => {
    expect(() => resolvePreset(presets, 'nope')).toThrow(DevFlagError);
    expect(() => resolvePreset(presets, 'nope')).toThrow(/"nope"/);
    expect(() => resolvePreset(presets, 'nope')).toThrow(/advanced/);
    expect(() => resolvePreset(presets, 'nope')).toThrow(/quick/);
  });
});

describe('shouldOpenBrowser (138: --no-open opts out of auto-launching a real browser tab)', () => {
  it('defaults to true when --no-open was not passed', () => {
    expect(shouldOpenBrowser({})).toBe(true);
  });

  it('is false when --no-open sets options.open to false', () => {
    // Commander's negatable-option convention: `--no-open` sets `options.open = false`.
    expect(shouldOpenBrowser({ open: false })).toBe(false);
  });

  it('stays true when options.open is explicitly true', () => {
    expect(shouldOpenBrowser({ open: true })).toBe(true);
  });
});
