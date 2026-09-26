/**
 * Survival of the Fittest's `sendMail` recipients (#392): a name typed into
 * `to`, then an optional "who exactly?" pick narrowed to the people whose name
 * starts with it. Shared by the controller's and the Action Panel's pick-order
 * tests, so both narrow the same list the same way.
 */
import type { PickChoicesResult } from './useActionControllerTypes.js';
import { Action, type Game } from '../../engine/index.js';

export const PEOPLE = ['Player 3', 'Player 30', 'Player 4'];

/** The recipient choices once `to` is bound, as a world's `resolvePick` would answer them. */
export function recipientChoices(to: unknown): NonNullable<PickChoicesResult['choices']> {
  const prefix = String(to ?? '');
  return PEOPLE.filter((p) => p.startsWith(prefix)).map((p) => ({ value: p, display: p }));
}

/**
 * `sendMail`'s first two picks as a table game declares them: `to`, then an
 * optional `recipient` narrowed by it through `dependsOn`. Chain the rest of
 * the action onto it.
 */
export function mailPicks<G extends Game>() {
  return Action.create<G>('sendMail')
    .chooseFrom('to', { choices: ['Player 3', 'Player 4'] })
    .chooseFrom('recipient', {
      dependsOn: 'to',
      optional: 'Anyone of that name',
      choices: (ctx) => PEOPLE.filter((p) => p.startsWith(String(ctx.args.to ?? ''))),
    });
}
