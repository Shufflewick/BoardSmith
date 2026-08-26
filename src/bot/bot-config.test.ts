/**
 * The bot module's configuration surface: `parseBotLevel` (what `--bot <level>`
 * on the CLI turns into) and the `DEFAULT_CONFIG` / `DIFFICULTY_PRESETS` pair
 * every bot is built from.
 */
import { describe, it, expect } from 'vitest';
import { parseBotLevel, DEFAULT_CONFIG, DIFFICULTY_PRESETS } from './index.js';

describe('parseBotLevel', () => {
  it.each(['easy', 'medium', 'hard'])('passes the preset name %s straight through', (level) => {
    expect(parseBotLevel(level)).toBe(level);
  });

  it('reads a bare number as an explicit iteration count', () => {
    expect(parseBotLevel('1000')).toBe(1000);
    expect(parseBotLevel('1')).toBe(1);
  });

  it('rejects an unrecognised name instead of quietly playing at medium', () => {
    // `expert` is the one people actually type: it reads like a fourth preset
    // and used to degrade to medium without a word.
    expect(() => parseBotLevel('expert')).toThrow(/expert/);
    expect(() => parseBotLevel('expert')).toThrow(/easy, medium, hard/);
    expect(() => parseBotLevel('impossible')).toThrow();
    expect(() => parseBotLevel('')).toThrow();
  });

  it('rejects a nonsensical iteration count rather than substituting a preset', () => {
    expect(() => parseBotLevel('0')).toThrow();
    expect(() => parseBotLevel('-50')).toThrow();
  });

  it('rejects a numeric string with trailing text rather than guessing a count', () => {
    expect(() => parseBotLevel('500x')).toThrow();
  });

  it('is case sensitive — an unknown casing is an error, not a guess', () => {
    expect(() => parseBotLevel('HARD')).toThrow(/HARD/);
  });

  it('returns something every preset lookup or bot constructor can consume', () => {
    for (const level of ['easy', 'hard', '750']) {
      const parsed = parseBotLevel(level);
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

  it('every preset name parseBotLevel can return is a real preset', () => {
    for (const name of Object.keys(DIFFICULTY_PRESETS)) {
      expect(DIFFICULTY_PRESETS[parseBotLevel(name) as string]).toBeDefined();
    }
  });
});
