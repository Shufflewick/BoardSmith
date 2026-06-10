/**
 * Entry for the `boardsmith dev` HOST page (the main window). It loads the
 * author's compiled gameDefinition + the resolved dev config (both injected as
 * Vite virtual modules) and mounts the DevHost, which owns the dev chrome, the
 * game `<iframe>`, and the in-process SnapshotSessionHost bridge.
 */
import { createApp } from 'vue';
import DevHost from './DevHost.vue';
import { gameDefinition } from 'virtual:boardsmith-game';
import { devConfig } from 'virtual:boardsmith-dev-config';

createApp(DevHost, { gameDefinition, config: devConfig }).mount('#app');
