/**
 * The AI module's configuration surface: `parseAILevel` (what `--ai <level>`
 * on the CLI turns into) and the `DEFAULT_CONFIG` / `DIFFICULTY_PRESETS` pair
 * every bot is built from.
 */
import { describe, it, expect } from 'vitest';
import { parseAILevel, DEFAULT_CONFIG, DIFFICULTY_PRESETS } from './index.js';

describe('parseAILevel', () => {
  it.each(['easy', 'medium', 'hard'])('passes the preset name %s straight through', (level) => {
    expect(parseAILevel(level)).toBe(level);
  });

  it('reads a bare number as an explicit iteration count', () => {
    expect(parseAILevel('1000')).toBe(1000);
    expect(parseAILevel('1')).toBe(1);
  });

  it('falls back to medium for an unrecognised name', () => {
    expect(parseAILevel('impossible')).toBe('medium');
    expect(parseAILevel('')).toBe('medium');
  });

  it('falls back to medium rather than accepting a nonsensical iteration count', () => {
    expect(parseAILevel('0')).toBe('medium');
    expect(parseAILevel('-50')).toBe('medium');
  });

  it('accepts a numeric string with trailing text as its leading number', () => {
    // parseInt semantics: '500x' is a typo'd count, not a preset name, and
    // 500 is the reading closest to what was typed.
    expect(parseAILevel('500x')).toBe(500);
  });

  it('is case sensitive — an unknown casing falls back rather than guessing', () => {
    expect(parseAILevel('HARD')).toBe('medium');
  });

  it('returns something every preset lookup or bot constructor can consume', () => {
    for (const level of ['easy', 'hard', '750', 'nonsense']) {
      const parsed = parseAILevel(level);
      const usable = typeof parsed === 'number' ? parsed > 0 : parsed in DIFFICULTY_PRESETS;
      expect(usable).toBe(true);
    }
  });
});

describe('DEFAULT_CONFIG', () => {
  it('is a complete BotConfig — every field a bot needs has a value', () => {
    expect(DEFAULT_CONFIG).toEqual({
      iterations: 300,
      playoutDepth: 3,
      async: true,
      timeout: 2000,
    });
  });

  it('bounds every search dimension so a bot cannot run forever', () => {
    expect(DEFAULT_CONFIG.iterations).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.playoutDepth).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.timeout).toBeGreaterThan(0);
  });

  it('supplies every field a preset leaves out', () => {
    // This is what makes DEFAULT_CONFIG load-bearing: `easy` and `medium`
    // declare no `async`, and `easy`/`medium` declare no `parallel`, so a bot
    // built from a preset only gets a complete config because the default fills
    // the gaps. A field silently dropped from the default would leave the bot
    // constructor reading `undefined`.
    for (const [level, preset] of Object.entries(DIFFICULTY_PRESETS)) {
      const merged = { ...DEFAULT_CONFIG, ...preset };
      for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof typeof DEFAULT_CONFIG>) {
        expect(merged[key], `${level} lost ${String(key)}`).toBeDefined();
      }
    }
    expect(DIFFICULTY_PRESETS.easy).not.toHaveProperty('async');
    expect({ ...DEFAULT_CONFIG, ...DIFFICULTY_PRESETS.easy }.async).toBe(DEFAULT_CONFIG.async);
  });
});

describe('DIFFICULTY_PRESETS', () => {
  it('offers the three levels the CLI advertises', () => {
    expect(Object.keys(DIFFICULTY_PRESETS)).toEqual(['easy', 'medium', 'hard']);
  });

  it('gets strictly stronger as the level rises', () => {
    const iterations = ['easy', 'medium', 'hard'].map((l) => DIFFICULTY_PRESETS[l].iterations!);
    const depths = ['easy', 'medium', 'hard'].map((l) => DIFFICULTY_PRESETS[l].playoutDepth!);
    expect(iterations).toEqual([...iterations].sort((a, b) => a - b));
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(new Set(iterations).size).toBe(3);
  });

  it('gives every level a timeout, so no preset can hang a turn', () => {
    for (const [level, preset] of Object.entries(DIFFICULTY_PRESETS)) {
      expect(preset.timeout, `${level} has no timeout`).toBeGreaterThan(0);
    }
  });

  it('merges over DEFAULT_CONFIG into a complete config for every level', () => {
    for (const preset of Object.values(DIFFICULTY_PRESETS)) {
      const merged = { ...DEFAULT_CONFIG, ...preset };
      expect(merged.iterations).toBeGreaterThan(0);
      expect(merged.playoutDepth).toBeGreaterThan(0);
      expect(merged.timeout).toBeGreaterThan(0);
      expect(typeof merged.async).toBe('boolean');
    }
  });

  it("medium matches the default config's search budget", () => {
    expect(DIFFICULTY_PRESETS.medium.iterations).toBe(DEFAULT_CONFIG.iterations);
    expect(DIFFICULTY_PRESETS.medium.playoutDepth).toBe(DEFAULT_CONFIG.playoutDepth);
  });

  it('every preset name parseAILevel can return is a real preset', () => {
    expect(DIFFICULTY_PRESETS[parseAILevel('unknown') as string]).toBeDefined();
  });
});
