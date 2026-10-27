import type { Plugin } from 'vite';
import type { UserConfig } from 'vitest/config';

/** A game's whole vite and vitest config, with the game's own settings merged over it. See `index.js`. */
export declare function defineGameViteConfig(overrides?: UserConfig): UserConfig;

/** The files whose change alone makes `vitest --changed` run the whole suite, anchored at the project root. See `index.js`. */
export declare function rerunTriggers(): Plugin;

/** A game's test classes by file name: sims (`*.sim.test.ts`) run only under `vitest --mode sims`, and a plain test file may not use a sim tool. See `index.js`. */
export declare function testClasses(): Plugin;
