/**
 * The dev persistence store's DISK half.
 *
 * `PersistenceStore` itself is pure and lives in `boardsmith/persistence`,
 * which ShufflewickPub's games worker imports inside a Cloudflare Worker
 * bundle -- so nothing reachable from that barrel may touch `node:fs`. The
 * loading and saving therefore lives here, in the CLI, and is the only part of
 * the dev store that knows a file exists.
 *
 * WHY A FILE AT ALL. The capability being emulated is CROSS-SESSION state: the
 * hall of fame that survives the game, the campaign that remembers mission one,
 * the world that is between rounds. An in-memory store proves none of that,
 * because restarting `boardsmith dev` is exactly the seam the feature spans.
 *
 * WHY A DOTFILE AT THE PROJECT ROOT, and specifically NOT under `.boardsmith/`:
 * `boardsmith dev` deletes that directory on shutdown (it is the rules-bundle
 * scratch dir), so a store kept there would be erased by the one event it has
 * to survive. A single dotfile beside `boardsmith.json` is gitignore-able and
 * is never carried by `boardsmith publish`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PersistenceStore, type PersistenceStoreState } from '../../persistence/index.js';

/** Where a project's dev store lives, given the project root. */
export function devStorePath(projectRoot: string): string {
  return join(projectRoot, '.boardsmith-dev-store.json');
}

/**
 * A store loaded from `path`, plus the `save` that writes it back.
 *
 * A file that does not exist yet is an EMPTY store and not an error -- the
 * first run of a game that has never persisted anything is the normal case. A
 * file that exists but will not parse IS an error, and is thrown rather than
 * swallowed: silently starting from empty would look to a developer exactly
 * like the platform having wiped their world, which is the confusion the
 * production read path is shaped to avoid.
 */
export function loadDevStore(path: string): {
  store: PersistenceStore;
  save: () => void;
} {
  const store = new PersistenceStore(readState(path));
  return {
    store,
    save: () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(store.toState(), null, 2)}\n`, 'utf8');
    },
  };
}

function readState(path: string): PersistenceStoreState | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text) as PersistenceStoreState;
  } catch (error) {
    throw new Error(
      `The dev persistence store at ${path} is not valid JSON, so this game's stored ` +
        `state could not be read: ${error instanceof Error ? error.message : String(error)}. ` +
        `Fix the file, or delete it to start this game's store from empty.`,
    );
  }
}
