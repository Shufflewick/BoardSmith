/**
 * WHAT A VERB IS ABOUT (#1640).
 *
 * A game declares its subject types once (a pack, a unit type) and a pick says
 * only which thing its value is. Each candidate row then carries the thing it
 * is, keyed and labelled by the type, so every action names one thing the same
 * way, and `subjectIndex` inverts the first-pick lists into "which verbs take
 * which thing".
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Action, actionStep, subjectType, eitherSubject, subjectIndex } from '../index.js';
import { buildActionMetadata } from '../element/action-metadata.js';
import { formatChoiceCandidates, formatElementCandidates, type AnnotatedCandidate } from '../element/pick-candidates.js';
import type { ChoiceSelection, ElementSelection } from './types.js';
import type { ActionMetadata, PickSubject } from '../../types/protocol.js';

class Pack extends Piece<PackGame> {
  unitType!: string;
}
class Building extends Piece<PackGame> {}
class PackGame extends Game<PackGame, Player> {}

const UNIT_TYPES = subjectType<string>({ name: 'Unit types', onBoard: false, key: (unit) => unit, label: (unit) => unit, category: () => ['Infantry'] });
const PACKS = subjectType<Pack>({
  name: 'Packs',
  onBoard: true,
  label: (pack) => `${pack.unitType} pack`,
  related: (pack) => [UNIT_TYPES.ref(pack.unitType)],
});
const BUILDINGS = subjectType<Building>({ name: 'Buildings', onBoard: true, label: (building) => building.name! });

/** One pack is `pack.id` in one action and `fielded:<id>` in another; the type keys both the same. */
const fielded = PACKS.of((token: string, ctx) => ctx.game.getElementById(Number(token.slice('fielded:'.length))) as Pack);

function makeGame() {
  const game = new PackGame({ playerCount: 2, seed: 'subjects' });
  const fusiliers = game.create(Pack, 'fusiliers', { unitType: 'Fusiliers' });
  const lancers = game.create(Pack, 'lancers', { unitType: 'Lancers' });
  const hq = game.create(Building, 'HQ');
  game.registerActions(
    Action.create<PackGame>('movePack').chooseElement('pack', { elementClass: Pack, subject: PACKS }).execute(() => {}),
    Action.create<PackGame>('sellPack')
      .chooseFrom('pack', { choices: (ctx) => ctx.game.all(Pack).map((pack) => `fielded:${pack.id}`), subject: fielded })
      .execute(() => {}),
    Action.create<PackGame>('buyPack').chooseFrom('unit', { choices: ['Fusiliers', 'Lancers'], subject: UNIT_TYPES }).execute(() => {}),
    Action.create<PackGame>('rally')
      .chooseFrom('target', {
        choices: (ctx) => [...ctx.game.all(Pack).map((pack) => `fielded:${pack.id}`), 'hq'],
        subject: eitherSubject(PACKS.of((token: string, ctx) => (token === 'hq' ? undefined : ctx.game.getElementById(Number(token.slice(8))) as Pack)), BUILDINGS.of((_token: string, ctx) => ctx.game.first(Building, "HQ"))),
      })
      .execute(() => {}),
    Action.create<PackGame>('deploy')
      .chooseFrom('side', { choices: ['north', 'south'] })
      .chooseElement('pack', { elementClass: Pack, subject: PACKS })
      .execute(() => {}),
    Action.create<PackGame>('rename').enterText('name', { subject: UNIT_TYPES }).execute(() => {}),
    Action.create<PackGame>('inspect').about(PACKS, (ctx) => ctx.game.first(Pack, 'lancers')).execute(() => {}),
  );
  game.setFlow({ root: actionStep({ actions: ['movePack', 'sellPack', 'buyPack', 'rally', 'deploy', 'rename', 'inspect'] }) });
  game.startFlow();
  return { game, fusiliers, lancers, hq };
}

function rows(game: PackGame, actionName: string) {
  const player = game.getPlayer(1)!;
  const selection = game.getAction(actionName)!.selections[0]!;
  const candidates = game.getActionExecutor().getChoices(selection, player, {}, actionName) as AnnotatedCandidate[];
  const ctx = { game, player, args: {} };
  return selection.type === 'choice'
    ? formatChoiceCandidates(candidates, selection, ctx, [])
    : formatElementCandidates(candidates, selection as ElementSelection, ctx, []);
}

