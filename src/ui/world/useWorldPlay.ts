/**
 * A WORLD'S HALF OF THE SHARED SHELL (BoardSmith #170).
 *
 * `GameShell` and `WorldShell` are two transport-and-lifecycle adapters over one
 * chrome, and the unit they actually share is not a component: it is
 * `useActionController` plus the play context, both of which are already fully
 * dependency-injected. Nothing in the controller knows what a table is. This
 * file is the world's answer to the same questions the table's shell answers,
 * and it is deliberately small, because there was never much to translate.
 *
 * ## The four places a world's answer differs
 *
 * 1. **The offer arrives whole.** A table's protocol is step-wise -- the panel
 *    asks the server for each pick's choices as the player walks the action --
 *    because a table's selections may depend on one another. A world's is
 *    single-shot: `WorldActionOffer` is `ActionMetadata` with every selection's
 *    `choices`/`validElements` already filled in, affordable precisely because a
 *    world action may not declare a dependent selection (#169).
 *
 *    That is why `fetchPickChoices` here is LOCAL. It is a function, not a
 *    network call, and nothing in the controller assumes otherwise. The
 *    alternative -- teaching the controller to seed `pickSnapshots` from static
 *    metadata -- was rejected: it would give a TABLE two sources for one value,
 *    which is the divergence shape `useBoardActionBridge` exists to forbid.
 *
 *    It is also not optional. `validElements` reads only `pickSnapshots`, and
 *    `useBoardActionBridge` feeds the board off `validElements`, so an offer
 *    with pre-filled candidates and no local fetch would light the action panel
 *    and leave the board dead.
 *
 * 2. **"May I act" is not "is it my go".** A world runs no flow and has no turn.
 *    The property the panel reads `isMyTurn` FOR is "may this viewer act now",
 *    and a world's answer is yes whenever it is attached and seated. Everything
 *    that means "it is your go" -- the turn announcer, the notification sound --
 *    stays on the table side and is never handed this ref.
 *
 * 3. **Names are the host's.** See `WorldPlayer`.
 *
 * 4. **The log is a tail, not a history.** See `messages`.
 */
import { computed, type ComputedRef } from 'vue';
import type { WorldHost } from './useWorldHost.js';
import type { WorldActionOffer } from './worldProtocol.js';
import type {
  ActionMetadata,
  ActionResult,
  PickChoicesResult,
} from '../composables/useActionControllerTypes.js';
import type { GameContextPlayer } from '../composables/useGameContext.js';
import type { HistoryMessage } from '../components/GameHistory.vue';

/** Everything a world hands the shared shell and the shared controller. */
export interface WorldPlay {
  /** The serialized element tree for this seat -- the same call's output a
   *  table's `PlayerState.view` carries, which is why AutoUI renders both. */
  gameView: ComputedRef<unknown>;
  /** The seat rows the chrome draws. */
  players: ComputedRef<GameContextPlayer[]>;
  /** The viewer's own row, or undefined while unseated. */
  myPlayer: ComputedRef<GameContextPlayer | undefined>;
  /** Whether this viewer may act right now. */
  mayAct: ComputedRef<boolean>;
  /** The names of the actions the world enumerated for this seat. */
  availableActions: ComputedRef<string[]>;
  /** Those actions' metadata, by name -- the table's own shape, untranslated. */
  actionMetadata: ComputedRef<Record<string, ActionMetadata>>;
  /** Action name to why it is offered but cannot be taken. */
  disabledActions: ComputedRef<Record<string, string>>;
  /** The lines the game asked the shell to say. */
  messages: ComputedRef<HistoryMessage[]>;
  /** Take an action. Single-shot: every selection's value at once. */
  sendAction: (actionName: string, args: Record<string, unknown>) => Promise<ActionResult>;
  /** Resolve one pick's candidates from the offer, off the wire. */
  fetchPickChoices: (
    actionName: string,
    selectionName: string,
    player: number,
    currentArgs: Record<string, unknown>,
  ) => Promise<PickChoicesResult>;
}

/** The world's projection, as `viewFor` composes it. `state` is the pruned
 *  serialized tree; the other two the shell already knows from the frame. */
interface WorldView {
  readonly state?: unknown;
}

