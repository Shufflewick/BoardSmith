import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COLOR_PALETTE } from '../../engine/index.js';
import {
  assertWorldProjectForReset,
  devCommand,
  parseSeedFile,
  parseBotSeats,
  resolveEffectivePlayerCount,
  validateBotSeats,
  validateBotLevel,
  resolveHost,
  multiplayerBannerLine,
  formatUnknownKeyWarnings,
  shouldOpenBrowser,
  resolvePlayerCount,
  resolveColorOption,
  parseGameOptionFlags,
  resolvePreset,
} from './dev.js';
import { describeTableReload, tableShapeChange } from './dev-table-runtime.js';
import { createColorOption, type OpSuccess } from '../../session/index.js';
import { hostHoldings } from '../dev-host/shutdown.js';

// Counts the shared cleanup runs, so a refusal can be shown to go through it.
const cleanups = vi.hoisted(() => ({ runs: 0 }));
vi.mock('../dev-host/shutdown.js', async (importOriginal) => {
  const shutdown = await importOriginal<typeof import('../dev-host/shutdown.js')>();
  return {
    ...shutdown,
    hostHoldings: (...args: Parameters<typeof hostHoldings>) => {
      const holdings = shutdown.hostHoldings(...args);
      const run = holdings.run;
      return { ...holdings, run: () => { cleanups.runs += 1; return run(); } };
    },
  };
});

/**
 * PROC-02 regressions for CLIX-01/CLIX-02/CLIX-04/CLIX-06 (135-06-PLAN.md).
 *
 * These tests exercise pure helpers extracted from `devCommand` so the
 * fail-fast / host-resolution / unknown-key behavior is asserted without
 * binding any real socket (no Vite server, no WebSocketServer) — matching
 * simulate.test.ts's arg-validation style (135-06-PLAN.md read_first).
 */

const NOT_POSITIVE_WHOLE = ['0', '-1', '1.5', '1e3', '12abc', ''];

/** What `refuse` throws, checked to be exactly `message` on a plain Error, the one style `cli.ts` prints as one line. */
function expectRefusal(refuse: () => unknown, message: string): void {
  let refusal: unknown;
  try { refuse(); } catch (error) { refusal = error; }
  expect(refusal).toBeInstanceOf(Error);
  expect((refusal as Error).constructor).toBe(Error);
  expect((refusal as Error).message).toBe(message);
}

/** devCommand rejects with exactly `message`, as a plain Error `cli.ts` prints as one line. */
async function expectDevRefusal(options: Parameters<typeof devCommand>[0], message: string): Promise<void> {
  const listening = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
  try {
    const refusal = await devCommand(options).then(() => undefined, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).constructor).toBe(Error);
    expect((refusal as Error).message).toBe(message);
  } finally {
    // devCommand installs its Ctrl+C handlers first and never removes them; a test run must not keep them.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const handler of process.listeners(signal)) if (!listening[signal].includes(handler)) process.off(signal, handler);
    }
  }
}

describe('dev refuses a count flag that is not a positive whole number (#1047)', () => {
  it.each(NOT_POSITIVE_WHOLE)('--players "%s" is refused by name', (raw) => {
    expect(() => resolvePlayerCount(raw, 1, 2000)).toThrow(`--players takes a positive whole number, got "${raw}".`);
  });

  it.each(NOT_POSITIVE_WHOLE)('--bot "%s" is refused by name', (raw) => {
    expect(() => parseBotSeats([`1,${raw}`])).toThrow(`--bot takes a positive whole number, got "${raw}".`);
  });

  it.each(NOT_POSITIVE_WHOLE)('--port "%s" is refused by name before any server work', async (raw) => {
    await expectDevRefusal({ port: raw }, `--port takes a positive whole number, got "${raw}".`);
  });

  it.each(['65536', '70000', '99999999999999999999'])('--port "%s" above 65535 is refused before any server work (#1119)', async (raw) => {
    await expectDevRefusal({ port: raw }, `--port takes a port number from 1 to 65535, got "${raw}".`);
  });

  it('takes a positive whole number', () => {
    expect(resolvePlayerCount('3', 1, 4)).toBe(3);
  });
});