describe('a candidate row carries the thing it is', () => {
  it('keys an element thing by its id and labels it by the type, with its related things', () => {
    const { game, fusiliers } = makeGame();
    expect(rows(game, 'movePack')[0]!.subject).toEqual({
      type: 'Packs',
      key: String(fusiliers.id),
      element: fusiliers.id,
      label: 'Fusiliers pack',
      related: [{ type: 'Unit types', key: 'Fusiliers' }],
    });
  });

  it('names one pack the same way whether the pick lists the element or a token for it', () => {
    const { game } = makeGame();
    expect(rows(game, 'sellPack').map((row) => row.subject)).toEqual(rows(game, 'movePack').map((row) => row.subject));
  });

  it('gives a non-element thing the key and category its type declares', () => {
    const { game } = makeGame();
    expect(rows(game, 'buyPack')[1]!.subject).toEqual({ type: 'Unit types', key: 'Lancers', label: 'Lancers', category: ['Infantry'] });
  });

  it('lets one pick list two kinds of thing', () => {
    const { game, hq } = makeGame();
    expect(rows(game, 'rally').map((row) => row.subject?.type)).toEqual(['Packs', 'Packs', 'Buildings']);
    expect(rows(game, 'rally')[2]!.subject).toMatchObject({ key: String(hq.id), label: 'HQ' });
  });

  it('gives a candidate the seat cannot see no subject, since its key and label could name it', () => {
    const { game, fusiliers } = makeGame();
    fusiliers.hideFromAll();
    expect(rows(game, 'movePack').map((row) => row.subject?.label)).toEqual([undefined, 'Lancers pack']);
  });

  it('sends nothing for a pick that binds no subject', () => {
    const { game } = makeGame();
    const side = game.getAction('deploy')!.selections[0] as ChoiceSelection;
    const candidates = game.getActionExecutor().getChoices(side, game.getPlayer(1)!, {}, 'deploy') as AnnotatedCandidate[];
    expect(formatChoiceCandidates(candidates, side, { game, player: game.getPlayer(1)!, args: {} }, [])
      .some((row) => 'subject' in row)).toBe(false);
  });
});

describe('the action metadata says which picks are about which types', () => {
  const metadata = () => {
    const { game } = makeGame();
    return { game, meta: buildActionMetadata(game, game.getPlayer(1)!, ['movePack', 'buyPack', 'rally', 'deploy', 'rename', 'inspect']) };
  };

  it('names each bound pick\'s types and whether their things are on the board', () => {
    const { meta } = metadata();
    expect(meta.movePack!.selections[0]!.subjectTypes).toEqual([{ name: 'Packs', onBoard: true }]);
    expect(meta.buyPack!.selections[0]!.subjectTypes).toEqual([{ name: 'Unit types', onBoard: false }]);
    expect(meta.rally!.selections[0]!.subjectTypes).toEqual([{ name: 'Packs', onBoard: true }, { name: 'Buildings', onBoard: true }]);
    expect(meta.deploy!.selections.map((pick) => pick.subjectTypes)).toEqual([undefined, [{ name: 'Packs', onBoard: true }]]);
    expect(meta.rename!.selections[0]!.subjectTypes).toEqual([{ name: 'Unit types', onBoard: false }]);
  });

  it('carries the things an action is about without picking them', () => {
    const { game, meta } = metadata();
    const lancers = game.first(Pack, 'lancers')!;
    expect(meta.inspect!.about).toEqual([expect.objectContaining({ type: 'Packs', key: String(lancers.id), label: 'Lancers pack' })]);
    expect(meta.movePack!.about).toBeUndefined();
  });
});

describe('what a subject declaration refuses', () => {
  it('refuses a subject on a pick that takes several values, since the panel lists one thing at a time', () => {
    const multi = { choices: ['Fusiliers'], subject: UNIT_TYPES, multiSelect: 2 } as never;
    expect(() => Action.create<PackGame>('x').chooseFrom('unit', multi)).toThrow(/chooseFrom\('unit'\) binds subject Unit types.*multiSelect/);
    const ordered = { choices: ['Fusiliers'], subject: UNIT_TYPES, orderedList: 2 } as never;
    expect(() => Action.create<PackGame>('x').chooseFrom('unit', ordered)).toThrow(/orderedList/);
    expect(() => Action.create<PackGame>('x').chooseElement('pack', { elementClass: Pack, subject: PACKS, repeatUntil: 'done', repeat: {} } as never))
      .toThrow(/chooseElement\('pack'\) binds subject Packs.*repeat/);
  });

  it('refuses an eitherSubject whose earlier type would claim every value', () => {
    expect(() => eitherSubject(PACKS as never, BUILDINGS as never)).toThrow(/Packs.*before the last.*\.of\(\)/);
  });

  it('refuses a category deeper than two levels, or a blank one', () => {
    const deep = subjectType<string>({ name: 'Deep', onBoard: false, key: (s) => s, label: (s) => s, category: () => ['A', 'B', 'C'] });
    const blank = subjectType<string>({ name: 'Blank', onBoard: false, key: (s) => s, label: (s) => s, category: () => [' '] });
    const ctx = makeGame();
    const subjectOf = (type: typeof deep) => type.describe('x', { game: ctx.game, player: ctx.game.getPlayer(1)!, args: {} });
    expect(() => subjectOf(deep)).toThrow(/Deep.*"x".*3 category levels.*at most two/);
    expect(() => subjectOf(blank)).toThrow(/Blank.*"x".*blank category/);
  });

  it('refuses a thing the type does not list, naming the pick\'s mapping', () => {
    const listed = subjectType<string>({ name: 'Listed', onBoard: false, key: (s) => s, label: (s) => s, things: () => ['a', 'b'] });
    const { game } = makeGame();
    expect(() => listed.describe('z', { game, player: game.getPlayer(1)!, args: {} }))
      .toThrow(/Listed "z" is not one of the 2 Listed the type lists/);
  });

  it('refuses a table thing with no label, since only a world offer may leave a thing unnamed', () => {
    const unnamed = subjectType<string>({ name: 'Unnamed', onBoard: false, key: (s) => s, label: () => undefined });
    const { game } = makeGame();
    expect(() => unnamed.describe('a', { game, player: game.getPlayer(1)!, args: {} })).toThrow(/Unnamed "a" has no label/);
  });

  it('types a key only where the thing is not a game element, and a mapping only to the type\'s things', () => {
    // @ts-expect-error a game element is keyed by its id, so its type takes no key
    subjectType<Pack>({ name: 'P', onBoard: true, key: (pack) => pack.name!, label: () => '' });
    // @ts-expect-error a thing that is not a game element needs a key
    subjectType<string>({ name: 'S', onBoard: false, label: () => '' });
    // @ts-expect-error a mapping must return the type's own kind of thing
    PACKS.of((token: string, ctx) => ctx.game.first(Building));
    Action.create<PackGame>('x').chooseElements('packs', {
      elements: [],
      // @ts-expect-error a many-element pick names several things, so it binds no subject
      subject: PACKS,
    });
  });
});

