import type { Game } from '../element/game.js';
import type { TutorialDefinition } from './types.js';
import { changing } from '../element/state-version.js';
import { dueSeats } from '../flow/seat-activity.js';
import { autoAdvanceTutorial, initialProgress } from './progress.js';

/**
 * Why `player` cannot start a tutorial for `learnerSeat` on a table of
 * `playerCount` seats, or `undefined` when it can. {@link startTutorial} checks
 * this itself; the server also checks it first, before building a game.
 */
export function learnerSeatRefusal(learnerSeat: number, player: number, playerCount: number): string | undefined {
  if (learnerSeat > playerCount) {
    return `This tutorial is for seat ${learnerSeat}, but this table has ${playerCount} seats, so no one can start it. ` +
      `Start it on a table of at least ${learnerSeat} players, or set the tutorial's learnerSeat to a seat this table has.`;
  }
  if (player !== learnerSeat) {
    return `This tutorial is for seat ${learnerSeat}, so seat ${player} cannot start it. Start it from seat ${learnerSeat}.`;
  }
  return undefined;
}

/**
 * Start `tutorial` for `player` on a started `game`: apply the tutorial's
 * setup, put the flow back at its beginning with the learner seat to move
 * (#546, #552), activate the first step for the learner alone and run the
 * auto-advance pump. The server's `startTutorial` op and `simulateTutorial`
 * both start a tutorial here, so the two cannot drift (#914).
 *
 * Returns why the tutorial cannot start, or `undefined` once it has started.
 * A refusal may leave `game` changed, so the caller discards it: when
 * `player` is not the learner seat or the table has no such seat, when the
 * game is over, or when the restarted flow still would not prompt the
 * learner (a tutorial the learner cannot act in is a dead table).
 */
export function startTutorial(game: Game, tutorial: TutorialDefinition, player: number): string | undefined {
  const seatRefusal = learnerSeatRefusal(tutorial.learnerSeat, player, game.players.length);
  if (seatRefusal) return seatRefusal;
  // #552: a finished game stays finished. The restart below could bring its
  // flow back to life while its phase still read 'finished'.
  if (game.phase === 'finished') {
    return 'The tutorial cannot start because this game is over. Start a new game, then start the tutorial.';
  }
  // R-01: the board is in the tutorial position before any advanceWhen predicate fires.
  const setup = tutorial.setup;
  if (setup) changing(game._ctx, () => setup(game));
  // This runs none of the game's opening again.
  const due = dueSeats(game.restartFlowForTutorial(tutorial.learnerSeat));
  if (!due.includes(player)) {
    const toMove = due.length > 0 ? `seat ${due.join(', ')} is` : 'no seat is';
    return `The tutorial cannot start for seat ${player}: when the game restarts for the tutorial, ` +
      `${toMove} to move, not seat ${player}. The game's flow gives the opening turn to a set seat, ` +
      `so set the tutorial's learnerSeat to the seat that moves first.`;
  }
  game.tutorialProgress.set(player, initialProgress(tutorial));
  // CR-01: steps whose advanceWhen is already true advance before the learner's first action.
  autoAdvanceTutorial(game, player);
  return undefined;
}