describe('every dev flag refusal is a plain one-line Error naming the flag, what it takes and what it got (#1126)', () => {
  it('--port a browser blocks is refused, through the shared cleanup, without exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) was called`);
    });
    const before = cleanups.runs;
    try {
      await expectDevRefusal(
        { port: '6000' },
        '--port takes a port browsers allow, got "6000", which browsers block for security. ' +
          'Try 5173, 3000, 8080, or another port above 1024 that browsers do not block.',
      );
      expect(exit).not.toHaveBeenCalled();
      expect(cleanups.runs).toBe(before + 1);
    } finally {
      exit.mockRestore();
    }
  });

  it('--seed with no file there', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bs-seed-')), 'missing.json');
    expectRefusal(() => parseSeedFile(path), `--seed takes a recorded game state JSON file, got "${path}", which does not exist.`);
  });

  it('--seed naming something that cannot be read as a file', () => {
    const path = mkdtempSync(join(tmpdir(), 'bs-seed-'));
    let reason = '';
    try { readFileSync(path, 'utf-8'); } catch (error) { reason = (error as Error).message; }
    expectRefusal(() => parseSeedFile(path), `--seed takes a recorded game state JSON file, got "${path}", which could not be read: ${reason}.`);
  });

  it('--seed naming a file that is not JSON', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bs-seed-')), 'seed.json');
    writeFileSync(path, 'not json');
    let reason = '';
    try { JSON.parse('not json'); } catch (error) { reason = (error as Error).message; }
    expectRefusal(() => parseSeedFile(path), `--seed takes a recorded game state JSON file, got "${path}", which is not valid JSON: ${reason}.`);
  });

  it('--preset naming a preset the game does not declare', () => {
    expectRefusal(
      () => resolvePreset([{ name: 'advanced', options: {} }, { name: 'quick', options: {} }], 'nope'),
      '--preset takes a preset this game declares (advanced, quick), got "nope".',
    );
  });

  it('--preset on a game that declares none', () => {
    expectRefusal(() => resolvePreset(undefined, 'nope'), '--preset takes a preset this game declares (it declares none), got "nope".');
  });

  it.each(['expert', '0', '-5', '100001'])('--bot-level "%s"', (level) => {
    expectRefusal(() => validateBotLevel(level), `--bot-level takes easy, medium, hard or an iteration count from 1 to 100000, got "${level}".`);
  });

  it('--reset on a project with no world', () => {
    expectRefusal(
      () => assertWorldProjectForReset(false),
      '--reset takes a project that declares "backend": "world" in boardsmith.json, got one that does not, so there is no world to delete. ' +
        'A table game keeps its cross-session state in .boardsmith-dev-store.json; delete that file directly if that is what you meant.',
    );
  });

  it('--bot naming a seat the game does not have', () => {
    expectRefusal(() => validateBotSeats([3, 5], 2), '--bot takes seats from 1 to 2 for this game, got "3,5".');
  });

  it('--lan together with --host', () => {
    expectRefusal(
      () => resolveHost({ lan: true, host: '127.0.0.1' }),
      '--lan takes no --host, since it is shorthand for --host 0.0.0.0, got --host 127.0.0.1. Pass one or the other.',
    );
  });

  it('--game-option without "="', () => {
    expectRefusal(() => parseGameOptionFlags(['difficulty']), '--game-option takes "key=value", got "difficulty".');
  });
});

describe('validateBotLevel (--bot-level names a real preset or a real count)', () => {
  it.each(['easy', 'medium', 'hard'])('accepts the preset %s', (level) => {
    expect(() => validateBotLevel(level)).not.toThrow();
  });

  it('accepts an explicit iteration count', () => {
    expect(() => validateBotLevel('750')).not.toThrow();
  });

});

describe('parseBotSeats (CLIX-06: fail-fast --bot parsing, no silent filtering)', () => {
  it('parses comma-separated and repeated --bot flags into a flat seat list', () => {
    expect(parseBotSeats(['1,2'])).toEqual([1, 2]);
    expect(parseBotSeats(['1', '2'])).toEqual([1, 2]);
  });

  it('returns an empty list when --bot was not passed', () => {
    expect(parseBotSeats(undefined)).toEqual([]);
  });
});

