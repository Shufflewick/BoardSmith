/**
 * #258: A NUMBER PICK CAN OPEN PRE-FILLED, AND CAN SAY WHAT ITS VALUE MEANS.
 *
 * `enterNumber` could state a floor, a ceiling and whether the value is whole,
 * and nothing else. A game asking for an age between 16 and 65 "defaulting to
 * 35, showing the life stage the number falls into" had no way to say either
 * half: the panel opened on an empty field, and `display` -- which the choice
 * kinds have had all along -- did not exist on the numeric kind at all. The
 * game's workaround was to say both in the prompt, which is a sentence rather
 * than a control.
 *
 * Two additions, and what each one has to survive:
 *
 *   `initial` is the value the FIELD OPENS ON. It is not a default applied to an
 *     omitted answer -- an optional pick that is skipped is still absent -- so
 *     it is declared, checked against the pick's own rules at declaration time,
 *     and carried on the pick metadata a host serializes.
 *   `display` is evaluated ONCE PER VALUE the field can hold, at offer time, and
 *     shipped as a label per value. That is the only honest way to label a
 *     number the player is still typing: a callback cannot cross the wire and a
 *     round trip per keystroke is not a label. It is why the range must be
 *     enumerable, and why declaring `display` without one is refused loudly
 *     rather than quietly labelling nothing.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action } from '../index.js';
import type { GameOptions } from '../index.js';
import { buildPickMetadata } from '../element/action-metadata.js';
import { MAX_LABELLED_NUMBER_VALUES } from './number-labels.js';

class AgeGame extends Game<AgeGame, Player> {
  constructor(options: GameOptions) {
    super(options);
  }
}

function soloGame(): { game: AgeGame; player: Player } {
  const game = new AgeGame({ playerCount: 1, playerNames: ['Solo'] });
  return { game, player: game.getPlayer(1)! };
}

/** The ticket's own band, so the labels under test are the reported ones. */
function lifeStage(age: number): string {
  if (age <= 20) return 'barely grown';
  if (age <= 30) return 'young';
  if (age <= 50) return 'in your prime';
  return 'seasoned';
}

const askAge = () =>
  Action.create<AgeGame>('ask-age')
    .enterNumber('age', {
      prompt: 'How old are you?',
      min: 16,
      max: 65,
      integer: true,
      initial: 35,
      display: lifeStage,
    })
    .execute(() => ({ success: true }));

describe('#258 — enterNumber carries a starting value', () => {
  it('records `initial` on the selection the builder produces', () => {
    const selection = askAge().selections[0]!;

    expect(selection).toMatchObject({ type: 'number', initial: 35 });
  });

  it('carries it onto the pick metadata a host serializes', () => {
    const { game, player } = soloGame();

    const pick = buildPickMetadata(game, player, askAge().selections[0]!);

    expect(pick.initial).toBe(35);
    // Through the wire and back: a starting value a host cannot ship is not one.
    expect(JSON.parse(JSON.stringify(pick)).initial).toBe(35);
  });

  it('omits `initial` entirely when the game did not declare one', () => {
    const { game, player } = soloGame();
    const plain = Action.create<AgeGame>('wager')
      .enterNumber('amount', { min: 1 })
      .execute(() => ({ success: true })).selections[0]!;

    const pick = buildPickMetadata(game, player, plain);

    expect(Object.keys(pick)).not.toContain('initial');
  });

  it('REFUSES a starting value outside the pick\'s own range, naming the rule', () => {
    expect(() =>
      Action.create<AgeGame>('ask-age')
        .enterNumber('age', { min: 16, max: 65, integer: true, initial: 9 })
        .execute(() => ({ success: true })),
    ).toThrow(/age must be at least 16/);
  });

  it('REFUSES a fractional starting value on a whole-number pick', () => {
    expect(() =>
      Action.create<AgeGame>('ask-age')
        .enterNumber('age', { min: 16, max: 65, integer: true, initial: 35.5 })
        .execute(() => ({ success: true })),
    ).toThrow(/age must be a whole number/);
  });
});

describe('#258 — enterNumber labels the value the player is on', () => {
  it('labels every value the field can hold', () => {
    const { game, player } = soloGame();

    const pick = buildPickMetadata(game, player, askAge().selections[0]!);

    expect(pick.valueLabels?.['16']).toBe('barely grown');
    expect(pick.valueLabels?.['35']).toBe('in your prime');
    expect(pick.valueLabels?.['65']).toBe('seasoned');
    expect(Object.keys(pick.valueLabels!)).toHaveLength(50);
  });

  it('omits `valueLabels` when the game declared no display', () => {
    const { game, player } = soloGame();
    const plain = Action.create<AgeGame>('wager')
      .enterNumber('amount', { min: 1, max: 3, integer: true })
      .execute(() => ({ success: true })).selections[0]!;

    expect(Object.keys(buildPickMetadata(game, player, plain))).not.toContain('valueLabels');
  });

  it('REFUSES a display over a range with no ceiling, saying what is missing', () => {
    expect(() =>
      Action.create<AgeGame>('ask-age')
        .enterNumber('age', { min: 16, integer: true, display: lifeStage })
        .execute(() => ({ success: true })),
    ).toThrow(/max/);
  });

  it('REFUSES a display over a range that is not whole numbers', () => {
    expect(() =>
      Action.create<AgeGame>('ask-age')
        .enterNumber('age', { min: 16, max: 65, display: lifeStage })
        .execute(() => ({ success: true })),
    ).toThrow(/integer/);
  });

  it('REFUSES a display over more values than a host may ship', () => {
    expect(() =>
      Action.create<AgeGame>('ask-age')
        .enterNumber('age', {
          min: 0,
          max: MAX_LABELLED_NUMBER_VALUES,
          integer: true,
          display: lifeStage,
        })
        .execute(() => ({ success: true })),
    ).toThrow(new RegExp(`${MAX_LABELLED_NUMBER_VALUES + 1} values`));
  });

  it('REFUSES a display callback that throws, naming the value it failed on', () => {
    const { game, player } = soloGame();
    const selection = Action.create<AgeGame>('ask-age')
      .enterNumber('age', {
        min: 1,
        max: 3,
        integer: true,
        display: (value) => {
          if (value === 2) throw new Error('no label for two');
          return `value ${value}`;
        },
      })
      .execute(() => ({ success: true })).selections[0]!;

    expect(() => buildPickMetadata(game, player, selection)).toThrow(/age.*\b2\b/s);
  });
});
