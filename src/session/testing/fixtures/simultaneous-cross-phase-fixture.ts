/**
 * Cross-phase adversarial fixture for Plan 160-02's D4 step-window-bound
 * (plan-check WARNING, T-160-04): TWO simultaneous-action-step frames in
 * sequence where the SAME seat (seat 2) is the only actor in BOTH -- step A
 * has ONLY seat 2 as a participant, so it completes the instant seat 2 acts
 * with nothing from any other seat ever recorded in between. Step B then
 * opens with both seats eligible, and seat 2 acts again FIRST (before seat
 * 1 ever acts).
 *
 * This is the pathological case a pure "most recent trailing action by this
 * seat" scan cannot distinguish from "this seat acted twice in the SAME
 * step": with nothing from any other seat between step A's and step B's
 * seat-2 actions, only a genuine per-step window (bounded by
 * `flowState.moveCount`, reset to 0 on entry to EACH simultaneous-step
 * frame -- see engine.ts's `executeSimultaneousActionStep`) can tell them
 * apart. Seat 2's undo in step B must rewind ONLY step B's action, never
 * reaching back across the step boundary into step A's.
 */

import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  simultaneousActionStep,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class CrossPhasePlayer extends Player<CrossPhaseGame, CrossPhasePlayer> {
  committedA = false;
  committedB = false;
}

class CrossPhaseGame extends Game<CrossPhaseGame, CrossPhasePlayer> {
  static PlayerClass = CrossPhasePlayer;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('commitA')
        .condition({ 'has not committed A yet': (ctx) => !(ctx.player as CrossPhasePlayer).committedA })
        .execute((_args, ctx) => {
          (ctx.player as CrossPhasePlayer).committedA = true;
          return { success: true };
        }),
    );

    this.registerAction(
      Action.create('commitB')
        .condition({ 'has not committed B yet': (ctx) => !(ctx.player as CrossPhasePlayer).committedB })
        .execute((_args, ctx) => {
          (ctx.player as CrossPhasePlayer).committedB = true;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: sequence(
          // Step A: seat 2 is the ONLY participant -- completes the instant
          // seat 2 commits, with no seat-1 action ever recorded here.
          simultaneousActionStep({
            name: 'step-a',
            players: () => this.players.filter((p) => p.seat === 2),
            actions: ['commitA'],
            playerDone: (_ctx, p) => (p as CrossPhasePlayer).committedA,
          }),
          // Step B: both seats are eligible; seat 2 acts first (seat 1 may
          // act later or never, within a single test).
          simultaneousActionStep({
            name: 'step-b',
            players: () => this.players,
            actions: ['commitB'],
            playerDone: (_ctx, p) => (p as CrossPhasePlayer).committedB,
          }),
        ),
      }),
    );
  }
}

export { CrossPhaseGame, CrossPhasePlayer };

export const crossPhaseFixtureDefinition: GameDefinitionLike = {
  gameClass: CrossPhaseGame as new (...args: unknown[]) => unknown,
  gameType: 'simultaneous-cross-phase',
  minPlayers: 2,
  maxPlayers: 2,
};
