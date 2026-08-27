import { toCloneablePayload } from '../components/platformRequestClone.js';
import type { BoundaryKeyState } from '../../engine/flow/boundary-key.js';

/** How long a host request waits before it is answered as a failure. */
const REQUEST_TIMEOUT_MS = 20_000;

export interface PlatformTransportOptions {
  /**
   * The flow state THIS SHELL RENDERED, read at request time.
   *
   * A function rather than a value because the boundary key must be stamped from
   * the round the human was actually looking at when they submitted, not from
   * whatever was current when the transport was created.
   */
  boundaryState: () => BoundaryKeyState | null | undefined;
  /** Where the envelope goes. Defaults to the parent frame. */
  post?: (message: unknown) => void;
  /** Overridable for tests; the shipped timeout is 20 seconds. */
  timeoutMs?: number;
}

export interface PlatformTransport {
  /** Send one op to the host and resolve with its response. Never rejects on a host failure. */
  request(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Hand a `server_response` message to the request waiting on it. */
  handleResponse(data: { requestId?: unknown; result?: unknown; [key: string]: unknown }): void;
  /** Answer every request still in flight as a failure, and drop their timers. */
  rejectAll(error: string): void;
  /** How many requests are in flight. */
  pendingCount(): number;
}

/**
 * THE ONE OUTBOUND CHOKEPOINT for platform mode (#41).
 *
 * Every server call in platform mode -- an action, a choices fetch, a selection
 * step, a cancel, an undo, demo control, and all eleven `debug:*` ops -- goes
 * through here, so the platform/dev branching lives in exactly one place. Adding
 * a server op means calling `request(op, ...)` and implementing it in the
 * executor; the host relay is generic and needs no per-op change. That is what
 * prevents the recurring "works in dev, broken in the iframe" bug where one
 * server call forgot its platform branch.
 *
 * Extracted from GameShell.vue, where it was a closure over a module-level
 * counter and a pending map. Three paths that only an end-to-end mount could
 * reach -- a timeout, a response arriving after one, and unmount while requests
 * are in flight -- are now directly testable, and none of them had a test.
 *
 * A host failure RESOLVES as `{ success: false, error }` rather than rejecting.
 * Callers branch on `success`, and a rejection would turn a refused op into an
 * unhandled promise rejection at every call site.
 */
export function usePlatformTransport(options: PlatformTransportOptions): PlatformTransport {
  const post = options.post ?? ((message: unknown) => window.parent.postMessage(message, '*'));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let sequence = 0;
  const pending = new Map<string, { resolve: (r: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }>();

  function request(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Strip Vue reactivity (a reactive proxy / ref is not structured-cloneable) so the
    // natural `someRef.value` arg survives postMessage; a genuine live-element leak
    // still fails loud via assertCloneable inside toCloneablePayload.
    //
    // BSMITH-05: the boundary key is stamped HERE, on the ONE outbound chokepoint,
    // from the flow state the shell rendered -- the round the human was actually
    // looking at. Stamping it per call site is how a submission ends up carrying
    // no key at all and landing in whichever round is open by the time it arrives.
    // It rides on every op, not just the two the engine reads it from: an inert
    // extra field on a debug payload costs nothing, and "remember to add it when
    // you add a submission op" is not a guardrail. See
    // docs/simultaneous-and-interrupt-semantics.md.
    const cloneable = toCloneablePayload(op, payload, options.boundaryState());

    return new Promise((resolve) => {
      const requestId = `req-${sequence++}`;
      const timer = setTimeout(() => {
        if (pending.delete(requestId)) {
          resolve({ success: false, error: `Timed out on '${op}'` });
        }
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      post({
        source: 'shufflewick-game',
        type: 'server_request',
        requestId,
        op,
        payload: cloneable,
      });
    });
  }

  function handleResponse(data: { requestId?: unknown; result?: unknown; [key: string]: unknown }): void {
    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    if (requestId === undefined) return;
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    // `result` is the executor op's full result object (choices, step result,
    // etc.). Fall back to the message itself for resilience.
    entry.resolve((data.result ?? data) as Record<string, unknown>);
  }

  function rejectAll(error: string): void {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ success: false, error });
    }
    pending.clear();
  }

  return { request, handleResponse, rejectAll, pendingCount: () => pending.size };
}
