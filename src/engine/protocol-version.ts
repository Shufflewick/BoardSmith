/**
 * BUNDLE_PROTOCOL_VERSION — the game↔engine ABI (bundle protocol) version.
 *
 * A published game's `rules.js` externalizes `boardsmith` (the executor supplies
 * the engine at runtime), so the game and the engine that runs it can be built
 * from different BoardSmith versions. When the contract between a built bundle
 * and the engine changes incompatibly, an old bundle silently misbehaves on a
 * newer engine (e.g. a blank action bar). This integer is the compatibility
 * signal the platform checks to fail LOUDLY on skew instead.
 *
 * Rules:
 * - `boardsmith build` stamps this value into the published manifest as
 *   `engineProtocol` automatically — game authors never set it.
 * - The executor compares a bundle's stamped `engineProtocol` against the value
 *   exported by its own vendored BoardSmith and rejects a mismatch.
 * - Bump this ONLY when a change breaks how an already-built `rules.js` runs
 *   against the engine (a breaking bundle-ABI change) — NOT on every release,
 *   and independently of the npm package `version`.
 */
export const BUNDLE_PROTOCOL_VERSION = 1;
