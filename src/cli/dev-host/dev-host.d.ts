/**
 * Type declarations for the Vite virtual modules the dev host page imports.
 * These are provided at dev time by the `boardsmith-dev-host` Vite plugin in
 * `src/cli/commands/dev.ts` (the resolved dev config).
 */

declare module 'virtual:boardsmith-dev-config' {
  import type { DevHostConfig } from './config-types.js';
  export const devConfig: DevHostConfig;
}

/** The world run's own config (#167). A separate module because the two runs
 *  share no field: a table's chrome needs game options, presets and a bot
 *  level before a game exists, and a world already exists. */
declare module 'virtual:boardsmith-world-dev-config' {
  import type { WorldDevConfig } from './world-config-types.js';
  export const worldDevConfig: WorldDevConfig;
}
