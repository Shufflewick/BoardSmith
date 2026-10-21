/**
 * The seat's search copy: the game the MCTS bot searches, rebuilt from a
 * snapshot of what one seat may see (#1362). The bot builds every copy here,
 * and `searchCopyForSeat` builds one the same way for a game's own tests, so a
 * sampler or `afterRestore` hook sees in a test exactly what it sees in a search.
 */

import type { Game, GameOptions, RandomState } from '../engine/index.js';
import type { GameStateSnapshot } from '../engine/utils/index.js';
import { createSeatSnapshot, snapshotTree } from '../engine/utils/index.js';
import { constructGame } from '../engine/element/game.js';
import { adoptSeatView, applyDeterminization } from './determinization.js';
import type { DeterminizeSampler } from './types.js';

/** A sampler and the seeded [0, 1) source it draws from. */
export interface WorldSample {
  determinize: DeterminizeSampler;
  rng: () => number;
}

/**
 * Restore a game from a snapshot — fully STATE-AUTHORITATIVE, NO replay.
 *
 * Mirrors `GameRunner.fromSnapshot`: the snapshot carries the complete
 * authoritative state (element tree, flow position, sequence counter, seeded
 * RNG), so we adopt those directly instead of replaying action history.
 * Replay was unsound for the search root: selection-step /
 * pending-completed actions mutate the tree via `Piece.putInto` and are not
 * recorded in action history, so a root carrying such a mutation lost it on
 * every clone and the bot searched from a wrong position. Adopting the
 * serialized tree keeps those mutations.
 *
 * `randomState` is the position the copy draws from next, and `sample` draws
 * a fresh world into it; both come before the elements' `afterRestore` hooks,
 * which run last so they see the whole copy (#1352).
 */
export function restoreSeatCopy<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  snapshot: GameStateSnapshot,
  seat: number,
  randomState: RandomState,
  sample?: WorldSample,
): G {
  // The game's own constructor options, custom ones (playerConfigs) and its
  // element id key included, with the search game's own seed (#776). Every
  // snapshot the bot restores is one it captured itself, and
  // `createSeatSnapshot` and `createSnapshot` always record them. They are required: element ids are
  // minted under the game's own key (#447), which only these options carry,
  // and `snapshot.seed` is the BOT's search seed, not the search game's.
  const gameOptions = snapshot.gameOptions;
  if (gameOptions === undefined) {
    throw new Error(
      'MCTS bot cannot restore a snapshot without gameOptions: the search game must be built ' +
        "with the game's own options and seed. Capture it with createSeatSnapshot, which records them.",
    );
  }

  const game = constructGame(GameClass, gameOptions as GameOptions);

  // Adopt the authoritative element tree (clears + rebuilds children, re-points
  // the game's own serialized refs, resolves element references).
  //
  // The message log rides beside the tree, not in it. The search game gets it
  // so a game whose rules read `game.messages` evaluates the same way inside
  // the search as it does outside — a silently empty log there would make the
  // bot reason over a different world than the one it is playing in. On a
  // seat clone `createSeatSnapshot` has already filtered it to that seat's
  // audience, so the sandbox cannot see private lines the seat may not.
  game.loadSerializedState(snapshotTree(snapshot), { messageLog: snapshot.messageLog ?? [] });
  // The tree is the seat's view: read it as the seat was shown it (#1291).
  adoptSeatView(game, seat);

  // Restore the element id sequence so newly created elements don't drift.
  if (snapshot.sequence !== undefined) {
    game._ctx.sequence = snapshot.sequence;
  }

  // The search game's own RNG position, never the live game's (#776).
  game.setRandomState(randomState);

  // Restore the authoritative flow position. Every element the flow holds
  // (flow variables and frame data, `forEach` items included) was written as
  // a marker by getPosition; restoreFlowState relinks it to the freshly
  // loaded tree. `hiddenIdRemap` (CR-02, 159) is only ever present on a
  // redacted (`forSeat`) snapshot: it lets a marker that pointed at a
  // now-anonymized hidden-zone child relink to its redacted placeholder, and
  // passing it is what allows a missing element to relink to its concealing
  // zone at all (#947); a restore with no map refuses instead. A
  // DESCENDANT clone's snapshot is written from the already-redacted search
  // game, whose markers hold its own ids, so it needs no remap.
  if (snapshot.flowState) {
    game.restoreFlowState(snapshot.flowState, snapshot.hiddenIdRemap);
  }

  if (sample) applyDeterminization(game, seat, sample.determinize, sample.rng);
  game._afterRestoreSubtree();
  return game;
}

/**
 * The copy of `game` the bot searches for `seat`, built the way the bot builds
 * it, so a game can test its sampler and `afterRestore` hooks against it.
 *
 * @param game - The live game, holding the whole truth
 * @param seat - 1-indexed seat whose view the copy is built from
 * @param seed - The copy's own random seed, as the bot gives each search copy one
 * @param sample - The game's sampler and its [0, 1) source; without it the copy
 *   keeps what the seat was not told redacted
 * @throws {DeterminizationError} if the sampler throws, or contradicts the view
 */
export function searchCopyForSeat<G extends Game>(game: G, seat: number, seed: string, sample?: WorldSample): G {
  // The restore reads neither the game type nor the bot's search seed.
  const snapshot = createSeatSnapshot(game, '', undefined, { forSeat: seat, reseed: seed });
  return restoreSeatCopy(game.constructor as new (options: GameOptions) => G, snapshot, seat, snapshot.randomState, sample);
}
