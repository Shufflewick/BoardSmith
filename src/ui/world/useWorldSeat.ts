/**
 * useWorldSeat — everything a world's board is given, built from one seat's
 * host state, and the one place that list is written down (#413).
 *
 * `useTableSeat`'s twin. A board mounted by `WorldShell` can inject board
 * interaction, the shared half of the game context (`GAME_CONTEXT_KEYS`) and the
 * world itself (`useWorld()`). They used to be built and provided one by one
 * inside the shell, so `renderAsSeat` in `boardsmith/testing` gave a world
 * board board interaction and an inert controller, and a board that worked in
 * the shell threw in its test.
 *
 * WorldShell and `renderAsSeat` both call this, then publish what it returns:
 * the shell with {@link provideWorldSeat}, and `renderAsSeat` by handing
 * `provisions` to its mount. So a value added here reaches both, and a board
 * that mounts in one mounts in the other.
 *
 * Call it inside a component's `setup` or an `effectScope`: it registers
 * watchers (the controller's and the board bridge's).
 */
import { computed, provide, ref, type ComputedRef, type InjectionKey } from 'vue';
import { useActionController } from '../composables/useActionController.js';
import type { UseActionControllerReturn } from '../composables/useActionControllerTypes.js';
import { BOARD_INTERACTION_KEY, type BoardInteraction } from '../composables/useBoardInteraction.js';
import { useBoardActionBridge } from '../composables/useBoardActionBridge.js';
import { playContextProvisions } from '../composables/useGameContext.js';
import { useToast } from '../composables/useToast.js';
import { WORLD_CONTEXT_KEY } from './useWorld.js';
import type { WorldSeatHost } from './useWorldHost.js';
import { useWorldPlay, type WorldPlay } from './useWorldPlay.js';
import type { WorldActionOutcome } from './worldProtocol.js';

/** One value a board below can inject, under its key. */
type Provision = readonly [key: InjectionKey<unknown>, value: unknown];

interface WorldSeatOptions {
  /** The seat's host state and the questions it answers. WorldShell passes its `useWorldHost()`. */
  host: WorldSeatHost;
  /** The board substrate the controller feeds and the board reads. Created with `createBoardInteraction()`. */
  boardInteraction: BoardInteraction;
}

export interface WorldSeat {
  /** The world's answers to what the shared chrome and controller ask. */
  play: WorldPlay;
  /** The viewer's seat; -1 while unseated. */
  playerSeat: ComputedRef<number>;
  /** The table's controller, unchanged, with a world's answers. */
  controller: UseActionControllerReturn;
  /** Everything the board can inject, by key. Publish with {@link provideWorldSeat} or a mount's `provide`. */
  provisions: readonly Provision[];
}

