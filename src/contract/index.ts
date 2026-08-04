/**
 * The engine contract: what the platform is promised, and how it knows when
 * that promise changed.
 *
 * `engine-contract.json` is the single source of truth for BOTH numbers below.
 * `BUNDLE_PROTOCOL_VERSION` re-exports from here rather than declaring its own
 * literal, so there is exactly one place either can be edited — a platform
 * tool reading the JSON and an engine module reading the constant can never
 * disagree.
 *
 * Read `docs/engine-contract.md` for the update and re-vendor protocol.
 */

import contract from './engine-contract.json' with { type: 'json' };

export interface EngineContractRevision {
  revision: number;
  date: string;
  bundleProtocol: number;
  surfaceHash: string;
  payloadHash: string;
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
  /**
   * The game↔engine ABI version. Bumped only for changes that break how an
   * ALREADY-BUILT `rules.js` runs — far rarer than `revision`, and the only
   * one that invalidates existing published bundles.
   */
  bundleProtocol: number;
  surfaceHash: string;
  payloadHash: string;
  history: EngineContractRevision[];
}

export const ENGINE_CONTRACT: EngineContract = contract as EngineContract;

export const ENGINE_REVISION: number = ENGINE_CONTRACT.revision;