describe('resolveEffectivePlayerCount (CLIX-06: error, not clamp, on out-of-range --players)', () => {
  // One style for every --players refusal (#1119): the shared number check's wording, as a plain Error.
  it.each([[6, 2, 4], [1, 2, 4]])('refuses --players %i for a %i-%i game in the shared style', (count, min, max) => {
    expectRefusal(() => resolveEffectivePlayerCount(count, min, max), `--players takes a whole number from ${min} to ${max} for this game, got "${count}".`);
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
    expectRefusal(() => validateBotSeats([5], 2), '--bot takes seats from 1 to 2 for this game, got "5".');
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
    expect(() => resolveHost({ lan: true, host: '127.0.0.1' })).toThrow(/^--lan takes no --host/);
  });

  it('errors even when --lan and --host agree — pass one or the other', () => {
    expect(() => resolveHost({ lan: true, host: '0.0.0.0' })).toThrow(/^--lan takes no --host/);
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
    expect(() => resolvePlayerCount('5', 1, 1)).toThrow('--players takes a whole number from 1 to 1 for this game, got "5".');
  });
});

describe('resolveColorOption: dev offers exactly the colours production does (#814)', () => {
  const engineDefault = createColorOption();
  const configPalette = { colorPalette: [{ id: 'coal', hex: '#111111', label: 'Coal' }, { id: 'snow', hex: '#EEEEEE', label: 'Snow' }] };

  it('offers boardsmith.json\'s colorPalette, as the published manifest does', () => {
    expect(resolveColorOption({}, configPalette)).toEqual({
      type: 'color',
      label: 'Color',
      choices: [{ value: '#111111', label: 'Coal' }, { value: '#EEEEEE', label: 'Snow' }],
    });
  });

  it('falls back to the engine palette, named, when boardsmith.json declares none', () => {
    const option = resolveColorOption({}, {});
    expect(option.choices.map((p) => p.value)).toEqual([...DEFAULT_COLOR_PALETTE]);
    expect(option.choices).toContainEqual({ value: '#2c3e50', label: 'Black' });
  });

  it('refuses a code colour option that differs from boardsmith.json\'s colorPalette (MERC\'s case)', () => {
    expect(() => resolveColorOption({ playerOptions: { color: createColorOption() } }, configPalette)).toThrow(
      /playerOptions\.color.*boardsmith\.json's "colorPalette".*remove/s,
    );
  });

  it('refuses a code colour option that differs from the engine palette when boardsmith.json declares none', () => {
    const declared = createColorOption([{ value: '#111111', label: 'Coal' }]);
    expect(() => resolveColorOption({ playerOptions: { color: declared } }, {})).toThrow(
      /engine's default palette/,
    );
  });

  it('accepts a code colour option equal to the palette production offers, hex case aside', () => {
    const declared = createColorOption([{ value: '#111111', label: 'Coal' }, { value: '#eeeeee', label: 'Snow' }]);
    expect(resolveColorOption({ playerOptions: { color: declared } }, configPalette).choices).toEqual(
      resolveColorOption({}, configPalette).choices,
    );
    expect(resolveColorOption({ playerOptions: { color: createColorOption() } }, {})).toEqual(engineDefault);
  });

  it('refuses a `color` player option that is not a colour option with choices', () => {
    expect(() =>
      resolveColorOption({ playerOptions: { color: { type: 'select', label: 'Color', choices: ['red'] } } }, {}),
    ).toThrow(/playerOptions\.color/);
    expect(() => resolveColorOption({ playerOptions: { color: { type: 'color', label: 'Color' } } }, {})).toThrow(
      /playerOptions\.color/,
    );
  });

  it('refuses a code gameDefinition.colorPalette that differs from what production offers', () => {
    expect(() =>
      resolveColorOption({ colorPalette: [{ id: 'a', hex: '#222222', label: 'A' }] }, configPalette),
    ).toThrow(/colorPalette.*boardsmith\.json/s);
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

  it('returns an empty record when no flags were passed', () => {
    expect(parseGameOptionFlags(undefined)).toEqual({});
    expect(parseGameOptionFlags([])).toEqual({});
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

  it('refuses an unknown preset, naming the declared ones', () => {
    expectRefusal(() => resolvePreset(presets, 'nope'), '--preset takes a preset this game declares (advanced, quick), got "nope".');
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


/**
 * #167: A WORLD PROJECT WITH NO TABLE HALF IS THE NORMAL SHAPE NOW.
 *
 * `worldWithoutTableRefusal` used to stop this command opening a browser on a
 * blank page for a project scaffolded by `boardsmith init --world`: the dev
 * host served `src/main.ts` and a world-only project has none, so the one
 * script on the page was a 404 and the screen looked exactly like a world with
 * nothing in it.
 *
 * The refusal is gone because the premise is: `devCommand` branches to
 * `startWorldDevServer` for any project whose manifest declares a `world`
 * block, and that server serves the world's own surface. It never reads
 * `src/main.ts` at all, so there is nothing left to refuse. What replaces the
 * assertions is `dev-world.test.ts`, on the server that took the road.
 */

/**
 * #343: THE TABLE ROAD RELOADS ITS RULES ON A SAVE, through the watcher the
 * world road uses (#201). `multiplayer-host.rules-reload.test.ts` drives the
 * reload itself; `dev-server.test.ts` drives the watcher. What is held here is
 * what the terminal says, and that `devCommand` actually wires the two together.
 */
describe('#343: a table reloads its rules when they are saved', () => {
  const source = readFileSync(fileURLToPath(new URL('./dev.ts', import.meta.url)), 'utf-8');
  const table = { gameType: 'counter', minPlayers: 2, maxPlayers: 4 };

  it('devCommand watches the rules and hands every edit to the running host, through the queue its pages use', () => {
    // The queue's own behaviour is driven over real sockets in
    // `multiplayer-host.rules-reload.test.ts` (#379); what is read here is that
    // devCommand builds one queue and gives it to both the watcher and the socket.
    const built = source.indexOf('const rulesReload = tableRulesReloadQueue({');
    expect(built).toBeGreaterThan(-1);
    expect(source.indexOf('host: mpHost', built)).toBeGreaterThan(built);
    expect(source).toContain('queue: rulesReload,');
    expect(source).toContain('reloadOnRulesEdit({ vite, rulesDir: rulesPath, cwd, queue: rulesReload });');
  });

  it('takes an edit that keeps the table the same shape', () => {
    expect(tableShapeChange(table, { ...table })).toBeNull();
  });

  it('refuses an edit to the seat range by name, and says how to use it', () => {
    const said = tableShapeChange(table, { ...table, maxPlayers: 5 });
    expect(said).toContain('seat range (from 2-4 to 2-5)');
    expect(said).toContain('still running the rules it had');
    expect(said).toContain('start it again');
  });

  it('refuses an edit to the game type by name', () => {
    expect(tableShapeChange(table, { ...table, gameType: 'tally' })).toContain('gameType (from "counter" to "tally")');
  });

  it('says what became of the game', () => {
    expect(describeTableReload(null)).toContain('next game starts on the edited rules');
    const result = { success: true } as const;
    expect(describeTableReload({ kind: 'restored', result: { ...emptyResult, ...result } })).toContain(
      'goes on from where it was',
    );
    const replayed = describeTableReload({
      kind: 'replayed',
      restoreError: 'Flow position invalid: out of bounds',
      moves: 3,
      result: { ...emptyResult, ...result },
    });
    expect(replayed).toContain('Flow position invalid: out of bounds');
    expect(replayed).toContain('replaying its 3 moves');
    // The host has already said so, loudly, to the terminal and every page.
    expect(describeTableReload({ kind: 'failed', reason: 'no' })).toBeNull();
  });
});

/** The restored game. `describeTableReload` reads only what became of it, never the game itself. */
const emptyResult = {} as Omit<OpSuccess<'start'>, 'success'>;