export function useWorldPlay(host: WorldHost): WorldPlay {
  const offers = computed<readonly WorldActionOffer[]>(() => host.actions.value);

  const availableActions = computed(() => offers.value.map((offer) => offer.name));

  const actionMetadata = computed<Record<string, ActionMetadata>>(() => {
    const byName: Record<string, ActionMetadata> = {};
    for (const offer of offers.value) byName[offer.name] = offer;
    return byName;
  });

  const disabledActions = computed<Record<string, string>>(() => {
    const reasons: Record<string, string> = {};
    for (const offer of offers.value) {
      if (offer.disabled !== undefined) reasons[offer.name] = offer.disabled;
    }
    return reasons;
  });

  /**
   * A world's view is `{player, state, phase}` and `state` is
   * `game.toJSONForPlayer(seat)` pruned to the seat's partitions -- the SAME
   * call a table's `PlayerState.view` carries. They differ by a key name, which
   * is the whole reason AutoUI can be a world's default board with no new
   * renderer and no new archetype.
   */
  const gameView = computed<unknown>(() => (host.view.value as WorldView | null)?.state ?? null);

  /**
   * WHO THE SEATS ARE.
   *
   * The host's `players` when it sent them. Without them the shell knows seat
   * NUMBERS and nothing else, so it says so -- "Seat 7" is the seat, not a
   * person, and a library that invented "Player 7" would be shipping a name that
   * outranks the real one on the platform that has it.
   *
   * The roster without host names is the presence set plus the viewer: those are
   * the only seats this frame has evidence exist. A world holds 500 seats and
   * knows almost nothing about 493 of them; drawing 500 rows of "Seat n" would
   * be a list of numbers pretending to be a room.
   */
  const players = computed<GameContextPlayer[]>(() => {
    const named = host.players.value;
    if (named.length > 0) {
      return named.map((player) => ({ ...player }));
    }
    const seats = new Set<number>(host.presence.value ?? []);
    if (host.seat.value !== null) seats.add(host.seat.value);
    return [...seats]
      .sort((a, b) => a - b)
      .map((seat) => ({ seat, name: `Seat ${seat}` }));
  });

  const myPlayer = computed(() =>
    players.value.find((player) => player.seat === host.seat.value),
  );

  /**
   * MAY THIS VIEWER ACT? Not "is it their go" -- see the header. A seat that is
   * still attaching, has lost the socket or was refused holds an offer that is
   * either absent or stale, and a panel that let them press it would send a
   * command into a world that is not listening.
   */
  const mayAct = computed(() => host.phase.value === 'watching' && host.seat.value !== null);

  /**
   * THE LOG, WHICH IS A TAIL AND NOT A HISTORY.
   *
   * Only the events the game wrote a sentence for. `payload` stays the board's
   * and is never rendered here: a shell that printed JSON would be a debug
   * console, which is what `WorldDevBoard` was and why it is gone. An event with
   * no `text` puts no line in the log rather than an invented one.
   */
  const messages = computed<HistoryMessage[]>(() =>
    host.events.value
      .filter((event) => typeof event.text === 'string' && event.text.length > 0)
      .map((event) => ({ text: event.text as string, type: event.type })),
  );

  async function sendAction(
    actionName: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const outcome = await host.act(actionName, args);
    if (outcome.ok) return { success: true, message: outcome.message };
    return { success: false, error: outcome.message ?? 'The world refused that, and did not say why.' };
  }

  async function fetchPickChoices(
    actionName: string,
    selectionName: string,
  ): Promise<PickChoicesResult> {
    const offer = offers.value.find((candidate) => candidate.name === actionName);
    if (offer === undefined) {
      return {
        success: false,
        error:
          `This world did not offer "${actionName}" to this seat. Its offer is enumerated ` +
          `by the world over what the seat can see, so an action missing from it is one the ` +
          `seat may not take right now.`,
      };
    }
    const selection = offer.selections.find((candidate) => candidate.name === selectionName);
    if (selection === undefined) {
      return {
        success: false,
        error:
          `"${actionName}" has no selection called "${selectionName}". Its selections are ` +
          `${offer.selections.map((s) => `"${s.name}"`).join(', ') || '(none)'}.`,
      };
    }
    // No round trip, by design: a world's offer arrives with its candidates
    // already resolved, so the answer is already in hand.
    return {
      success: true,
      choices: selection.choices,
      validElements: selection.validElements,
      multiSelect: selection.multiSelect,
    };
  }

  return {
    gameView,
    players,
    myPlayer,
    mayAct,
    availableActions,
    actionMetadata,
    disabledActions,
    messages,
    sendAction,
    fetchPickChoices,
  };
}