export function useWorldSeat({ host, boardInteraction }: WorldSeatOptions): WorldSeat {
  const play = useWorldPlay(host);
  const toast = useToast();
  const playerSeat = computed(() => host.seat.value ?? -1);

  /**
   * THE TABLE'S CONTROLLER, UNCHANGED, WITH A WORLD'S ANSWERS.
   *
   * Everything it needs is injected, and nothing in it knows what a table is. The
   * one piece that has to be a world's own is `fetchPickChoices`: a world's offer
   * arrives with every selection's candidates resolved, so the answer is already
   * in hand and no round trip happens. See `useWorldPlay` for why that is an
   * adapter rather than a change to the controller.
   *
   * `pickStep` and `cancelPendingAction` are absent because a world has no
   * step-wise protocol to reach: a submit carries every selection at once.
   */
  const controller = useActionController({
    sendAction: play.sendAction,
    availableActions: play.availableActions,
    actionMetadata: play.actionMetadata,
    isMyTurn: play.mayAct,
    disabledActions: play.disabledActions,
    gameView: play.gameView as never,
    playerSeat,
    fetchPickChoices: play.fetchPickChoices,
    // WHAT THE DRAFT WOULD COST (#248). The other piece that has to be a world's
    // own: the price of a draft is computed by the bundle, inside the world, over
    // the partitions the action declares -- so there is nothing the controller
    // could work out for itself and nothing a table's shell has to supply.
    fetchActionQuote: play.fetchActionQuote,
  });

  /**
   * THE BOARD SUBSTRATE, SHARED VERBATIM.
   *
   * `useBoardInteraction` is pure element-ref plumbing and reads no game state,
   * and the bridge feeds the board off the controller's `validElements` -- which
   * is precisely why the local `fetchPickChoices` above is load-bearing rather
   * than a nicety. Without it a pre-filled offer would light the action panel and
   * leave the board dead, which is the divergence the bridge exists to forbid.
   */
  useBoardActionBridge({
    controller,
    boardInteraction,
    isMyTurn: play.mayAct,
    // A WORLD HAS NO TURN TO END, AND NOTHING TO AUTO-START (#212).
    //
    // `autoEndTurn` gates two behaviours a TABLE wants: auto-executing a sole
    // no-selection `endTurn`, and auto-starting a sole available action so a
    // player whose only move is obvious does not have to press twice. A world
    // has neither. It has no turn, so there is no end to reach; and its offer is
    // enumerated over what one seat can SEE, so "the only action" is a fact
    // about a moment rather than an obvious next move -- a seat that has just
    // paid for a building was put straight back into choosing another plot,
    // which reads as an order they never placed.
    //
    // Entering an action stays entirely deliberate here: the action panel's own
    // buttons and the board's candidates, which is what a world's player uses.
    autoEndTurn: computed(() => false),
    actionMetadata: play.actionMetadata,
    availableActions: play.availableActions,
    disabledActions: play.disabledActions,
    // A world checkpoints on dirty and keeps no per-action snapshot, so there is
    // no history to view and no table runner whose replacement invalidates a pick.
    isViewingHistory: computed(() => false),
    runnerIdentity: computed(() => undefined),
  });

  /**
   * WHY AN EMITTED ACT'S REFUSAL IS THE SEAT'S TO SHOW.
   *
   * `useWorld().act()` RETURNS the outcome, so a board that injects it already
   * has the world's sentence and decides where it belongs. A board that EMITS has
   * no return value to hold, and this used to drop the outcome on the floor: a
   * player pressed a button, the world refused, and nothing at all appeared.
   *
   * It speaks through `Toast`, which is where a TABLE's post-hoc refusals go, so
   * the two backends refuse in one voice. The rule both now share: a refusal you
   * can PREDICT is a greyed control with a reason (that is `disabled` on the
   * offer, reaching the panel through `disabledActions`); a refusal you can only
   * discover by TRYING is a sentence next to the thing you tried.
   */
  async function act(command: string, args: Record<string, unknown> = {}): Promise<WorldActionOutcome> {
    const outcome = await host.act(command, args);
    // A refusal RESOLVES rather than throwing -- a world refuses legitimately --
    // so `ok` is the only place the answer lives. A refusal with no message is a
    // host that answered without saying anything, which the player still has to
    // be told about rather than left guessing at.
    if (!outcome.ok) {
      toast.show(outcome.message ?? 'The world refused that, and did not say why.', {
        type: 'error',
        duration: 5000,
      });
    }
    return outcome;
  }

  const provisions: Provision[] = [
    [BOARD_INTERACTION_KEY, boardInteraction],
    ...playContextProvisions({
      gameView: play.gameView,
      players: play.players,
      myPlayer: play.myPlayer,
      playerSeat,
      isMyTurn: play.mayAct,
      availableActions: play.availableActions,
      actionController: controller,
      platformRequest: async () => ({}),
      presentation: ref(undefined),
      debugHighlight: ref(null),
    }),
    [
      WORLD_CONTEXT_KEY,
      {
        phase: host.phase,
        view: host.view,
        seat: host.seat,
        actions: host.actions,
        offersPending: host.offersPending,
        notice: host.notice,
        worldName: host.worldName,
        presence: host.presence,
        events: host.events,
        acting: host.acting,
        act,
      },
    ],
  ];

  return { play, playerSeat, controller, provisions };
}

/** Provide a seat's {@link WorldSeat.provisions} to the components below. Call it in `setup`. */
export function provideWorldSeat(seat: WorldSeat): void {
  for (const [key, value] of seat.provisions) provide(key, value);
}
