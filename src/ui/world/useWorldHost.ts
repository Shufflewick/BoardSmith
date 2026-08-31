import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { isOriginAllowed } from '../components/GameShellInit.js';
import {
  WORLD_COMMAND_TIMEOUT_MS,
  WORLD_HELLO_TIMEOUT_MS,
  WORLD_HOST_SOURCE,
  WORLD_UI_SOURCE,
  type WorldActionOutcome,
  type WorldCommandOffer,
  type WorldHostMessage,
  type WorldPhase,
  type WorldUiMessage,
} from './worldProtocol.js';

export interface WorldHostOptions {
  /** Where a message goes. Defaults to the parent frame. */
  post?: (message: WorldUiMessage) => void;
  /** Origins allowed to talk to this frame. Empty or unset means any, which is
   *  what `boardsmith dev` needs and what a deployed host overrides. */
  trustedOrigins?: string[];
  /** Overridable for tests; the shipped windows live in `worldProtocol.ts`. */
  helloTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export interface WorldHost {
  phase: Ref<WorldPhase>;
  view: ShallowRef<unknown>;
  seat: Ref<number | null>;
  commands: Ref<readonly WorldCommandOffer[]>;
  notice: Ref<string | null>;
  worldName: Ref<string | null>;
  /** Who holds an open connection right now, or `null` when the host has no
   *  live claim. The contract, in full, is on `world_state` in
   *  `worldProtocol.ts`; this is that field, copied and nothing more. */
  presence: Ref<readonly number[] | null>;
  /** True once the host has sent one frame this UI understood. */
  heardFromHost: Ref<boolean>;
  /** True when the hello window passed with nothing from the host at all. */
  hostSilent: Ref<boolean>;
  /** True while at least one command of this player's is unanswered. */
  acting: Ref<boolean>;
  act(command: string, args?: Record<string, unknown>): Promise<WorldActionOutcome>;
  /** Install the listener and say hello. */
  start(): void;
  /** Remove the listener and fail everything still outstanding. */
  stop(): void;
  /** The listener itself, so the paths above can be driven without a window. */
  handleMessage(event: MessageEvent): void;
}

/** What an outstanding command is told when the frame goes before its answer
 *  does. A promise nobody resolves is a button that spins forever. */
const DROPPED_BEFORE_ANSWER =
  'The page stopped listening to this world before it answered.';

/**
 * WHAT A BUNDLE'S WORLD UI KNOWS, AND HOW IT ACTS (ShufflewickPub #128).
 *
 * The world twin of `usePlatformTransport`, and it is a different shape for the
 * reason `worldProtocol.ts` states at length: a world has no flow, no turn and
 * no action table, so there is no boundary key to stamp and no op vocabulary to
 * relay. There is one verb -- send a command, wait for its own answer -- and
 * one inbound frame that carries the whole of what this UI renders.
 *
 * REQUEST CORRELATION IS THE WHOLE MECHANISM. Two commands in flight are two
 * promises: the host echoes each `requestId` onto the answer it belongs to, so
 * nothing here has to guess from arrival order, which is precisely the
 * assumption a busy world breaks.
 *
 * A REFUSAL RESOLVES. `{ ok: false, message }` is an ordinary outcome -- a
 * contested claim, a door that is not there -- and a caller that had to catch
 * one would be treating the rules working correctly as an exception.
 */
export function useWorldHost(options: WorldHostOptions = {}): WorldHost {
  const post =
    options.post ?? ((message: WorldUiMessage) => window.parent.postMessage(message, '*'));
  const helloTimeoutMs = options.helloTimeoutMs ?? WORLD_HELLO_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? WORLD_COMMAND_TIMEOUT_MS;

  const phase = ref<WorldPhase>('attaching');
  /**
   * `shallowRef`, deliberately, for the reason the host page uses one: a
   * world's view is an arbitrarily deep engine projection that is only ever
   * REPLACED wholesale, and a deep `ref` would walk the whole tree installing
   * proxies on every refresh -- a per-frame cost proportional to what the
   * player can see.
   */
  const view = shallowRef<unknown>(null);
  const seat = ref<number | null>(null);
  const commands = ref<readonly WorldCommandOffer[]>([]);
  const notice = ref<string | null>(null);
  const worldName = ref<string | null>(null);
  const presence = ref<readonly number[] | null>(null);
  const heardFromHost = ref(false);
  const hostSilent = ref(false);
  const acting = ref(false);

  const pending = new Map<
    string,
    { resolve: (outcome: WorldActionOutcome) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let sequence = 0;
  let helloTimer: ReturnType<typeof setTimeout> | null = null;

  function settle(requestId: string, outcome: WorldActionOutcome): void {
    const waiting = pending.get(requestId);
    if (waiting === undefined) return;
    pending.delete(requestId);
    clearTimeout(waiting.timer);
    waiting.resolve(outcome);
    acting.value = pending.size > 0;
  }

  function handleMessage(event: MessageEvent): void {
    if (!isOriginAllowed(event.origin, options.trustedOrigins)) return;
    const data = event.data as WorldHostMessage | undefined;
    if (!data || data.source !== WORLD_HOST_SOURCE) return;

    if (data.type === 'world_response') {
      settle(data.requestId, { ok: data.ok === true, message: data.message });
      return;
    }

    if (data.type !== 'world_state') return;

    heardFromHost.value = true;
    hostSilent.value = false;
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }

    phase.value = data.phase;
    view.value = data.view;
    seat.value = data.seat;
    commands.value = data.commands ?? [];
    notice.value = data.notice;
    worldName.value = data.worldName;
    presence.value = data.presence;
  }

  async function act(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<WorldActionOutcome> {
    sequence += 1;
    const requestId = `wc-${sequence}`;
    const answered = new Promise<WorldActionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.delete(requestId)) {
          acting.value = pending.size > 0;
          resolve({
            ok: false,
            message: `The world did not answer "${command}". It may still have taken it; look again before repeating it.`,
          });
        }
      }, commandTimeoutMs);
      pending.set(requestId, { resolve, timer });
    });
    acting.value = true;
    // Structured clone cannot carry a Vue proxy, and a UI's natural
    // `someRef.value` is exactly what a caller will hand this. One JSON round
    // trip is the whole of what a world command's arguments need: they are
    // declared `choice`, `number` or `text` by the bundle itself.
    post({
      source: WORLD_UI_SOURCE,
      type: 'world_command',
      requestId,
      command,
      args: JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>,
    });
    return await answered;
  }

  function start(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
    }
    helloTimer = setTimeout(() => {
      helloTimer = null;
      if (!heardFromHost.value) hostSilent.value = true;
    }, helloTimeoutMs);
    // THE HOST PUSHES; THIS ASKS IT TO PUSH NOW. A world frame commonly mounts
    // after the host already holds a view (the socket opens while the iframe is
    // still loading), and without this the UI would sit blank until the world
    // next moved -- which in a quiet world is never.
    post({ source: WORLD_UI_SOURCE, type: 'world_ready' });
  }

  function stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', handleMessage);
    }
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
    for (const requestId of [...pending.keys()]) {
      settle(requestId, { ok: false, message: DROPPED_BEFORE_ANSWER });
    }
  }

  return {
    phase,
    view,
    seat,
    commands,
    notice,
    worldName,
    presence,
    heardFromHost,
    hostSilent,
    acting,
    act,
    start,
    stop,
    handleMessage,
  };
}
