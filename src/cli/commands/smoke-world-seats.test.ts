/**
 * The in-browser smoke check (#453), run for real: the seats a walk plays (#471, #472, #474, #562).
 * smoke-walk.test-helper.ts says how each walk runs. The check's tests are split across the
 * smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { ALONE_REASON, gladeSpec, gladeWorld } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it(
    '#472, #474: in a world walked from one seat, says why an action the panel only greyed out was never taken, and waits ' +
      'out a slow command within its step rather than spending the next one waiting for a turn',
    async () => {
      const { outcome, steps } = await smokeOf(true, { ...gladeWorld(), 'tests/browser/smoke.spec.ts': gladeSpec({ steps: 8 }) });

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toMatch(
        new RegExp(
          '^The smoke walk found a problem: - The panel offered "greet" only greyed out in 8 steps from a fresh game, so the ' +
            `walk could never take it\\. The panel gave these reasons, the latest last: "Arrive first\\."; "${ALONE_REASON}" ` +
            '.*If it needs another player there too, list the ' +
            'seats the walk plays in `seats` there',
        ),
      );
      expect(steps.some((line) => line.endsWith('taking "rest"'))).toBe(true);
      expect(steps.filter((line) => line.includes('waiting for a turn'))).toEqual([]);
    },
  );

  it('#562: counts a panel press that reached its button as landed, though the page was too busy to answer within one look, and does not press it again', async () => {
    const { outcome, steps } = await smokeOf(true, { ...gladeWorld({ busy: true }), 'tests/browser/smoke.spec.ts': gladeSpec({ steps: 8 }) });

    expect(outcome.summary).not.toContain('did not work');
    expect(steps.filter((line) => line.endsWith('taking "arrive"'))).toHaveLength(1);
    expect(steps.some((line) => line.endsWith('taking "rest"'))).toBe(true);
  });

  it(
    '#471: plays the seats a world spec names, each in a browser of its own, the second following the first, and takes ' +
      'an action that needs another player there as soon as the page shows one, naming that player from `inputs`',
    async () => {
      const { outcome, steps } = await smokeOf(true, { ...gladeWorld(), 'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 4]', steps: 30 }) });

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start, players at seats 1 and 4 took "arrive", "greet", "look", "rest", "stroll"/,
      );
      expect(outcome.passed).toBe(true);
      expect(steps).toContain('smoke: seat 4 joins the world in a browser of its own');
      expect(steps.some((line) => /: acting as seat 4$/.test(line))).toBe(true);
      // Seat 4 arrives, which only it is then offered, and follows seat 1 from there, so the two stroll on together.
      expect(steps[steps.findIndex((line) => line.endsWith(': acting as seat 4')) + 1]).toMatch(/: taking "arrive"$/);
      expect(steps.some((line) => line.endsWith(': taking "look", as seat 1 did'))).toBe(true);
      expect(steps.some((line) => line.endsWith(': taking "stroll", as seat 1 did'))).toBe(true);
      expect(steps.some((line) => /: entering "seat [14]" for "greet", from `inputs`$/.test(line))).toBe(true);
      // "greet" was put off while neither had looked, and taken again as soon as a look showed the
      // other seat there, before the walk strolled on.
      const taking = steps.filter((line) => /: taking "[a-z]+"$/.test(line)).map((line) => line.replace(/^smoke step \d+: /, ''));
      const looked = taking.indexOf('taking "look"');
      expect(looked).toBeGreaterThan(taking.indexOf('taking "greet"'));
      expect(taking.indexOf('taking "greet"', looked)).toBeLessThan(taking.indexOf('taking "stroll"'));
      expect(steps.filter((line) => line.includes('waiting for a turn'))).toEqual([]);
    },
  );

  it('#471: fails a walk whose second seat alone fails, naming that seat in every problem from its browser', async () => {
    const { outcome } = await smokeOf(true, { ...gladeWorld({ stumbles: true }), 'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 4]', steps: 12 }) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(/- In seat 4's browser: The panel offered "arrive", and taking it failed: .*seat four tripped on a root/);
    const fromABrowser = outcome.summary.match(/In seat \d+'s browser/g) ?? [];
    expect(fromABrowser.length).toBeGreaterThan(0);
    expect(new Set(fromABrowser)).toEqual(new Set(["In seat 4's browser"]));
  });

  it('#471: a seat after the first opens an action group to reach what only it is offered', async () => {
    const { outcome, steps } = await smokeOf(true, {
      ...gladeWorld({ manners: true }),
      'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 4]', steps: 40, manners: true }),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start, players at seats 1 and 4 took "arrive", "bow", "greet"/);
    expect(outcome.passed).toBe(true);
    const opening = steps.findIndex((line) => line.endsWith(`: opening the panel's group "Manners"`));
    expect(opening).toBeGreaterThan(0);
    expect(steps.slice(0, opening).reverse().find((line) => /: acting as seat \d+$/.test(line))).toMatch(/acting as seat 4$/);
  });

  it('#471: fails a world spec that names a seat the world does not have, saying which seats it has', async () => {
    const { outcome } = await smokeOf(true, { ...gladeWorld(), 'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 9]', steps: 4 }) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /^The smoke walk found \d+ problems: - The walk could not go on: `seats` in tests\/browser\/smoke\.spec\.ts names seat 9, but this world has seats 1 to 8\. Name seats it has\. /,
    );
  });

  it('#471: fails a table spec that names `seats`, since the walk acts for every seat at a table', async () => {
    const { outcome } = await smokeOf(false, {
      'tests/browser/smoke.spec.ts': "import { defineSmokeTest } from 'boardsmith/testing/browser';\n\ndefineSmokeTest({ actions: ['draw', 'play'], seats: 2 });\n",
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - This game is played at a table, where the walk acts for ' +
        'every seat in turn, so `seats` in tests/browser/smoke.spec.ts has nothing to choose. Remove `seats` there.',
    );
  });
});
