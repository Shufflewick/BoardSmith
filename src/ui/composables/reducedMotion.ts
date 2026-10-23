/**
 * prefersReducedMotion - whether to reduce motion, as a reactive ref.
 *
 * It is on when the device asks for less motion or the player turned on
 * Reduce motion in GameShell's controls menu (#1442). Import it from
 * `boardsmith/ui` to skip or shorten a game's own animations. `useFLIP`, `Die3D`,
 * `useFlyingElements` and `useActionAnimations` already honour it, and CSS follows it through the
 * `bs-reduce-motion` class kept on `<html>` by `syncReducedMotionClass()`.
 */
import { customRef, effectScope, watchEffect, type Ref } from 'vue';
import { definePlayerPreferences } from '../player-preferences.js';

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
// `matchMedia` exists). Real consumers (useFLIP, useFlyingElements) still observe
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

const declarations = {
  reduceMotion: { label: 'Reduce motion', description: 'Always on when your device asks for less motion.', default: false },
} as const;
let motionPreferences: ReturnType<typeof definePlayerPreferences<typeof declarations>> | undefined;
let playerChoice: Ref<boolean> | undefined;

/**
 * The built-in Reduce motion item. It is saved once for every BoardSmith game
 * in this browser, as the device setting is: needing less motion belongs to
 * the player, not to one game. Defined on first use, so importing reads no storage.
 */
export function reduceMotionPreference() {
  motionPreferences ??= definePlayerPreferences('boardsmith', declarations);
  return motionPreferences;
}

// Reactive singleton: the device setting (lazily initialized, see above) or the player's choice.
// Assigning `.value` stands in for the device setting, as tests do.
export const prefersReducedMotion = customRef<boolean>((track, trigger) => ({
  get() {
    ensureReducedMotionInitialized(trigger);
    track();
    playerChoice ??= reduceMotionPreference().use('reduceMotion');
    return reducedMotionValue || playerChoice.value;
  },
  set(value: boolean) {
    reducedMotionExplicitlySet = true;
    reducedMotionValue = value;
    trigger();
  },
}));

let classSynced = false;

/**
 * Keep the `bs-reduce-motion` class on `<html>` while motion is reduced, and
 * install the rule that halts every CSS animation and transition under it, so
 * all CSS (teleported overlays included) follows the same setting as script.
 * Called by the shells and by every component whose CSS keys on the class,
 * so that CSS works with no shell on the page (#1446). It runs once per page
 * and lives as long as the page, since the setting it mirrors belongs to the
 * page, not to one shell.
 */
export function syncReducedMotionClass(): void {
  if (classSynced) return;
  classSynced = true;
  const halt = document.createElement('style');
  halt.id = 'bs-reduce-motion';
  halt.textContent = `.bs-reduce-motion *, .bs-reduce-motion *::before, .bs-reduce-motion *::after {
  animation-duration: .01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: .01ms !important;
}`;
  document.head.appendChild(halt);
  const root = document.documentElement;
  effectScope(true).run(() => watchEffect(() => root.classList.toggle('bs-reduce-motion', prefersReducedMotion.value)));
}
