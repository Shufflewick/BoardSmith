/**
 * THE SHELL'S OWN SURFACE, for a world project that ships no `world.html`.
 *
 * #167 requires `boardsmith dev` to serve the bundle's world UI "or, for a
 * project with no world UI, the shell's own surface". This is that surface, and
 * the important thing about it is what it is NOT: it is not a second protocol
 * or a debug console wired straight to the socket. It mounts the same
 * `WorldShell` a bundle's own `world.html` mounts, over the same `useWorldHost`
 * wire, and hands it a board of its own. So a world with no UI is exercised
 * through exactly the code path a world with one takes, and an author who
 * writes `world.html` later changes what is drawn and nothing else.
 */
import { createApp, h } from 'vue';
import { WorldShell } from '../../ui/index.js';
import WorldDevBoard from './WorldDevBoard.vue';
import { worldDevConfig } from 'virtual:boardsmith-world-dev-config';

createApp(() =>
  h(WorldShell, { ui: WorldDevBoard, displayName: worldDevConfig.displayName }),
).mount('#app');