describe('subjectIndex: which verbs take which thing', () => {
  const index = () => {
    const { game, fusiliers, lancers, hq } = makeGame();
    const player = game.getPlayer(1)!;
    const meta = buildActionMetadata(game, player, ['movePack', 'sellPack', 'buyPack', 'rally', 'deploy', 'rename', 'inspect']);
    for (const name of ['movePack', 'sellPack', 'buyPack', 'rally']) {
      const first = meta[name]!.selections[0]!;
      const answered = rows(game, name);
      if (first.type === 'choice') first.choices = answered as never;
      else first.validElements = answered as never;
    }
    return { result: subjectIndex(Object.values(meta)), fusiliers, lancers, hq };
  };

  it('lists each thing once, with every verb whose first pick lists it and the row value that names it', () => {
    const { result, fusiliers } = index();
    const pack = result.things.find((thing) => thing.key === String(fusiliers.id))!;
    expect(pack).toMatchObject({ type: 'Packs', label: 'Fusiliers pack', onBoard: true });
    expect(pack.verbs).toEqual([
      { action: 'movePack', pick: 'pack', value: fusiliers.id },
      { action: 'sellPack', pick: 'pack', value: `fielded:${fusiliers.id}` },
      { action: 'rally', pick: 'target', value: `fielded:${fusiliers.id}` },
    ]);
  });

  it('lists a verb under a thing it is about without picking it', () => {
    const { result, lancers } = index();
    expect(result.things.find((thing) => thing.key === String(lancers.id))!.verbs).toContainEqual({ action: 'inspect' });
  });

  it('takes an action off the action list only when its first pick is on-board things, each row a different one', () => {
    const { result } = index();
    // buyPack's unit types are not on the board; rally's two kinds are both on it.
    expect([...result.listedUnderThings].sort()).toEqual(['movePack', 'rally', 'sellPack']);
  });

  it('keeps an action on the list when a row is no thing, or two rows are one thing', () => {
    const action = (name: string, choices: ActionMetadata['selections'][number]['choices']): ActionMetadata => ({
      name,
      selections: [{ name: 'pack', type: 'choice', subjectTypes: [{ name: 'Packs', onBoard: true }], choices }],
    });
    const pack = { type: 'Packs', key: '1', label: 'Pack' };
    const result = subjectIndex([
      action('mixed', [{ value: 'a', display: 'a', subject: pack }, { value: 'b', display: 'b' }]),
      action('twice', [{ value: 'a', display: 'a', subject: pack }, { value: 'b', display: 'b', subject: pack }]),
      action('empty', []),
    ]);
    expect([...result.listedUnderThings]).toEqual([]);
    expect(result.things[0]!.verbs.map((verb) => verb.action)).toEqual(['mixed', 'twice', 'twice']);
  });

  it('reports a verb that takes a thing in a later pick or as typed text', () => {
    const { result } = index();
    expect(result.laterVerbs).toEqual([
      { type: 'Packs', action: 'deploy', pick: 'pack' },
      { type: 'Unit types', action: 'rename', pick: 'name' },
    ]);
  });

  it('labels a thing by the first row that names it, and by its key when none does', () => {
    const named = { type: 'Colonies', key: 'home:1', label: 'Aster' };
    const unnamed = { type: 'Colonies', key: 'home:1' };
    const pick = (subject: PickSubject) => ({ name: 'colony', type: 'choice' as const, subjectTypes: [{ name: 'Colonies', onBoard: true }], choices: [{ value: 1, display: 'x', subject }] });
    expect(subjectIndex([{ name: 'a', selections: [pick(unnamed)] }, { name: 'b', selections: [pick(named)] }]).things[0]!.label).toBe('Aster');
    expect(subjectIndex([{ name: 'a', selections: [pick(unnamed)] }]).things[0]!.label).toBe('home:1');
  });
});
