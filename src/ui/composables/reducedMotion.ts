/**
 * prefersReducedMotion - the user's reduced-motion preference as a reactive ref.
 *
 * Import it from `boardsmith/ui` to skip or shorten a game's own animations
 * when the player asked the operating system for less motion. `useFLIP` and
 * `useFlyingElements` already honour it.
 */
import { customRef } from 'vue';

// ---------------------------------------------------------------------------
// D19 (TOOL-03, Blocking): reading `window.matchMedia(...)` at MODULE SCOPE
// throws under jsdom (jsdom implements `window` but not `matchMedia`), which
// makes the entire `boardsmith/ui` barrel unimportable in a bare jsdom test
// environment without a manual polyfill/stub. The read + `change` listener
// registration are deferred into a lazy initializer that runs on FIRST
// ACCESS of `prefersReducedMotion.value` (via `customRef`'s `track`/`trigger`,
// which lets a plain `Ref<boolean>`-shaped export intercept its own first
// read) — nothing executes at import. Guarded on
// `typeof window.matchMedia === 'function'` (not just `typeof window !==
// 'undefined'`, which jsdom satisfies but which does NOT guarantee
// `matchMedia` exists). Real consumers (useFLIP, AutoRenderer) still observe
// a reactive value that updates on the OS `change` event once initialized —
// only the IMPORT becomes side-effect-free.
// ---------------------------------------------------------------------------
let reducedMotionInitialized = false;
// Tracks whether a consumer/test has explicitly assigned `.value` BEFORE the
// lazy initializer ran (initialization is deferred to first GET, but a
// write can legitimately happen first — e.g. a test driving the ref
// directly). Without this guard, a subsequent first-read init would clobber
// that explicit assignment with the OS's actual `matchMedia().matches`,
// silently discarding it.
let reducedMotionExplicitlySet = false;
let reducedMotionValue = false;

function ensureReducedMotionInitialized(trigger: () => void): void {
  if (reducedMotionInitialized) return;
  reducedMotionInitialized = true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!reducedMotionExplicitlySet) {
    reducedMotionValue = mql.matches;
  }
  mql.addEventListener('change', (e) => {
    reducedMotionValue = e.matches;
    trigger();
  });
}

// Check reduced motion preference (reactive, singleton; lazily initialized — see above).
export const prefersReducedMotion = customRef<boolean>((track, trigger) => ({
  get() {
    ensureReducedMotionInitialized(trigger);
    track();
    return reducedMotionValue;
  },
  set(value: boolean) {
    reducedMotionExplicitlySet = true;
    reducedMotionValue = value;
    trigger();
  },
}));
