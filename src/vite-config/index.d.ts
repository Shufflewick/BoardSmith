import type { UserConfig } from 'vitest/config';

/** A game's whole vite and vitest config, with the game's own settings merged over it. See `index.js`. */
export declare function defineGameViteConfig(overrides?: UserConfig): UserConfig;
