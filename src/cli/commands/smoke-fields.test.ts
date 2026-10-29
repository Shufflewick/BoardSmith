/**
 * The in-browser smoke check (#453), run for real: the values a walk enters in fields, its own and
 * those from a spec's `inputs` (#465 to #470). smoke-walk.test-helper.ts says how each walk runs.
 * The check's tests are split across the smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { fieldsGame, greetingsGame, greetingsSpec, NOBODY_CALLED_THAT, pointerAimedGame, smokeSpec } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

/** Runs the smoke check on the greetings game (#470), with the spec's `inputs` written as `inputs`. */
function walkGreetings(inputs: string) {
  return smokeOf(false, { ...greetingsGame(), 'tests/browser/smoke.spec.ts': greetingsSpec(inputs) });
}

describe('boardsmith verify: the smoke check', () => {
  it(
    '#465 to #467: enters a number its field accepts, and the next one up when the game refuses it, and gives up on an ' +
      'action it cannot finish once, reporting it, without taking it again while the panel offers anything else',
    async () => {
      const { outcome, steps } = await smokeOf(false, {
        ...fieldsGame(),
        'tests/browser/smoke.spec.ts': smokeSpec(['code', 'kindle', 'draw', 'rest']),
      });

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toMatch(
        /^The smoke walk, dealt from seed "smoke", found 2 problems: - The panel opened "code" at step 2 of the game dealt from seed "smoke", and pressing its choices changed nothing: .*Digits only\. - The panel offered "code", but the walk never took it in 60 steps\. The errors above, if any, say why\.$/,
      );
      expect(steps).toContain('smoke step 4: entering "1" for "kindle"');
      // The game refuses one log with its own message, and the walk tries two: the refusal, and
      // the error toast that says it, are the game working, not a problem. A fire taken starts the
      // next one from the field's least again (#923).
      const entered = steps.flatMap((line) => line.match(/entering "(\d+)" for "kindle"$/)?.[1] ?? []);
      expect(entered.slice(0, 3)).toEqual(['1', '2', '1']);
      expect(steps.filter((line) => line.endsWith('taking "code"'))).toHaveLength(1);
    },
  );

  it('#468: presses a pointer-aimed board candidate at a point it names a choice the game accepts, not at its refused centre', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...pointerAimedGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "claim", "rest"/);
    expect(outcome.passed).toBe(true);
    expect(steps.some((line) => /pressing "[^"]+" for "claim"/.test(line))).toBe(true);
  });

  it('#1476: searches a pointer-aimed board more finely when it refuses every one of the first points the walk aims at', async () => {
    const { outcome } = await smokeOf(false, {
      ...pointerAimedGame({ accepts: 'evenCells' }),
      'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "claim", "rest"/);
    expect(outcome.passed).toBe(true);
  });

  it('#1476: reports a pointer-aimed board the game refuses at every point the walk aims at, saying how many that was', async () => {
    const { outcome } = await smokeOf(false, {
      ...pointerAimedGame({ accepts: 'topRow' }),
      'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /- Pressing "The field, aimed at row \d, column \d" while answering "claim" did not work: at each of the 289 points the walk aimed at on it, it stands for a choice the game refuses\./,
    );
  });

  it('#1478: waits out a toast over the part of a pointer-aimed board the game accepts, rather than reporting the board as refused', async () => {
    const { outcome } = await smokeOf(false, {
      ...pointerAimedGame({ accepts: 'underAToast' }),
      'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "claim", "rest"/);
    expect(outcome.passed).toBe(true);
  });

  it('#1521: aims at a refused pointer-aimed board whose corners its board clips, rather than giving up on it', async () => {
    const { outcome } = await smokeOf(false, {
      ...pointerAimedGame({ shape: 'clipped' }),
      'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "claim", "rest"/);
    expect(outcome.passed).toBe(true);
  });

  it('#1521 review: aims at a refused pointer-aimed board from a point where it names a cell, not one where it names none', async () => {
    const { outcome } = await smokeOf(false, {
      ...pointerAimedGame({ shape: 'twoRows' }),
      'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "claim", "rest"/);
    expect(outcome.passed).toBe(true);
  });

  it('#466: reports an action whose rules crash on the number the walk entered, rather than trying the next number', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...fieldsGame({ kindleCrashesAtOne: true }),
      'tests/browser/smoke.spec.ts': smokeSpec(['code', 'kindle', 'draw', 'rest']),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      '- The panel offered "kindle", and taking it failed: The "kindle" action could not be completed because of an error in ' +
        "the game's rules. (the hearth cracked) Nothing was changed.",
    );
    expect(outcome.summary).toMatch(/- The game showed an error: The "kindle" action could not be completed/);
    expect(steps.some((line) => line.endsWith('entering "2" for "kindle"'))).toBe(false);
  });

  it(
    "#470: types the value a spec's `inputs` give a field, reading the page when the spec says how, and its own text in " +
      'any other field; one the page gives no value for yet is cancelled and taken once the page gives one',
    async () => {
      const { outcome, steps } = await walkGreetings(`{
    greet: { whom: theOther },
    // Nothing until the log shows a card drawn, as a page that does not show the name yet gives none.
    wave: { whom: async (view) => ((await view.texts(LOG)).some((line) => line.endsWith('drew a card.')) ? theOther(view) : undefined) },
    pledge: { coins: 7 },
  }`);

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "greet", "note", "pledge", "wave"/,
      );
      expect(outcome.passed).toBe(true);
      // What the walk typed, without the step it typed it at. It acts for each seat in turn, so the
      // other player's name is whichever seat it is not.
      const entered = new Set(steps.map((line) => line.replace(/^smoke step \d+: /, '').replace(/Player [12]/, 'Player N')));
      for (const typed of [
        'entering "Player N" for "greet", from `inputs`',
        'entering "7" for "pledge", from `inputs`',
        'entering "smoke test" for "note"',
        'entering "Player N" for "wave", from `inputs`',
      ]) {
        expect(entered).toContain(typed);
      }
      expect(steps.filter((line) => line.endsWith('`inputs` gives no value for "whom" of "wave" yet; cancelling it until the game moves on'))).toHaveLength(1);
    },
  );

  it(
    "#470: fails on a value from the spec's `inputs` the game refuses, naming it; on a value of the walk's own the game " +
      'refuses, saying how to give the right one; and on an action whose input never gave a value',
    async () => {
      const { outcome, steps } = await walkGreetings(`{
    greet: { whom: 'Nobody' },
    wave: { whom: () => undefined },
  }`);

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toContain(
        `- The panel offered "greet", and taking it failed: ${NOBODY_CALLED_THAT} The walk typed "Nobody" in its field ` +
          '"whom", as `inputs.greet.whom` in tests/browser/smoke.spec.ts gives it.',
      );
      expect(outcome.summary).toContain(
        '- The panel offered "pledge", and taking it failed: The pot takes seven coins. The game refused each of the 3 ' +
          'numbers the walk entered. The walk typed "3" in its field "coins". If the game needs a particular value there, ' +
          'such as a name the board shows, give it in `inputs` in tests/browser/smoke.spec.ts.',
      );
      expect(outcome.summary).toContain(
        '- The panel offered "wave", but the walk never took it in 60 steps: when it last opened it, `inputs.wave.whom` in ' +
          'tests/browser/smoke.spec.ts gave no text for its field "whom", so the walk cancelled it.',
      );
      expect(outcome.summary).not.toMatch(/"(note|draw)", but the walk never took it/);
      // An action put off is tried again in turn with the others, not after every move, so however
      // many are put off the rest of the game keeps its steps.
      const times = (what: RegExp) => steps.filter((line) => what.test(line)).length;
      const putOff = times(/`inputs` gives no value for "whom" of "wave" yet/);
      expect(putOff).toBeGreaterThan(1);
      expect(putOff).toBeLessThanOrEqual(times(/: taking "note"$/) + 1);
      expect(putOff).toBeLessThanOrEqual(times(/: taking "draw"$/) + 1);
    },
  );

  it(
    "#470: fails on a spec input that throws, one naming a field the action does not have, and a number from `inputs` " +
      'the game refuses, which it enters once and never moves up',
    async () => {
      const { outcome, steps } = await walkGreetings(`{
    greet: { whom: () => { throw new Error('the players panel moved'); } },
    wave: { whim: theOther },
    pledge: { coins: 3 },
  }`);

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toContain(
        '- `inputs.greet.whom` in tests/browser/smoke.spec.ts failed while the walk answered "greet": the players panel moved',
      );
      expect(outcome.summary).toContain(
        '- `inputs.wave.whim` in tests/browser/smoke.spec.ts names a field the walk never met in "wave", whose fields it met ' +
          'are "whom". Name the field by the pick name its rules give it.',
      );
      expect(outcome.summary).toContain(
        '- The panel offered "pledge", and taking it failed: The pot takes seven coins. The walk typed "3" in its field ' +
          '"coins", as `inputs.pledge.coins` in tests/browser/smoke.spec.ts gives it.',
      );
      expect(outcome.summary).not.toContain('refused each of');
      expect(steps.filter((line) => /: entering "\d+" for "pledge"/.test(line))).toEqual([expect.stringMatching(/: entering "3" for "pledge", from `inputs`$/)]);
    },
  );
});
