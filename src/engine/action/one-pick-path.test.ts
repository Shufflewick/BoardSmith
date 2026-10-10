/**
 * #507: A SUBMITTED PICK MEANS ONE THING, AND IS ALLOWED BY ONE RULE, ON EVERY PATH.
 *
 * A pick reaches the engine three ways: a whole submission (`performAction`),
 * one selection at a time (`processSelectionStep`), and one pick of a repeating
 * selection (`processRepeatingStep`). Each used to decide for itself what the
 * submitted value named and whether it was on offer, and they disagreed:
 *
 * - The step path resolved a pick with no earlier picks in view and never per
 *   item of a multiSelect, so `onSelect` and the pending action's args got the
 *   display text the client sent instead of the value it named.
 * - The repeating path checked membership itself, without the tutorial gate,
 *   without resolving ids or display text, and refused with its own raw text.
 *
 * Every test here drives the real executor through the entry point named.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action } from '../index.js';
import type { ActionContext } from '../index.js';
import type { ActionDefinition } from './types.js';
import type { TutorialDefinition } from '../tutorial/types.js';

const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

class Stone extends Piece<Yard> {}
class Pile extends Space<Yard> {}

class Yard extends Game<Yard, Player> {
  rocks!: Pile;
  constructor() {
    super({ playerCount: 2 });
    this.rocks = this.create(Pile, 'rocks');
    for (const name of ['flint', 'slate']) this.rocks.create(Stone, name);
  }
  stone(name: string): Stone {
    return this.rocks.first(Stone, name)!;
  }
}

/** What the picked selection's `onSelect` and the action's `execute` were handed. */
interface Log {
  onSelect: unknown[];
  execute: unknown[];
}

interface PickCase {
  name: string;
  /** The action, with `log` recording what selection `pick` hands its callbacks. */
  build: (game: Yard, log: Log) => ActionDefinition;
  /** The picks as a client sends them, in order. */
  picks: (game: Yard) => Array<[string, unknown]>;
  /** What the last pick means: the value `onSelect` and `execute` must receive. */
  means: (game: Yard) => unknown;
}

const labelled = [{ value: 'skip', label: 'Skip' }, { value: 'go', label: 'Go' }];
/** 'stop' is one choice's value and another's label: the value wins. */
const shadowed = [{ value: 'go', label: 'stop' }, { value: 'stop', label: 'Halt' }];
const dependent = (ctx: ActionContext) =>
  ctx.args.a === 'p' ? [{ value: 1, label: 'One' }] : [{ value: 2, label: 'Two' }];

/** One action whose LAST selection is `pick`, configured by `options`. */
function chooseFromCase(log: Log, options: Record<string, unknown>, withEarlierPick = false): ActionDefinition {
  let builder = Action.create('take');
  if (withEarlierPick) builder = builder.chooseFrom('a', { choices: ['p', 'q'] });
  return builder
    .chooseFrom('pick', {
      ...(options as { choices: unknown[] }),
      onSelect: (value: unknown) => { log.onSelect.push(value); },
    })
    .execute((args) => { log.execute.push(args.pick); });
}

/** The same pick, made by a selection that repeats and ends after one pick. */
const once = { repeat: { until: () => true } };

const choiceCases = (repeat: boolean): PickCase[] => [
  {
    name: 'a { value, label } choice submitted by its label',
    build: (_game, log) => chooseFromCase(log, { choices: labelled, ...(repeat && once) }),
    picks: () => [['pick', 'Skip']],
    means: () => 'skip',
  },
  {
    name: "a value submitted exactly, though it is also another choice's label",
    build: (_game, log) => chooseFromCase(log, { choices: shadowed, ...(repeat && once) }),
    picks: () => [['pick', 'stop']],
    means: () => 'stop',
  },
  {
    name: 'a string choice submitted by display text in another case',
    build: (_game, log) => chooseFromCase(log, { choices: ['Red', 'Blue'], ...(repeat && once) }),
    picks: () => [['pick', 'red']],
    means: () => 'Red',
  },
  {
    name: 'an element choice submitted by element id',
    build: (game, log) => chooseFromCase(log, { choices: () => game.rocks.all(Stone), ...(repeat && once) }),
    picks: (game) => [['pick', game.stone('slate').id]],
    means: (game) => game.stone('slate'),
  },
  {
    name: 'an element choice submitted as a serialized element',
    build: (game, log) => chooseFromCase(log, { choices: () => game.rocks.all(Stone), ...(repeat && once) }),
    picks: (game) => [['pick', { id: game.stone('slate').id, className: 'Stone' }]],
    means: (game) => game.stone('slate'),
  },
  {
    name: 'a choice that depends on an earlier pick, submitted by its label',
    build: (_game, log) => chooseFromCase(log, { choices: dependent, dependsOn: 'a', ...(repeat && once) }, true),
    picks: () => [['a', 'p'], ['pick', 'One']],
    means: () => 1,
  },
  {
    name: 'a chooseElement submitted by element id',
    build: (game, log) => {
      const options = {
        elements: () => game.rocks.all(Stone),
        onSelect: (value: unknown) => { log.onSelect.push(value); },
      };
      const take = Action.create('take');
      return (repeat ? take.chooseElement('pick', { ...options, ...once }) : take.chooseElement('pick', options))
        .execute((args) => { log.execute.push(args.pick); });
    },
    picks: (game) => [['pick', game.stone('slate').id]],
    means: (game) => game.stone('slate'),
  },
];

