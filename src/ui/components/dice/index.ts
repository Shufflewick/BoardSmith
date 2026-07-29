/**
 * 3D Dice Components
 *
 * Three.js polyhedral dice with chamfered geometry.
 * Supports d4, d6, d8, d10, d12, and d20.
 *
 * `Die3D` is exported as an async component so that three.js lands in its own
 * lazily-fetched chunk. Every game mounts GameShell, GameShell always renders
 * ZoomPreviewOverlay, and that reaches Die3D — so a *static* import here puts
 * the full WebGL renderer (~500KB, shader source included) into the bundle of
 * every game, including card games that never roll a die.
 *
 * This module is the only place allowed to reference `./Die3D.vue` directly.
 * Import Die3D from here — never from the SFC — or three.js re-enters the
 * eager graph and the split silently stops working.
 */

import { defineAsyncComponent } from 'vue';

export const Die3D = defineAsyncComponent(() => import('./Die3D.vue'));
