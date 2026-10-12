/**
 * The engine contract: what the platform is promised, and how it knows when
 * that promise changed.
 *
 * `engine-contract.json` is the single source of truth for the engine
 * revision, the one compatibility number the platform reads.
 *
 * Read `docs/engine-contract.md` for the update and re-vendor protocol.
 */

import contract from './engine-contract.json' with { type: 'json' };

export interface EngineContractRevision {
  revision: number;
  date: string;
  surfaceHash: string;
  payloadHash: string;
  /**
   * The stored form of a world's partitions. Optional ONLY on history entries
   * recorded before this fingerprint existed (r1 to r60): their engines cannot
   * be rebuilt, so nothing can compute one for them. A revision with no
   * `formatHash` declares no format, and ShufflewickPub therefore cannot move a
   * world onto it or off it.
   */
  formatHash?: string;
  summary: string;
}

export interface EngineContract {
  /**
   * Bumped whenever the platform-reachable surface or the player-view payload
   * changes. Monotonic. `boardsmith build` stamps this into every published
   * manifest as `engineRevision`, which is what lets the platform reject a
   * bundle built against an engine NEWER than the one it vendored.
   */
  revision: number;
  surfaceHash: string;
  payloadHash: string;
  /**
   * The serialization format of a world's durable partitions
   * (ShufflewickPub #390). Two revisions declaring the same value write and
   * read the same bytes, which is the one condition under which the platform
   * may run a live world on a different engine than it launched on.
   */
  formatHash: string;
  history: EngineContractRevision[];
}

export const ENGINE_CONTRACT: EngineContract = contract as EngineContract;

export const ENGINE_REVISION: number = ENGINE_CONTRACT.revision;
