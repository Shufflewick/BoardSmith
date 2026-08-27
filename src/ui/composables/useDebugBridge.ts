/**
 * The debug panel's transport (#41).
 *
 * Every piece of debug data and every debug edit travels over one channel: the
 * `platformRequest` host bridge that GameShell provides in platform mode. There
 * is no debug HTTP server, so this is the only way in or out.
 *
 * `DebugPanel.vue` spelled that channel out eleven times: eleven `debug:*` op
 * strings, eleven payload literals, and eleven near-identical `try/catch`
 * blocks that each re-checked `data.success`, each re-cast an untyped host
 * payload to a typed one, and each invented its own failure message. Getting an
 * op string or a payload key wrong was a silent no-op, and none of it could be
 * exercised without mounting the panel.
 *
 * Here each op is a method. The op strings and payload shapes exist once, the
 * response is validated at the wire boundary rather than trusted downstream,
 * and a refused request becomes a thrown `Error` carrying a message worth
 * showing. Callers keep one `try/catch` and no protocol knowledge.
 *
 * @module
 */
import { inject } from 'vue';
import { GAME_CONTEXT_KEYS } from './useGameContext.js';

/** The host bridge GameShell provides in platform mode. */
export type PlatformRequest = (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** One action, as the host recorded it in the game's history. */
export interface SerializedAction {
  name: string;
  player: number;
  args: Record<string, unknown>;
  timestamp?: number;
}

/** Why one action is or is not offered, as traced by the host. */
export interface ActionTrace {
  actionName: string;
  available: boolean;
  conditionResult?: boolean;
  conditionError?: string;
  conditionDetails?: Array<{
    label: string;
    value: unknown;
    passed: boolean;
    children?: unknown[];
  }>;
  selections: Array<{
    name: string;
    type: string;
    choiceCount: number;
    skipped?: boolean;
    optional?: boolean | string;
    filterApplied?: boolean;
    dependentOn?: string;
  }>;
}

/** What the flow permits right now, as reported alongside the action traces. */
export interface FlowContext {
  flowAllowedActions: string[];
  currentPlayer?: number;
  isMyTurn: boolean;
  currentPhase?: string;
}

/**
 * Where the flow currently stands, from the `debug:flow-state` op. Distinct
 * from `FlowContext`: this carries the human-readable description produced by
 * `Game.getFlowDebugInfo().describe()`.
 */
export interface FlowStateInfo {
  phase?: string;
  step?: string;
  path: number[];
  awaiting: { currentPlayer?: number; awaitingPlayers?: number[] };
  description: string;
}

/** One captured server-side log line from the dev host's ring buffer. */
export interface LogEntry {
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
  timestamp: number;
}

/** Which elements changed between two points in the action history. */
export interface ElementDiff {
  added: number[];
  removed: number[];
  changed: number[];
  fromIndex: number;
  toIndex: number;
}

/** Where a transferred card lands in its new container. */
export type TransferPosition = 'first' | 'last';

/** Is this an object (and not null / an array / a primitive)? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a host `flowContext` payload against its REQUIRED fields, so a
 * malformed response becomes `null` rather than a half-populated object that
 * claims to be a `FlowContext`.
 */
function isFlowContext(value: unknown): value is FlowContext {
  return isRecord(value)
    && Array.isArray(value.flowAllowedActions)
    && typeof value.isMyTurn === 'boolean';
}

/** Everything the debug panel can ask of, or do to, the running game. */
export interface DebugBridge {
  /** Why each action is or is not offered to `player`, and what flow allows. */
  actionTraces(player: number): Promise<{ traces: ActionTrace[]; flowContext: FlowContext | null }>;
  /** Where the flow stands for `player`, or `null` if the host declines to say. */
  flowState(player: number): Promise<FlowStateInfo | null>;
  /** Every action played so far, oldest first. */
  history(): Promise<SerializedAction[]>;
  /** Captured server-side log lines. */
  logs(): Promise<LogEntry[]>;
  /** `player`'s view of the state as it stood after action `actionIndex`. */
  stateAt(actionIndex: number, player: number): Promise<unknown>;
  /** What changed between two actions, or `null` if the host declines to diff them. */
  stateDiff(fromIndex: number, toIndex: number, player: number): Promise<ElementDiff | null>;
  /** Permanently discard every action after `actionIndex`. */
  rewind(actionIndex: number): Promise<void>;
  /** Move a card to the top of the container it is already in. */
  moveCardToTop(cardId: number): Promise<void>;
  /** Move a card to a given index within the container it is already in. */
  reorderCard(cardId: number, targetIndex: number): Promise<void>;
  /** Move a card into another container. */
  transferCard(cardId: number, targetDeckId: number, position: TransferPosition): Promise<void>;
  /** Shuffle one deck in place. */
  shuffleDeck(deckId: number): Promise<void>;
}

/**
 * Build a bridge over a `platformRequest` function.
 *
 * Exported separately from `useDebugBridge` so a test can drive every op with a
 * stub and no Vue component in sight.
 */
export function createDebugBridge(platformRequest: PlatformRequest | null): DebugBridge {
  /** Send an op. Throws when there is no host or the request itself fails. */
  async function sendRaw(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!platformRequest) {
      throw new Error('DebugPanel requires a host bridge (mount it inside GameShell in platform mode).');
    }
    return platformRequest(op, payload);
  }

  /** Send an op that must succeed. A refusal becomes a message worth showing. */
  async function send(
    op: string,
    payload: Record<string, unknown>,
    failMessage: string,
  ): Promise<Record<string, unknown>> {
    const data = await sendRaw(op, payload);
    if (!data.success) {
      throw new Error((data.error as string) || failMessage);
    }
    return data;
  }

  /**
   * Send an op whose refusal is an answer rather than a failure. A broken
   * transport still throws — only the host declining is folded into `null`.
   */
  async function sendOptional(
    op: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const data = await sendRaw(op, payload);
    return data.success ? data : null;
  }

  return {
    async actionTraces(player) {
      const data = await send('debug:action-traces', { player }, 'Failed to fetch action traces');
      // The host payload is untyped, so check its shape rather than asserting
      // it: a malformed response degrades to empty/null instead of putting a
      // non-array or a stray primitive into typed state.
      return {
        traces: Array.isArray(data.traces) ? (data.traces as ActionTrace[]) : [],
        flowContext: isFlowContext(data.flowContext) ? data.flowContext : null,
      };
    },

    async flowState(player) {
      const data = await sendOptional('debug:flow-state', { player });
      return (data?.flowDebugInfo as FlowStateInfo) ?? null;
    },

    async history() {
      const data = await send('debug:history', {}, 'Failed to fetch history');
      return (data.actionHistory as SerializedAction[]) || [];
    },

    async logs() {
      const data = await send('debug:logs', {}, 'Failed to fetch logs');
      return (data.entries as LogEntry[]) || [];
    },

    async stateAt(actionIndex, player) {
      const data = await send('debug:state-at', { actionIndex, player }, 'Failed to fetch state');
      return data.state;
    },

    async stateDiff(fromIndex, toIndex, player) {
      // A diff the host declines to produce costs the reader a highlight, not
      // the historical state it accompanies, so a refusal is not a failure.
      const data = await sendOptional('debug:state-diff', { fromIndex, toIndex, player });
      return (data?.diff as ElementDiff) ?? null;
    },

    async rewind(actionIndex) {
      await send('debug:rewind', { actionIndex }, 'Rewind failed');
    },

    async moveCardToTop(cardId) {
      await send('debug:move-to-top', { cardId }, 'Failed to move card');
    },

    async reorderCard(cardId, targetIndex) {
      await send('debug:reorder-card', { cardId, targetIndex }, 'Failed to reorder card');
    },

    async transferCard(cardId, targetDeckId, position) {
      await send('debug:transfer-card', { cardId, targetDeckId, position }, 'Failed to transfer card');
    },

    async shuffleDeck(deckId) {
      await send('debug:shuffle-deck', { deckId }, 'Failed to shuffle deck');
    },
  };
}

/**
 * The debug bridge for the component that calls this, taken from the host that
 * GameShell provides. Must be called during setup.
 */
export function useDebugBridge(): DebugBridge {
  const platformRequest = inject(GAME_CONTEXT_KEYS.platformRequest, null) as PlatformRequest | null;
  return createDebugBridge(platformRequest);
}
