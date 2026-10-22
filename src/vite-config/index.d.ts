import type { Plugin } from 'vite';
import type { UserConfig } from 'vitest/config';

/** A game's whole vite and vitest config, with the game's own settings merged over it. See `index.js`. */
export declare function defineGameViteConfig(overrides?: UserConfig): UserConfig;

/** The files whose change alone makes `vitest --changed` run the whole suite, anchored at the project root. See `index.js`. */
export declare function rerunTriggers(): Plugin;