const multiCases: PickCase[] = [
  {
    name: 'a multiSelect submitted by labels, resolved item by item',
    build: (_game, log) => chooseFromCase(log, { choices: labelled, multiSelect: 2 }),
    picks: () => [['pick', ['Skip', 'Go']]],
    means: () => ['skip', 'go'],
  },
  {
    name: 'a multiSelect of element choices submitted by ids',
    build: (game, log) => chooseFromCase(log, { choices: () => game.rocks.all(Stone), multiSelect: 2 }),
    picks: (game) => [['pick', [game.stone('flint').id, game.stone('slate').id]]],
    means: (game) => [game.stone('flint'), game.stone('slate')],
  },
  {
    name: 'an orderedList submitted by labels, resolved item by item in order, repeats kept (#636)',
    build: (_game, log) => chooseFromCase(log, { choices: labelled, orderedList: { min: 1, max: 3 } }),
    picks: () => [['pick', ['Go', 'Skip', 'Go']]],
    means: () => ['go', 'skip', 'go'],
  },
  {
    name: 'an orderedList of element choices submitted by ids (#636)',
    build: (game, log) => chooseFromCase(log, { choices: () => game.rocks.all(Stone), orderedList: { min: 1, max: 2 } }),
    picks: (game) => [['pick', [game.stone('slate').id, game.stone('flint').id]]],
    means: (game) => [game.stone('slate'), game.stone('flint')],
  },
  {
    name: 'a chooseElements submitted by ids',
    build: (game, log) =>
      Action.create('take')
        .chooseElements('pick', {
          elements: () => game.rocks.all(Stone),
          multiSelect: 2,
          onSelect: (value: unknown) => { log.onSelect.push(value); },
        })
        .execute((args) => { log.execute.push(args.pick); }),
    picks: (game) => [['pick', [game.stone('flint').id, game.stone('slate').id]]],
    means: (game) => [game.stone('flint'), game.stone('slate')],
  },
];

type EntryPoint = (game: Yard, action: ActionDefinition, picks: Array<[string, unknown]>, repeat: boolean) => string | undefined;

/** A whole submission. A repeating selection's value is its picks as an array. */
const bulk: EntryPoint = (game, _action, picks, repeat) => {
  const args = Object.fromEntries(picks.map(([name, value], i) =>
    [name, repeat && i === picks.length - 1 ? [value] : value]));
  return game.performAction('take', game.getPlayer(1)!, args).error;
};

/** One selection at a time, as the action panel sends them. */
const stepByStep: EntryPoint = (game, action, picks) => {
  const executor = game.getActionExecutor();
  const player = game.getPlayer(1)!;
  const pending = executor.createPendingActionState('take', 1);
  for (const [name, value] of picks) {
    const step = executor.processSelectionStep(action, player, pending, name, value);
    if (!step.success) return step.error;
  }
  return executor.executePendingAction(action, player, pending).error;
};

function run(entry: EntryPoint, pickCase: PickCase, repeat: boolean) {
  const game = new Yard();
  const log: Log = { onSelect: [], execute: [] };
  const action = pickCase.build(game, log);
  game.registerAction(action);
  const error = entry(game, action, pickCase.picks(game), repeat);
  return { error, log, means: pickCase.means(game) };
}

