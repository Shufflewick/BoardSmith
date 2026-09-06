/**
 * Entry for the `boardsmith dev` WORLD host page (the main window).
 *
 * The world twin of `host-main.ts`, and separate from it for the reason
 * `worldProtocol.ts` gives at length: a world has no turn, no flow position and
 * no action table, so the page that drives one shares a shape with the table's
 * dev chrome but not a protocol.
 */
import { createApp } from 'vue';
import WorldDevHost from './WorldDevHost.vue';
import { worldDevConfig } from 'virtual:boardsmith-world-dev-config';

createApp(WorldDevHost, { config: worldDevConfig }).mount('#app');
