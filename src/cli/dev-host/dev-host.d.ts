/**
 * Type declarations for the Vite virtual modules the dev host page imports.
 * These are provided at dev time by the `boardsmith-dev-host` Vite plugin in
 * `src/cli/commands/dev.ts` (the game's compiled rules + the resolved dev config).
 */

declare module 'virtual:boardsmith-game' {
  /** The author's compiled game definition (gameClass + metadata). */
  export const gameDefinition: {
    gameClass: new (...args: unknown[]) => unknown;
    gameType: string;
    displayName?: string;
    minPlayers?: number;
    maxPlayers?: number;
    [key: string]: unknown;
  };
}

declare module 'virtual:boardsmith-dev-config' {
  import type { DevHostConfig } from './config-types.js';
  export const devConfig: DevHostConfig;
}