describe('every entry point resolves a pick the same way (#507)', () => {
  const entryPoints: Array<[string, EntryPoint]> = [['performAction', bulk], ['processSelectionStep', stepByStep]];

  for (const [entryName, entry] of entryPoints) {
    describe(entryName, () => {
      it.each(choiceCases(false).map((c) => [c.name, c] as const))('%s', (_name, pickCase) => {
        const { error, log, means } = run(entry, pickCase, false);
        expect(error).toBeUndefined();
        expect(log).toEqual({ onSelect: [means], execute: [means] });
      });

      it.each(multiCases.map((c) => [c.name, c] as const))('%s', (_name, pickCase) => {
        const { error, log, means } = run(entry, pickCase, false);
        expect(error).toBeUndefined();
        expect(log).toEqual({ onSelect: [means], execute: [means] });
      });

      it.each(choiceCases(true).map((c) => [c.name, c] as const))('repeating: %s', (_name, pickCase) => {
        const { error, log, means } = run(entry, pickCase, true);
        expect(error).toBeUndefined();
        expect(log).toEqual({ onSelect: [means], execute: [[means]] });
      });
    });
  }

  it('a chooseElements submitted as a single { id } hands execute the element', () => {
    const game = new Yard();
    const handed: unknown[] = [];
    game.registerAction(
      Action.create('take')
        .chooseElements('pick', { elements: () => game.rocks.all(Stone) })
        .execute((args) => { handed.push(args.pick); }),
    );
    const slate = game.stone('slate');

    const result = game.performAction('take', game.getPlayer(1)!, { pick: { id: slate.id } });

    expect(result.error).toBeUndefined();
    expect(handed).toEqual([slate]);
  });

  it('the step path stores the value a multiSelect named, not the labels sent, for the picks after it', () => {
    const game = new Yard();
    const log: Log = { onSelect: [], execute: [] };
    const action = chooseFromCase(log, { choices: labelled, multiSelect: 2 });
    game.registerAction(action);
    const executor = game.getActionExecutor();
    const pending = executor.createPendingActionState('take', 1);

    executor.processSelectionStep(action, game.getPlayer(1)!, pending, 'pick', ['Skip']);

    expect(pending.collectedArgs.pick).toEqual(['skip']);
  });
});

describe('a repeating pick is checked by the same rule as any other pick (#507)', () => {
  const gatedTutorial: TutorialDefinition = {
    steps: [{ id: 'first', gate: { action: 'place', selections: { piece: { value: 'a' } } } }],
  };

  function gatedGame(repeat: boolean) {
    const game = new Yard();
    const place = Action.create('place');
    const choices = ['a', 'b', 'c'];
    const action = (repeat ? place.chooseFrom('piece', { choices, ...once }) : place.chooseFrom('piece', { choices }))
      .execute(() => {});
    game.registerAction(action);
    game.tutorialDefinition = gatedTutorial;
    game.tutorialProgress.set(1, { stepId: 'first', status: 'running' });
    return { game, action, executor: game.getActionExecutor(), player: game.getPlayer(1)! };
  }

  it('a repeating chooseFrom refuses a value the active tutorial step gates out', () => {
    const { action, executor, player } = gatedGame(true);
    const pending = executor.createPendingActionState('place', 1);

    const step = executor.processRepeatingStep(action, player, pending, 'b');

    expect(step.error).toMatch(/^Selection disabled: Tutorial step requires a specific piece/);
    expect(pending.repeating?.accumulated ?? []).toEqual([]);
  });

  it('a whole submission of a repeating chooseFrom refuses the gated value as a non-repeating one does', () => {
    const plain = gatedGame(false);
    const repeating = gatedGame(true);

    const plainError = plain.game.performAction('place', plain.player, { piece: 'b' }).error;
    const repeatingError = repeating.game.performAction('place', repeating.player, { piece: ['b'] }).error;

    expect(plainError).toMatch(/^Selection disabled: Tutorial step requires a specific piece/);
    expect(repeatingError).toBe(`Pick 1 of "piece": ${plainError}`);
  });

  it('a refused gated repeating pick still hands back the next choices, with the enabled one selectable', () => {
    const { action, executor, player } = gatedGame(true);
    const pending = executor.createPendingActionState('place', 1);

    const step = executor.processRepeatingStep(action, player, pending, 'b');

    expect(step.error).toMatch(/^Selection disabled:/);
    expect(step.nextChoices?.map((c) => c.value)).toEqual(['a', 'b', 'c']);
    expect(step.nextChoices?.filter((c) => !c.disabled).map((c) => c.value)).toEqual(['a']);
  });

  it('a repeating pick sent by label that names a gated value is refused with the gate reason', () => {
    const game = new Yard();
    const action = Action.create('place')
      .chooseFrom('piece', { choices: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], ...once })
      .execute(() => {});
    game.registerAction(action);
    game.tutorialDefinition = gatedTutorial;
    game.tutorialProgress.set(1, { stepId: 'first', status: 'running' });
    const executor = game.getActionExecutor();

    const step = executor.processRepeatingStep(action, game.getPlayer(1)!, executor.createPendingActionState('place', 1), 'Beta');

    expect(step.error).toMatch(/^Selection disabled: Tutorial step requires a specific piece/);
  });

  it('repeatingPickCandidates does not list a value the tutorial step gates out', () => {
    const { action, executor, player } = gatedGame(true);
    const pending = executor.createPendingActionState('place', 1);

    expect(executor.repeatingPickCandidates(action, player, pending)).toEqual(['a']);
  });

  it('a repeating pick of an unlisted value gets the standard refusal a non-repeating one gets', () => {
    const plain = gatedGame(false);
    const repeating = gatedGame(true);
    const pending = repeating.executor.createPendingActionState('place', 1);

    const plainError = plain.game.performAction('place', plain.player, { piece: 'z' }).error;
    const step = repeating.executor.processRepeatingStep(repeating.action, repeating.player, pending, 'z');

    expect(plainError).toBe(NO_LONGER_AVAILABLE);
    expect(step.error).toBe(NO_LONGER_AVAILABLE);
    expect(step.done).toBe(false);
  });

  it("a repeating pick of an unlisted value gets the game's own `unavailable` sentence", () => {
    const game = new Yard();
    const handed: unknown[] = [];
    const action = Action.create('place')
      .chooseFrom('piece', {
        choices: ['a', 'b'],
        unavailable: (value) => {
          handed.push(value);
          return 'That piece has left the table.';
        },
        ...once,
      })
      .execute(() => {});
    game.registerAction(action);
    const executor = game.getActionExecutor();

    const step = executor.processRepeatingStep(action, game.getPlayer(1)!, executor.createPendingActionState('place', 1), 'z');

    expect(step.error).toBe('That piece has left the table.');
    expect(handed).toEqual(['z']);
  });

  it('a repeating chooseElement pick of an element not on offer gets the standard refusal', () => {
    const game = new Yard();
    const action = Action.create('place')
      .chooseElement('stone', { elements: () => [game.stone('flint')], ...once })
      .execute(() => {});
    game.registerAction(action);
    const executor = game.getActionExecutor();

    const step = executor.processRepeatingStep(
      action, game.getPlayer(1)!, executor.createPendingActionState('place', 1), game.stone('slate').id,
    );

    expect(step.error).toBe(NO_LONGER_AVAILABLE);
  });
});

