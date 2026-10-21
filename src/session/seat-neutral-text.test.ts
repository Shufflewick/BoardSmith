/**
 * Text a game callback writes for a player is the engine's own when the
 * callback was handed a card the acting seat cannot see (#1293): a label, a
 * disabled reason, a refusal, a prompt and an `unavailable` sentence. The rule
 * still decides with the real card, and the author's text goes to the dev log.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  Game,
  Player,
  Space,
  Card,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { succeeded } from './op-result.test-helper.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { _clearShownWarnings } from '../utils/dev.js';

const name = (card: unknown) => (card as Card).name;

class TextGame extends Game<TextGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
    }
    this.first(Space, 'hand-1')!.create(Card, '2C');
    this.first(Space, 'hand-1')!.create(Card, '3D');
    this.first(Space, 'hand-2')!.create(Card, 'AS');
    this.first(Space, 'hand-2')!.create(Card, 'KH');
    const theirs = (ctx: { game: TextGame }) => ctx.game.first(Space, 'hand-2')!.all(Card);
    const mine = (ctx: { game: TextGame }) => ctx.game.first(Space, 'hand-1')!.all(Card);
    const done = () => ({ success: true });
    this.registerActions(
      Action.create<TextGame>('label')
        .chooseElement<'card', Card>('card', { elements: theirs, display: (card) => `the ${card.name}` })
        .execute(done),
      Action.create<TextGame>('labelFrom')
        .chooseFrom<'card', Card>('card', { choices: theirs, display: (card) => `the ${name(card)}` })
        .execute(done),
      Action.create<TextGame>('labelOwn')
        .chooseFrom('card', { choices: (ctx) => theirs(ctx).map((card) => ({ value: card, label: `the ${card.name}` })) })
        .execute(done),
      Action.create<TextGame>('grey')
        .chooseElement<'card', Card>('card', { elements: theirs, disabled: (card) => card.name === 'AS' && `The ${card.name} is locked` })
        .execute(done),
      Action.create<TextGame>('refuse')
        .chooseElement<'card', Card>('card', { elements: theirs, validate: (card) => `Not the ${card.name}` })
        .execute(done),
      Action.create<TextGame>('refuseAll')
        .chooseElement<'card', Card>('card', { elements: theirs })
        .validate((args) => `Not the ${name(args.card)}`)
        .execute(done),
      Action.create<TextGame>('pair')
        .chooseElement<'card', Card>('card', { elements: theirs })
        .chooseElement<'mine', Card>('mine', {
          elements: mine,
          display: (card, ctx) => `${card.name} with the ${name(ctx.args.card)}`,
          disabled: (card, ctx) => card.name === '2C' && `The ${name(ctx.args.card)} blocks it`,
        })
        .execute(done),
      Action.create<TextGame>('pairNowhere')
        .chooseElement<'card', Card>('card', { elements: theirs })
        .chooseElement<'mine', Card>('mine', { elements: () => [], prompt: (ctx) => (ctx.args.card ? `Pair the ${name(ctx.args.card)}` : 'Pair it') })
        .execute(done),
      Action.create<TextGame>('pairAndSay')
        .chooseElement<'card', Card>('card', { elements: theirs })
        .chooseFrom('what', {
          choices: [{ value: 1, label: 'Discard it' }, { value: 2, label: 'Keep it' }],
          display: (choice) => `Choice ${String(choice)}`,
        })
        .execute(done),
      Action.create<TextGame>('pairGone')
        .chooseElement<'card', Card>('card', { elements: theirs })
        .chooseFrom('where', { choices: ['left'], unavailable: (_value, ctx) => `The ${name(ctx.args.card)} went nowhere` })
        .execute(done),
      Action.create<TextGame>('own')
        .chooseElement<'mine', Card>('mine', {
          elements: mine,
          display: (card) => `the ${card.name}`,
          disabled: (card) => card.name === '2C' && `The ${card.name} is tired`,
        })
        .execute(done),
      Action.create<TextGame>('ownRefuse')
        .chooseElement<'mine', Card>('mine', { elements: mine, validate: (card) => `Not the ${card.name}` })
        .execute(done),
    );
    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({
            actions: ['label', 'labelFrom', 'labelOwn', 'grey', 'refuse', 'refuseAll', 'pair', 'pairNowhere', 'pairAndSay', 'pairGone', 'own', 'ownRefuse'],
          }),
        }),
      }),
    });
  }
}

const NEUTRAL_DISABLED = 'You cannot choose this one right now. Choose another.';
const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

const definition: GameDefinitionLike = { gameClass: TextGame, gameType: 'text', minPlayers: 2, maxPlayers: 2 };
const options = { playerCount: 2, seed: 'bs1293' };

type Node = { id: number; name?: string; children?: Node[] };

function findByName(node: Node, wanted: string): Node | undefined {
  if (node.name === wanted) return node;
  for (const child of node.children ?? []) {
    const found = findByName(child, wanted);
    if (found) return found;
  }
  return undefined;
}

/** A started game, and the ids seat 1's board shows for its own 2C and seat 2's hidden AS. */
async function started() {
  const start = succeeded(await executeOp(definition, options, null, null, { type: 'start' }));
  const view = (start.playerViews[0] as { state: { view: Node } }).state.view;
  const idIn = (hand: string) => findByName(view, hand)!.children![0]!.id;
  const choices = (actionName: string, selectionName: string, args: Record<string, unknown> = {}) =>
    executeOp(definition, options, start.snapshot, null, { type: 'resolveChoices', actionName, selectionName, player: 1, args });
  const act = (actionName: string, args: Record<string, unknown>) =>
    executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName, player: 1, args, boundaryKey: boundaryKeyOf(start.snapshot),
    });
  return { two: idIn('hand-1'), ace: idIn('hand-2'), choices, act };
}

