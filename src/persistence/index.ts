/**
 * `boardsmith/persistence` -- the persistence validation core.
 *
 * PURE ONLY. ShufflewickPub's games worker imports this barrel from inside a
 * Cloudflare Worker bundle, so nothing reachable from here may touch `node:fs`
 * or any other Node built-in. The file-backed dev store that DOES touch the
 * disk lives in the CLI (`src/cli/dev-host/persistence-file-store.ts`) and is
 * deliberately not re-exported here.
 */
export * from './persistence.js';
export * from './private-channel.js';
export * from './session-kind.js';
export * from './store.js';
