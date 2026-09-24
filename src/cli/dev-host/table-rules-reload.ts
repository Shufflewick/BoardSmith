/**
 * CARRY A RUNNING TABLE ONTO EDITED RULES (#343).
 *
 * `boardsmith dev` reloads a table's rules on every save, and the game in
 * progress has to come with them. This is the one place that decides how:
 *
 *   1. RESTORE THE SAVED STATE UNDER THE NEW RULES. State is authoritative
 *      (docs/core-concepts.md), so this is the ordinary answer: the same
 *      element tree and flow position, now run by the edited code.
 *   2. IF THE POSITION NO LONGER FITS, REPLAY THE MOVES. An edited flow can leave
 *      the saved position pointing at a step that is no longer there, and a
 *      restore refuses it ("Flow position invalid"). The engine's answer to
 *      rules changing under a game has always been to replay its action
 *      history on the new rules (`GameRunner.replay`), and this uses it rather
 *      than a second recovery.
 *   3. IF THAT FAILS TOO, SAY SO. The caller reports it; nothing here keeps a
 *      game going on rules it does not fit.
 *
 * BUNDLED BESIDE THE RULES. It builds game objects from the author's classes,
 * so it has to run on the engine the rules were bundled with, exactly like the
 * `executeOp` that comes out of the same bundle (`loadTableRuntime`).
 */
import { GameRunner } from '../../runtime/index.js';
import type { GameStateSnapshot } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike, type OpResult, type RulesReload } from '../../session/index.js';

type HostOptions = { teachingDisabled?: boolean };

/** Restore `snapshot` under `definition`, replaying its moves when the position no longer fits. */
export async function reloadTableRules(
  definition: GameDefinitionLike,
  gameOptions: { playerCount: number },
  snapshot: GameStateSnapshot,
  hostOptions: HostOptions,
): Promise<RulesReload> {
  // The `start` op given a seed snapshot IS "this state, restored under these
  // rules, as a table's envelope" -- the same restore every op makes.
  const restore = (state: GameStateSnapshot): Promise<OpResult> =>
    executeOp(definition, gameOptions, null, null, { type: 'start' }, { ...hostOptions, seedSnapshot: state });

  const restored = await restore(snapshot);
  if (restored.success) return { kind: 'restored', result: restored };

  const restoreError = restored.error ?? 'the saved state could not be restored';
  const moves = snapshot.actionHistory.length;
  const failed = (replayError: string): RulesReload => ({
    kind: 'failed',
    reason:
      `the game's saved position does not fit them (${restoreError}), and replaying its ` +
      `${moves} move${moves === 1 ? '' : 's'} on them failed too (${replayError})`,
  });

  if (snapshot.gameOptions === undefined) {
    return failed('the saved state does not record the options the game started with, so there is nothing to replay from');
  }
  let replayed: GameStateSnapshot;
  try {
    replayed = GameRunner.replay(
      {
        GameClass: definition.gameClass,
        gameType: definition.gameType,
        gameOptions: snapshot.gameOptions as { playerCount: number },
        checkpoints: definition.checkpoints,
        undo: definition.undo,
      },
      snapshot.actionHistory,
    ).getSnapshot();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
  const result = await restore(replayed);
  if (!result.success) return failed(result.error ?? 'the replayed state could not be restored');
  return { kind: 'replayed', restoreError, moves, result };
}
