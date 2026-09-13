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
 *    That is why `fetchPickChoices` here is LOCAL while nothing is bound. It is
 *    a function, not a network call, and nothing in the controller assumes
 *    otherwise. The alternative -- teaching the controller to seed
 *    `pickSnapshots` from static metadata -- was rejected: it would give a TABLE
 *    two sources for one value, which is the divergence shape
 *    `useBoardActionBridge` exists to forbid.
 *
 *    ONCE SOMETHING IS BOUND IT DOES GO TO THE WORLD (ShufflewickPub #378). A
 *    selection's candidate LIST cannot depend on another selection -- that is
 *    what "no dependent selection" means -- but its SHAPE can: a crew whose size
 *    is the chosen ship's cargo hold. The one-shot offer resolved that against
 *    empty args, so the panel was handed the unbounded fallback and every
 *    checkbox was disabled. Re-asking costs one round trip per later pick, and
 *    only while somebody is actually mid-action.
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
  ActionQuoteResult,
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
  /**
   * Resolve one pick's candidates and its bounds.
   *
   * Off the wire while nothing is bound -- the offer already carries them --
   * and BY re-asking the world once something is (ShufflewickPub #378), because
   * a selection's shape may read an earlier selection's value and the offer was
   * enumerated before any of them had one.
   */
  fetchPickChoices: (
    actionName: string,
    selectionName: string,
    player: number,
    currentArgs: Record<string, unknown>,
  ) => Promise<PickChoicesResult>;
  /**
   * WHAT THE DRAFT IN FRONT OF THE PLAYER WOULD COST (#248).
   *
   * ALWAYS off the wire, unlike a pick: a quote is a function of what the player
   * has drafted, and the offer was enumerated before they drafted anything. There
   * is nothing older that could answer it, which is the whole reason the price of
   * two weeks could not be shown before this existed.
   */
  fetchActionQuote: (
    actionName: string,
    draftArgs: Record<string, unknown>,
    player: number,
  ) => Promise<ActionQuoteResult>;
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
   * A world's view is `{state, phase}` and `state` is
   * `game.toJSONForPlayer(seat)` pruned to the seat's partitions -- the SAME
   * call a table's `PlayerState.view` carries. They differ by a key name, which
   * is the whole reason AutoUI can be a world's default board with no new
   * renderer and no new archetype.
   *
   * NOTHING IN IT SAYS WHO IS LOOKING (ShufflewickPub #408). It used to carry
   * the viewer's seat and the viewer's own player element; neither was read
   * here -- `mine` is found from `host.seat`, which the platform puts on the
   * frame that seats you -- and both made every body in a 500-seat fan-out
   * different, so the host encoded one answer five hundred times.
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

  /**
   * PRICE THE DRAFT, BY ASKING THE GAME (#248).
   *
   * Two refusals of its own before the wire is touched, and both are the panel
   * asking about something this seat was never given: an action absent from the
   * offer, and an action that declares no quote. Neither is answered with empty
   * lines, because empty lines render as "this costs nothing".
   */
  async function fetchActionQuote(
    actionName: string,
    draftArgs: Record<string, unknown>,
    _player: number,
  ): Promise<ActionQuoteResult> {
    const offer = offers.value.find((candidate) => candidate.name === actionName);
    if (offer === undefined) {
      return {
        success: false,
        error:
          `This world did not offer "${actionName}" to this seat, so there is no draft of it to ` +
          `price. Its offer is enumerated by the world over what the seat can see.`,
      };
    }
    if (offer.quote !== true) {
      return {
        success: false,
        error:
          `The "${actionName}" action does not quote its draft, so the world has no price to ` +
          `give before it is submitted. Declare one with \`.quote()\` on the action.`,
      };
    }
    const answer = await host.quoteDraft(actionName, draftArgs);
    if (!answer.ok) {
      return {
        success: false,
        error:
          answer.message ??
          `The world would not say what "${actionName}" would cost, and did not say why.`,
      };
    }
    // `null` IS AN ANSWER: the game has nothing to price about this draft yet.
    return { success: true, lines: answer.quote ?? null };
  }

  async function fetchPickChoices(
    actionName: string,
    selectionName: string,
    _player: number,
    currentArgs: Record<string, unknown> = {},
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
    // NOTHING BOUND YET, SO THE OFFER IS ALREADY THE ANSWER. A world's offer
    // arrives with every selection's candidates resolved against empty args, so
    // the first pick of any action -- and every pick of a single-selection one,
    // which is most of them -- costs no round trip at all.
    if (Object.keys(currentArgs).length === 0) {
      return {
        success: true,
        choices: selection.choices,
        validElements: selection.validElements,
        multiSelect: selection.multiSelect,
      };
    }

    // SOMETHING IS BOUND, SO ASK AGAIN (ShufflewickPub #378). A selection's
    // SHAPE may read an earlier selection's value -- a crew whose size is the
    // chosen ship's cargo hold -- and the offer was enumerated before any ship
    // existed. The candidates come back with it, evaluated against the same
    // args, so the panel and the world can never disagree about either.
    const answer = await host.resolvePick(actionName, selectionName, currentArgs);
    if (!answer.ok || answer.selection === undefined) {
      return {
        success: false,
        error:
          answer.message ??
          `The world would not say what "${selectionName}" may be, and did not say why.`,
      };
    }
    return {
      success: true,
      choices: answer.selection.choices,
      validElements: answer.selection.validElements,
      multiSelect: answer.selection.multiSelect,
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
    fetchActionQuote,
  };
}