describe("a later pick's validate sees the earlier picks resolved (#507)", () => {
  it('after a repeating chooseElement, the one-pick-at-a-time path hands validate elements, not ids', () => {
    const game = new Yard();
    const seen: unknown[] = [];
    const action = Action.create('take')
      .chooseElement('stones', { elements: () => game.rocks.all(Stone), ...once })
      .chooseFrom('m', {
        choices: [1, 2],
        validate: (_m, args) => {
          seen.push(args.stones);
          return true;
        },
      })
      .execute(() => {});
    game.registerAction(action);
    const executor = game.getActionExecutor();
    const player = game.getPlayer(1)!;
    const slate = game.stone('slate');

    const pending = executor.createPendingActionState('take', 1);
    expect(executor.processSelectionStep(action, player, pending, 'stones', slate.id).success).toBe(true);
    expect(executor.processSelectionStep(action, player, pending, 'm', 1)).toEqual({ success: true });

    expect(seen).toEqual([[slate]]);
  });
});

describe('a repeating pick asks for its choices once (#507)', () => {
  it('runs the choices callback once to resolve and check a pick that ends the repeat', () => {
    const game = new Yard();
    let calls = 0;
    const action = Action.create('place')
      .chooseFrom('piece', {
        choices: () => {
          calls++;
          return [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
        },
        ...once,
      })
      .execute(() => {});
    game.registerAction(action);
    const executor = game.getActionExecutor();

    const step = executor.processRepeatingStep(action, game.getPlayer(1)!, executor.createPendingActionState('place', 1), 'Beta');

    expect(step).toEqual({ done: true });
    expect(calls).toBe(1);
  });
});

describe('an element reference that names nothing (#507)', () => {
  it.each([
    ['chooseElement', false],
    ['chooseElements', true],
  ])('a %s sent { id } for a missing element is refused, and `unavailable` is handed the id', (_kind, many) => {
    const game = new Yard();
    const handed: unknown[] = [];
    const options = {
      elements: () => game.rocks.all(Stone),
      unavailable: (value: unknown) => {
        handed.push(value);
        return 'That stone is gone.';
      },
    };
    const take = Action.create('take');
    game.registerAction((many ? take.chooseElements('pick', options) : take.chooseElement('pick', options)).execute(() => {}));

    const result = game.performAction('take', game.getPlayer(1)!, { pick: { id: 99_999 } });

    expect(result.error).toBe('That stone is gone.');
    expect(handed).toEqual([99_999]);
  });
});
