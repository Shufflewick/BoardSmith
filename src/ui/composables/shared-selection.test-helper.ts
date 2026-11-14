/**
 * A GAME WHOSE VERBS ARE ABOUT THINGS (#1641), for the shared selection's tests.
 *
 * Three dice, each taken by two verbs (Reroll picks the element, Draft a token
 * mapped to it; the green die cannot be rerolled) and by Place a die in a later
 * pick. Two towers, each taken by Upgrade alone, and the blueprints that belong
 * to them, which Buy a blueprint lists verb first because blueprints are not on
 * the board. Buy a blueprint and Trade share the Shop group. Each die's color
 * is a related thing, which Paint takes.
 */
import { Game, Player, Piece, Action, actionStep, subjectType, type GameOptions } from '../../engine/index.js';

export class Die extends Piece<WorkshopGame> {
  face = 1;
}

export class Tower extends Piece<WorkshopGame> {}

const BLUEPRINT_TOWER: Record<string, string> = { 'Fire Curtain': 'Chemical Works', 'Tar Slick': 'Chemical Works', 'Brass Loan': 'Bank' };

const COLORS = subjectType<string>({ name: 'Colors', onBoard: false, key: (color) => color, label: (color) => color });
export const DICE = subjectType<Die>({ name: 'Dice', onBoard: true, label: (die) => `${die.name} showing ${die.face}`, related: (die) => [COLORS.ref(die.name!)] });
export const TOWERS = subjectType<Tower>({ name: 'Towers', onBoard: true, label: (tower) => tower.name! });
const BLUEPRINTS = subjectType<string>({
  name: 'Blueprints',
  onBoard: false,
  key: (blueprint) => blueprint,
  label: (blueprint) => blueprint,
  within: (blueprint, ctx) => TOWERS.ref(ctx.game.first(Tower, BLUEPRINT_TOWER[blueprint])!),
});

const token = (die: Die) => `die:${die.id}`;

export class WorkshopGame extends Game<WorkshopGame, Player> {
  log: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    for (const name of ['red', 'blue', 'green']) this.create(Die, name);
    for (const name of ['Chemical Works', 'Bank']) this.create(Tower, name);
    const dieOf = (value: string, ctx: { game: Game }) => ctx.game.getElementById(Number(value.slice('die:'.length))) as Die;
    this.registerActions(
      Action.create<WorkshopGame>('reroll').prompt('Reroll')
        .chooseElement('die', { elements: (ctx) => [...ctx.game.all(Die)], subject: DICE, disabled: (die) => (die.name === 'green' ? 'The green die is spent.' : false) })
        .execute(({ die }, ctx) => { ctx.game.log.push(`reroll ${die.name}`); }),
      Action.create<WorkshopGame>('draft').prompt('Draft')
        .chooseFrom('die', { choices: (ctx) => ctx.game.all(Die).map(token), subject: DICE.of(dieOf) })
        .execute(({ die }, ctx) => { ctx.game.log.push(`draft ${dieOf(die, ctx).name}`); }),
      Action.create<WorkshopGame>('upgrade').prompt('Upgrade')
        .chooseElement('tower', { elements: (ctx) => [...ctx.game.all(Tower)], subject: TOWERS })
        .execute(({ tower }, ctx) => { ctx.game.log.push(`upgrade ${tower.name}`); }),
      Action.create<WorkshopGame>('buyBlueprint').prompt('Buy a blueprint').group('Shop')
        .chooseFrom('blueprint', { choices: Object.keys(BLUEPRINT_TOWER), subject: BLUEPRINTS })
        .execute(({ blueprint }, ctx) => { ctx.game.log.push(`buy ${blueprint}`); }),
      Action.create<WorkshopGame>('trade').prompt('Trade').group('Shop')
        .chooseFrom('good', { choices: ['wood', 'ore'] })
        .execute(({ good }, ctx) => { ctx.game.log.push(`trade ${good}`); }),
      Action.create<WorkshopGame>('paint').prompt('Paint')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'], subject: COLORS })
        .execute(({ color }, ctx) => { ctx.game.log.push(`paint ${color}`); }),
      Action.create<WorkshopGame>('placeDie').prompt('Place a die').group('Slots')
        .chooseFrom('slot', { choices: ['top', 'bottom'] })
        .chooseElement('die', { elements: (ctx) => [...ctx.game.all(Die)], subject: DICE })
        .execute(({ slot, die }, ctx) => { ctx.game.log.push(`place ${die.name} ${slot}`); }),
      Action.create<WorkshopGame>('pass').prompt('Pass')
        .execute((_, ctx) => { ctx.game.log.push('pass'); }),
    );
    this.setFlow({
      root: actionStep({
        actions: ['reroll', 'draft', 'upgrade', 'buyBlueprint', 'trade', 'paint', 'placeDie', 'pass'],
        player: (ctx) => ctx.game.getPlayer(1)!,
        repeatUntil: () => false,
        maxMoves: 20,
      }),
    });
  }
}

/** A game whose every verb is about a die, so its whole top level is the one type. */
export class DiceTrayGame extends Game<DiceTrayGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const name of ['red', 'blue']) this.create(Die, name);
    this.registerActions(
      Action.create<DiceTrayGame>('reroll').prompt('Reroll')
        .chooseElement('die', { elements: (ctx) => [...ctx.game.all(Die)], subject: DICE })
        .execute(() => {}),
      Action.create<DiceTrayGame>('keep').prompt('Keep')
        .chooseElement('die', { elements: (ctx) => [...ctx.game.all(Die)], subject: DICE })
        .execute(() => {}),
    );
    this.setFlow({ root: actionStep({ actions: ['reroll', 'keep'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 5 }) });
  }
}
