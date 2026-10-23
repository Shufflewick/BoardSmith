/**
 * WHERE A GAME SAYS A CHOICE SITS (#1439).
 *
 * `group` on `chooseFrom` and `chooseElement` puts each choice under a category
 * path, the way `.group()` places an action (#228): a list of labels, outermost
 * first, `[]` for the top level. It arranges buttons and decides nothing about
 * the rules, so which choices are offered, why one is disabled and what the
 * server accepts stay as they were.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Action, actionStep } from '../index.js';
import { formatChoiceCandidates, formatElementCandidates, type AnnotatedCandidate } from '../element/pick-candidates.js';
import type { ChoiceSelection, ElementSelection } from './types.js';

const UNITS = ['Scout', 'Rifleman', 'Tank'];
const groupOf = (unit: string) => (unit === 'Scout' ? [] : unit === 'Tank' ? ['Vehicles', 'Heavy'] : ['Infantry']);

class ArmyGame extends Game<ArmyGame, Player> {
  recruited: string[] = [];
}

function makeGame(group: (unit: string) => string[] = groupOf): ArmyGame {
  const game = new ArmyGame({ playerCount: 2, seed: 'choice-groups' });
  game.registerActions(
    Action.create<ArmyGame>('recruit')
      .chooseFrom('unit', {
        choices: UNITS,
        group,
        disabled: (unit) => (unit === 'Tank' ? 'You need a factory first.' : false),
      })
      .execute(({ unit }, ctx) => {
        ctx.game.recruited.push(unit);
      }),
  );
  game.setFlow({ root: actionStep({ actions: ['recruit'] }) });
  game.startFlow();
  return game;
}

/** The recruit pick's choices as the wire carries them to seat 1. */
function offeredUnits(game: ArmyGame) {
  const player = game.getPlayer(1)!;
  const selection = game.getAction('recruit')!.selections[0] as ChoiceSelection;
  const candidates = game.getActionExecutor().getChoices(selection, player, {}, 'recruit') as AnnotatedCandidate[];
  return formatChoiceCandidates(candidates, selection, { game, player, args: {} }, []);
}

describe('group on chooseFrom', () => {
  it('sends each choice its category path, and none for a top-level choice', () => {
    expect(offeredUnits(makeGame())).toEqual([
      { value: 'Scout', display: 'Scout' },
      { value: 'Rifleman', display: 'Rifleman', group: ['Infantry'] },
      { value: 'Tank', display: 'Tank', group: ['Vehicles', 'Heavy'], disabled: 'You need a factory first.' },
    ]);
  });

  it('changes nothing about the rules: a disabled choice is still refused, an offered one taken', () => {
    const game = makeGame();
    const refused = game.performAction('recruit', game.getPlayer(1)!, { unit: 'Tank' });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain('You need a factory first.');
    expect(game.performAction('recruit', game.getPlayer(1)!, { unit: 'Rifleman' }).success).toBe(true);
    expect(game.recruited).toEqual(['Rifleman']);
  });

  it('refuses a blank category label, naming the pick', () => {
    expect(() => offeredUnits(makeGame(() => ['Army', ' ']))).toThrow(/'unit'.*blank category label/);
  });

  it('refuses group on a multiSelect or orderedList pick, which the panel cannot drill into', () => {
    // A type error too; cast so the run-time refusal, which a forwarded count reaches, is what is tested.
    expect(() => Action.create<ArmyGame>('x').chooseFrom('unit', { choices: UNITS, group: groupOf, multiSelect: 2 } as never))
      .toThrow(/chooseFrom\('unit'\) declares group with multiSelect/);
    expect(() => Action.create<ArmyGame>('x').chooseFrom('unit', { choices: UNITS, group: groupOf, orderedList: 2 } as never))
      .toThrow(/chooseFrom\('unit'\) declares group with orderedList/);
  });
});

describe('group on chooseElement', () => {
  class Building extends Piece<ArmyGame> {
    kind!: string;
  }

  function candidates(hidden: boolean) {
    const game = new ArmyGame({ playerCount: 2, seed: 'elements' });
    const barracks = game.create(Building, 'Barracks', { kind: 'Military' });
    const farm = game.create(Building, 'Farm', { kind: 'Economy' });
    if (hidden) barracks.hideFromAll();
    const selection = { type: 'element', name: 'building', group: (b: Building) => [b.kind] } as unknown as ElementSelection;
    const ctx = { game, player: game.getPlayer(1)!, args: {} };
    return formatElementCandidates([barracks, farm].map((value) => ({ value, disabled: false as const })), selection, ctx, []);
  }

  it('sends each element its category path', () => {
    expect(candidates(false).map((e) => e.group)).toEqual([['Military'], ['Economy']]);
  });

  it('leaves an element the seat cannot see at the top level, since its category could name it (#1293)', () => {
    expect(candidates(true).map((e) => e.group)).toEqual([undefined, ['Economy']]);
  });
});
