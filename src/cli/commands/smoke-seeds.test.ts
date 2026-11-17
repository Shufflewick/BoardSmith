/**
 * The in-browser smoke check (#453), run for real: the seeds a walk deals from (#460).
 * smoke-walk.test-helper.ts says how each walk runs. The check's tests are split across the
 * smoke*.test.ts files so they run side by side (#1319).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SMOKE_SEEDS_ENV } from '../../testing/browser-smoke-verdict.js';
import { chosenDeals, runSmoke } from './smoke.js';
import { smokeProject } from './smoke-project.test-helper.js';
import { quiet, smokeIn, smokeOf } from './smoke-walk.test-helper.js';
import { ACE_SEEDS, aceGame, crowdGame, smokeSpec, towerGame } from './smoke-fixtures.test-helper.js';

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
      expect(first.steps).toContain('smoke: dealing a game from seed "blank" at 2 players');
      expect(first.steps.some((line) => /pressing "[^"]+" for "play"/.test(line))).toBe(true);
      expect(second.steps).toEqual(first.steps);
    },
  );

  it('#1602: deals each game at the player count its deal names, and one naming none at the game\'s fewest', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...crowdGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'huddle', 'pair'], undefined, { seed: [{ seed: 'crowded', players: 3 }, 'paired'], steps: 12 }),
    });

    expect(outcome.summary).toMatch(
      /^Served by `boardsmith dev` from a fresh start and dealt from seed "crowded" at 3 players, then from seed "paired", a seated player took "draw", "huddle", "pair"/,
    );
    expect(outcome.passed).toBe(true);
    expect(steps).toContain('smoke: dealing a game from seed "crowded" at 3 players');
    expect(steps).toContain('smoke: dealing a game from seed "paired" at 2 players');
  });

  it('#1684: deals each game with the game options its deal names, and one naming none with the options the dev host starts with', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...towerGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'aimTar', 'stoke'], undefined, {
        seed: [{ seed: 'tarry', gameOptions: { tower: 'tar', lit: true } }, 'plain'],
        steps: 12,
      }),
    });

    expect(outcome.summary).toMatch(
      /^Served by `boardsmith dev` from a fresh start and dealt from seed "tarry" with game options \{"tower":"tar","lit":true\}, then from seed "plain", a seated player took "aimTar", "draw", "stoke"/,
    );
    expect(outcome.passed).toBe(true);
    expect(steps).toContain('smoke: dealing a game from seed "tarry" at 2 players with game options {"tower":"tar","lit":true}');
    expect(steps).toContain('smoke: dealing a game from seed "plain" at 2 players');
  });

  it('#1686: walks a deal that names its own steps for those steps, and one naming none for the spec\'s', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...aceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: [{ seed: ACE_SEEDS.WITHOUT, steps: 3 }, ACE_SEEDS.WITH], steps: 20 }),
    });

    expect(outcome.summary).toMatch(
      /^Served by `boardsmith dev` from a fresh start and dealt from seed "blank" for 3 steps, then from seed "0", a seated player took "draw", "play", "showAce"/,
    );
    expect(outcome.passed).toBe(true);
    const second = steps.findIndex((line) => line.startsWith('smoke: dealing a game from seed "0"'));
    const walked = (lines: string[]) => Math.max(...lines.map((line) => Number(/^smoke step (\d+):/.exec(line)?.[1] ?? 0)));
    expect(walked(steps.slice(0, second))).toBe(3);
    expect(walked(steps.slice(second))).toBeGreaterThan(3);
  });

  it('#1684: `boardsmith smoke --seed --game-option` walks a deal with game options the spec does not name', async () => {
    const dir = await smokeProject(false, {
      ...towerGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'aimTar'], undefined, { seed: 'plain', steps: 12 }),
    });
    const { outcome } = await runSmoke({ projectDir: dir, log: quiet, seeds: chosenDeals({ seed: ['tarry'], gameOption: ['tower=tar', 'lit=true'] }) });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "tarry" with game options \{"tower":"tar","lit":"true"\}, a seated player took "aimTar", "draw"/);
    expect(outcome.passed).toBe(true);
  });

  it('#1684: fails a deal naming a game option the game does not declare, saying which it declares', async () => {
    const { outcome } = await smokeOf(false, {
      ...towerGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw'], undefined, { seed: { seed: 'tarry', gameOptions: { towr: 'tar' } }, steps: 12 }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      'The walk could not go on: The deal of seed "tarry" with game options {"towr":"tar"} names game option "towr", which this game does not declare. It declares "tower", "lit", "rounds".',
    );
  });

  it('#1684: fails a deal whose game option Table setup refuses, with the reason it gives', async () => {
    const { outcome } = await smokeOf(false, {
      ...towerGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw'], undefined, { seed: { seed: 'tarry', gameOptions: { rounds: 9 } }, steps: 12 }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      'The walk could not go on: Table setup cannot deal a game from seed "tarry" with game options {"rounds":9}: ' +
        'its "Rounds" field says "Value must be less than or equal to 5.".',
    );
  });

  it('#460: `boardsmith smoke --seed` deals from the seeds it names instead of the spec\'s', async () => {
    const dir = await smokeProject(false, {
      ...aceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 20 }),
    });
    const { outcome } = await runSmoke({ projectDir: dir, log: quiet, seeds: [ACE_SEEDS.WITH] });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "0", a seated player took "draw", "play", "showAce"/);
    expect(outcome.passed).toBe(true);
  });

  it('#1602: `boardsmith smoke --seed --players` walks a deal at a player count the spec does not name', async () => {
    const dir = await smokeProject(false, {
      ...crowdGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'huddle'], undefined, { seed: 'paired', steps: 12 }),
    });
    const { outcome } = await runSmoke({ projectDir: dir, log: quiet, seeds: chosenDeals({ seed: ['crowded'], players: '3' }) });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "crowded" at 3 players, a seated player took "draw", "huddle"/);
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

describe('chosenDeals: the deals `boardsmith smoke --seed` and `--players` name (#1602)', () => {
  it('deals each seed --seed names at the count --players names, or at the game\'s fewest without one', () => {
    expect(chosenDeals({})).toBeUndefined();
    expect(chosenDeals({ seed: ['crowded', 'b'] })).toEqual(['crowded', 'b']);
    expect(chosenDeals({ seed: ['crowded', 'b'], players: '3' })).toEqual([{ seed: 'crowded', players: 3 }, { seed: 'b', players: 3 }]);
  });

  it('refuses --players without --seed, and a count that is not a positive whole number', () => {
    expect(() => chosenDeals({ players: '3' })).toThrow(
      '`boardsmith smoke --players` sets how many players sit at the deals `--seed` names, and no `--seed` was given. ' +
        "Add `--seed <seeds...>`, or leave out `--players` to walk the spec's own deals.",
    );
    expect(() => chosenDeals({ seed: ['crowded'], players: 'three' })).toThrow('--players takes a positive whole number, got "three".');
  });

  it('#1684: deals each seed --seed names with the game options --game-option names, at the count --players names if it names one', () => {
    expect(chosenDeals({ seed: ['tarry', 'b'], gameOption: ['tower=Tar Works', 'lit=true'] })).toEqual([
      { seed: 'tarry', gameOptions: { tower: 'Tar Works', lit: 'true' } },
      { seed: 'b', gameOptions: { tower: 'Tar Works', lit: 'true' } },
    ]);
    expect(chosenDeals({ seed: ['tarry'], players: '3', gameOption: ['tower=tar'] })).toEqual([{ seed: 'tarry', players: 3, gameOptions: { tower: 'tar' } }]);
  });

  it('#1684: refuses --game-option without --seed, and one that is not key=value', () => {
    expect(() => chosenDeals({ gameOption: ['tower=tar'] })).toThrow(
      '`boardsmith smoke --game-option` sets the game options of the deals `--seed` names, and no `--seed` was given. ' +
        "Add `--seed <seeds...>`, or leave out `--game-option` to walk the spec's own deals.",
    );
    expect(() => chosenDeals({ seed: ['tarry'], gameOption: ['tower'] })).toThrow('--game-option takes "key=value", got "tower".');
  });

  it('#1686: walks each seed --seed names for the steps --steps names, and refuses --steps without --seed or that is not a count', () => {
    expect(chosenDeals({ seed: ['tar-works'], steps: '60' })).toEqual([{ seed: 'tar-works', steps: 60 }]);
    expect(chosenDeals({ seed: ['tar-works'], players: '3', steps: '60' })).toEqual([{ seed: 'tar-works', players: 3, steps: 60 }]);
    expect(() => chosenDeals({ steps: '60' })).toThrow(
      '`boardsmith smoke --steps` sets how many steps the walk takes on the deals `--seed` names, and no `--seed` was given. ' +
        "Add `--seed <seeds...>`, or leave out `--steps` to walk the spec's own deals.",
    );
    expect(() => chosenDeals({ seed: ['tar-works'], steps: '0' })).toThrow('--steps takes a positive whole number, got "0".');
  });
});
