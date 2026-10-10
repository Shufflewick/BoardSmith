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
 * The install is opt-in for the same reason: `three` and `@types/three` are
 * optional PEER dependencies, so a game that draws dice runs
 * `npm install three @types/three` and a game that does not never carries the
 * 41 MB. `./three-peer.ts` records why that was the packaging decision and
 * holds the message a missing install produces.
 *
 * Two separate things keep that cost off games that do not roll dice:
 *
 * 1. `Die3D` is an async component, so three.js lands in its own chunk rather
 *    than the main bundle. This module is the only place allowed to reference
 *    `./Die3D.vue` directly — import Die3D from here, never from the SFC, or the
 *    renderer re-enters the eager graph and the split silently stops working.
 *
 * 2. Importing this module REGISTERS the die renderer for the zoom-preview
 *    overlay and the auto-UI's DieRenderer. GameShell reaches both for every
 *    game, and they used to import Die3D themselves — a live reference in every
 *    game's graph, which is why all 14 example games shipped the three.js chunk
 *    when only 2 have dice, and why a game without three failed to type-check
 *    (#590). Both look the renderer up now, and only a game that imported this
 *    module has one.
 *
 * The registration is a side effect on purpose. A game that draws dice already
 * imports Die3D from here, so there is nothing extra to declare and nothing to
 * forget: previewing a die works exactly when the game has dice support, and the
 * bundle carries three.js exactly then too.
 */

import { defineAsyncComponent } from 'vue';
import { setDiePreviewComponent } from './die-preview-registry.js';
import { missingThreePeerError } from './three-peer.js';

/**
 * Load the die, and say which install is missing when it cannot be loaded.
 *
 * three.js is an OPTIONAL PEER DEPENDENCY (see `./three-peer.ts` for why), so
 * "not installed" is a supported state of the world and has to read as one. The
 * probe is what makes the message honest: `Die3D.vue` fails for its own reasons
 * too, and asking the resolver about `three` FIRST separates the game that
 * never installed it from a genuine fault in the component, which is then
 * rethrown untouched. Both imports are dynamic, so the chunk split the whole
 * module is built around is unaffected -- three.js still lands beside the die
 * and never in a game's main bundle.
 */
async function loadDie3D() {
  try {
    await import('three');
  } catch (cause) {
    throw missingThreePeerError(cause);
  }
  return import('./Die3D.vue');
}

export const Die3D = defineAsyncComponent(loadDie3D);

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