describe('text a callback writes after it was handed a card the seat cannot see (#1293)', () => {
  let warn: MockInstance;
  const devLog = () => warn.mock.calls.map((call) => call.join(' ')).join('\n');
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The dev log says each replaced callback once per process.
    _clearShownWarnings();
  });
  afterEach(() => warn.mockRestore());

  it.each(['label', 'labelFrom', 'labelOwn'])('%s: a hidden candidate is labelled neutrally, its own label in the dev log', async (actionName) => {
    const { choices } = await started();
    const res = succeeded(await choices(actionName, 'card'));

    const labels = (res.validElements ?? res.choices)!.map((c) => c.display);
    expect(labels).toEqual(['Card #1', 'Card #2']);
    expect(JSON.stringify(res)).not.toMatch(/\bAS\b|\bKH\b/);
    expect(devLog()).toContain('the AS');
  });

  it("a hidden candidate's disabled reason is neutral, and so is the refusal of it", async () => {
    const { choices, act, ace } = await started();
    const res = succeeded(await choices('grey', 'card'));
    expect(res.validElements?.map((e) => e.disabled)).toEqual([NEUTRAL_DISABLED, undefined]);
    expect(devLog()).toContain('The AS is locked');

    const refused = await act('grey', { card: ace });
    expect((refused as { error: string }).error).toBe(`Selection disabled: ${NEUTRAL_DISABLED}`);
  });

  it("a selection's validate refuses a hidden pick in the engine's words", async () => {
    const { act, ace } = await started();
    const res = await act('refuse', { card: ace });
    expect((res as { error: string }).error).toBe('Invalid card');
    expect(devLog()).toContain('Not the AS');
  });

  it("the action's validate refuses a hidden pick in the engine's words", async () => {
    const { act, ace } = await started();
    const res = await act('refuseAll', { card: ace });
    expect((res as { error: string }).error).toBe("Action 'refuseAll' is not allowed with these choices");
    expect(devLog()).toContain('Not the AS');
  });

  it("a later pick's labels and reasons are the engine's while an earlier pick is hidden", async () => {
    const { choices, ace } = await started();
    const res = succeeded(await choices('pair', 'mine', { card: ace }));
    expect(res.validElements?.map((e) => [e.display, e.disabled])).toEqual([['2C', NEUTRAL_DISABLED], ['3D', undefined]]);
    // Once per callback, and checking the action is open walks every hidden card, so either may be the one logged.
    expect(devLog()).toMatch(/2C with the (AS|KH)/);
    expect(devLog()).toMatch(/The (AS|KH) blocks it/);
  });

  it("a later choice's labels stay the game's: they were handed only the choice, not the hidden pick", async () => {
    const { choices, ace } = await started();
    const res = succeeded(await choices('pairAndSay', 'what', { card: ace }));
    expect(res.choices?.map((c) => c.display)).toEqual(['Discard it', 'Keep it']);
  });

  it("a later pick's prompt is not the game's while an earlier pick is hidden", async () => {
    const { choices, ace } = await started();
    const res = await choices('pairNowhere', 'mine', { card: ace });
    expect((res as { error: string }).error).toContain('"mine"');
    expect(JSON.stringify(res)).not.toMatch(/\bAS\b/);
    expect(devLog()).toContain('Pair the AS');
  });

  it("unavailable's sentence is the engine's while an earlier pick is hidden", async () => {
    const { act, ace } = await started();
    const res = await act('pairGone', { card: ace, where: 'right' });
    expect((res as { error: string }).error).toBe(NO_LONGER_AVAILABLE);
    expect(devLog()).toContain('The AS went nowhere');
  });

  it("keeps the game's own text when nothing it was handed is hidden", async () => {
    const { choices, act, two } = await started();
    const res = succeeded(await choices('own', 'mine'));
    expect(res.validElements?.map((e) => [e.display, e.disabled])).toEqual([['the 2C', 'The 2C is tired'], ['the 3D', undefined]]);

    const refused = await act('ownRefuse', { mine: two });
    expect((refused as { error: string }).error).toBe('Not the 2C');
  });
});
