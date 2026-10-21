/**
 * The in-browser smoke check (#453), run for real: the seeds a walk deals from (#460).
 * smoke-walk.test-helper.ts says how each walk runs. The check's tests are split across the
 * smoke*.test.ts files so they run side by side (#1319).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SMOKE_SEEDS_ENV } from '../../testing/browser-smoke-verdict.js';
import { runSmoke } from './smoke.js';
import { smokeProject } from './smoke-project.test-helper.js';
import { quiet, smokeIn, smokeOf } from './smoke-walk.test-helper.js';
import { ACE_SEEDS, aceGame, smokeSpec } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

afterEach(() => vi.unstubAllEnvs());

describe('boardsmith verify: the smoke check', () => {
  it(
    '#460: deals each game from the seeds the spec lists, walking each in turn, reaches an action only one deal offers, ' +
      'and takes the same steps on a second run',
    async () => {
      const dir = await smokeProject(false, {
        ...aceGame(),
        'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: [ACE_SEEDS.WITHOUT, ACE_SEEDS.WITH], steps: 20 }),
      });

      const first = await smokeIn(dir);
      const second = await smokeIn(dir);

      expect(first.outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "blank", then from seed "0", a seated player took "draw", "play", "showAce" and pressed \d+ board controls?, with no error\./,
      );
      expect(first.outcome.passed).toBe(true);
      // The steps name the cards each choice pressed, so the same steps are the same deals walked the same way.
      expect(first.steps).toContain('smoke: dealing a game from seed "blank"');
      expect(first.steps.some((line) => /pressing "[^"]+" for "play"/.test(line))).toBe(true);
      expect(second.steps).toEqual(first.steps);
    },
  );

  it('#460: `boardsmith smoke --seed` deals from the seeds it names instead of the spec\'s', async () => {
    const dir = await smokeProject(false, {
      ...aceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 20 }),
    });
    const { outcome } = await runSmoke({ projectDir: dir, log: quiet, seeds: [ACE_SEEDS.WITH] });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "0", a seated player took "draw", "play", "showAce"/);
    expect(outcome.passed).toBe(true);
  });

  it('#460: fails a walk whose only deal does not offer a listed action, saying to choose a seed whose deal does, and deals from the spec\'s seed whatever seeds the environment names', async () => {
    // A `boardsmith smoke --seed` run hands its walk the seeds in this variable; a check run inside
    // it (a game's own test suite running `boardsmith verify`, say) must not inherit them.
    vi.stubEnv(SMOKE_SEEDS_ENV, JSON.stringify([ACE_SEEDS.WITH]));
    const { outcome } = await smokeOf(false, {
      ...aceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 20 }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /^The smoke walk, dealt from seed "blank", found a problem: - The walk never saw "showAce" offered in 20 steps from a fresh game dealt from seed "blank"\. .*choose a seed whose deal offers it, and list it in `seed` there\./,
    );
  });

  it('#460: fails a world spec that names a seed, since `boardsmith dev` deals a world from its own', async () => {
    const { outcome } = await smokeOf(true, { 'tests/browser/smoke.spec.ts': smokeSpec(['tend'], undefined, { seed: '7' }) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk found a problem: - This game is a persistent world, which `boardsmith dev` deals from the one seed it ' +
        'gives that world, so `seed` in tests/browser/smoke.spec.ts cannot choose its deal. Remove `seed` there (and run ' +
        '`boardsmith smoke` without `--seed`).',
    );
  });
});
