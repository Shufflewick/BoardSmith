/**
 * Entry for the `boardsmith dev` HOST page (the main window). It loads the
 * resolved dev config (injected as a Vite virtual module) and mounts the
 * DevHost, which is a WebSocket client of the Node-side multiplayer host: it
 * owns the seat-picker lobby and bridges the WS transport to the game <iframe>.
 */
import { createApp } from 'vue';
import DevHost from './DevHost.vue';
import { devConfig } from 'virtual:boardsmith-dev-config';

createApp(DevHost, { config: devConfig }).mount('#app');
