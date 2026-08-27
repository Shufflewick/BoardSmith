/**
 * 3D Dice — `boardsmith/ui/dice`
 *
 * Three.js polyhedral dice with chamfered geometry (d4, d6, d8, d10, d12, d20).
 *
 * This module is deliberately NOT on the `boardsmith/ui` barrel. Importing it is
 * what opts a game into shipping three.js (~500 kB), so it has to be something a
 * game asks for by name:
 *
 * ```ts
 * import { Die3D } from 'boardsmith/ui/dice';
 * ```
 *
 * Two separate things keep that cost off games that do not roll dice:
 *
 * 1. `Die3D` is an async component, so three.js lands in its own chunk rather
 *    than the main bundle. This module is the only place allowed to reference
 *    `./Die3D.vue` directly — import Die3D from here, never from the SFC, or the
 *    renderer re-enters the eager graph and the split silently stops working.
 *
 * 2. Importing this module REGISTERS the die renderer for the zoom-preview
 *    overlay. GameShell renders that overlay for every game, and it used to
 *    import Die3D itself — a live reference in every game's graph, which is why
 *    all 14 example games shipped the three.js chunk when only 2 have dice. The
 *    overlay looks the renderer up now, and only a game that imported this
 *    module has one.
 *
 * The registration is a side effect on purpose. A game that draws dice already
 * imports Die3D from here, so there is nothing extra to declare and nothing to
 * forget: previewing a die works exactly when the game has dice support, and the
 * bundle carries three.js exactly then too.
 */

import { defineAsyncComponent } from 'vue';
import { setDiePreviewComponent } from './die-preview-registry.js';

export const Die3D = defineAsyncComponent(() => import('./Die3D.vue'));

// Side effect: see (2) above. Registering the async wrapper — not the SFC —
// keeps the chunk split intact; the preview pays the same lazy fetch as any
// other die.
setDiePreviewComponent(Die3D);

export { getDiePreviewComponent } from './die-preview-registry.js';

/**
 * The words for a die's current face. Exported so a game wrapping a die in a
 * control can name that control with the same text the die itself announces.
 */
export { dieAriaLabel } from './die-label.js';
