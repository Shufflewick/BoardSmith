/**
 * A WORLD, INSIDE ITS RULES' WORKER (#885).
 *
 * Bundled beside the rules (`dev-world.ts` writes the entry that calls
 * {@link serveWorld}), so the store and the world host run on the engine the
 * rules were built with (#283). The host process keeps the sockets and the
 * reload queue; this keeps the world, its store and its clock.
 */
import type { GameDefinition } from '../../session/index.js';
import type { WorldBudgets } from '../../world/index.js';
import type { WorldMigrationOutcome } from '../../world/host/index.js';
import { serveRules } from './rules-worker.js';
import { LocalWorldHost, type WorldDevRequest } from './world-host.js';
import { openWorldStore } from './world-store.js';

/** What the host reads of a world's `gameDefinition`. */
export interface WorldFacts {
  readonly gameType: string;
  readonly displayName?: string;
}

/** The calls the host makes, by type, with what each carries. */
export interface WorldCalls {
  /** Open the world at `storePath`; `pages` are the pages whose sockets are open. */
  open: { storePath: string; worldName: string; budgets: WorldBudgets; pages: readonly string[] };
  close: undefined;
  message: { clientId: string; message: WorldDevRequest };
  disconnect: { clientId: string };
  attachments: undefined;
  /** The pages whose sockets are open now: the world host's `isOpen`. */
  pages: readonly string[];
  /** Run the work held under `id`, which the host's reload queue has let through. */
  runHeld: number;
}

/** What an `open` answers. */
export interface OpenedWorld {
  readonly seatCount: number;
  readonly storePath: string;
  /** Whether this world had already run genesis before this open. */
  readonly launchedBefore: boolean;
  readonly migrated?: WorldMigrationOutcome;
}

/** What the worker tells the host unasked: a frame for a page, or work for the reload queue to hold (#387). */
export type WorldEvent =
  | { readonly send: { readonly clientId: string; readonly message: unknown } }
  | { readonly hold: number };

/** Serve the world to the host; `rules` is the bundle's `gameDefinition`. */
// Called from the bundle entry `bundleWorldRules` writes, which fallow cannot see.
// fallow-ignore-next-line unused-export
export function serveWorld(rules: GameDefinition | undefined): void {
  serveRules(rules, (definition, _data, emit) => {
    let open = new Set<string>();
    const held = new Map<number, () => void | Promise<void>>();
    let nextHeld = 0;
    let host: LocalWorldHost | null = null;
    const world = (): LocalWorldHost => {
      if (host === null) throw new Error('No world is open in this rules worker.');
      return host;
    };

    const handlers: { [T in keyof WorldCalls]: (payload: WorldCalls[T]) => unknown } = {
      async open({ storePath, worldName, budgets, pages }): Promise<OpenedWorld> {
        open = new Set(pages);
        const store = openWorldStore(storePath, budgets);
        const launchedBefore = store.isLaunched();
        let opened: LocalWorldHost;
        try {
          opened = new LocalWorldHost({
            definition: definition as unknown as ConstructorParameters<typeof LocalWorldHost>[0]['definition'],
            worldName,
            // ONE SEED FOREVER, derived from the project rather than from the run: the
            // same world has to come back on every wake, and a fresh seed per run
            // would make a rebuilt world a different world.
            seed: `world:${definition.gameType}`,
            budgets,
            store,
            send: (clientId, message) => emit({ send: { clientId, message } } satisfies WorldEvent),
            isOpen: (clientId) => open.has(clientId),
            // The world's own alarm and a departure's grace wait in the host's
            // reload queue with the pages' commands while an edit rebuilds (#387).
            hostWork: {
              hold(work) {
                held.set(++nextHeld, work);
                emit({ hold: nextHeld } satisfies WorldEvent);
              },
            },
          });
        } catch (error) {
          store.close();
          throw error;
        }
        let migrated: WorldMigrationOutcome | undefined;
        try {
          ({ migrated } = await opened.start());
        } catch (error) {
          await opened.close();
          throw error;
        }
        host = opened;
        return { seatCount: opened.seatCount, storePath: store.path, launchedBefore, migrated };
      },
      async close() {
        await host?.close();
        host = null;
      },
      message: ({ clientId, message }) => world().handleMessage(clientId, message),
      disconnect: ({ clientId }) => world().disconnect(clientId),
      attachments: () => [...world().attachments()],
      pages(pages) {
        open = new Set(pages);
      },
      async runHeld(id) {
        const work = held.get(id);
        held.delete(id);
        await work?.();
      },
    };
    const facts: WorldFacts = { gameType: definition.gameType, displayName: definition.displayName };
    return { ready: facts, handlers };
  });
}
