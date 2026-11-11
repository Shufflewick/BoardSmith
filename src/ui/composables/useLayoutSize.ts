/**
 * THE LAYOUT SIZE, READ ONCE PER SHELL (#1610).
 *
 * Both shells call this and nothing else reads the viewport's tier, so the
 * chrome's compact layout, the board's `formFactor` and `orientation` props,
 * and the choice of a game's phone UI cannot disagree. The tiers are
 * `BREAKPOINTS`': compact below 640px, medium below 1024px, wide from there.
 */
import { computed, onScopeDispose, readonly, ref, type Ref } from 'vue';
import { BREAKPOINTS } from '../theme.js';

/** The viewport's size tier. */
export type FormFactor = 'compact' | 'medium' | 'wide';
/** The viewport's shape: portrait when it is at least as tall as it is wide. */
export type Orientation = 'portrait' | 'landscape';

export interface LayoutSize {
  formFactor: Readonly<Ref<FormFactor>>;
  orientation: Readonly<Ref<Orientation>>;
  /** True at the compact tier, where the shell's chrome takes its phone layout. */
  isCompact: Readonly<Ref<boolean>>;
}

/** Read the layout size now and follow every resize and rotation until the calling scope ends. */
export function useLayoutSize(): LayoutSize {
  const formFactor = ref<FormFactor>('wide');
  const orientation = ref<Orientation>('landscape');
  const layout = {
    formFactor: readonly(formFactor),
    orientation: readonly(orientation),
    isCompact: computed(() => formFactor.value === 'compact'),
  };
  // jsdom ships no matchMedia; every browser does.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return layout;

  const compact = window.matchMedia(`(max-width: ${BREAKPOINTS.compact - 1}px)`);
  const medium = window.matchMedia(`(max-width: ${BREAKPOINTS.medium - 1}px)`);
  const portrait = window.matchMedia('(orientation: portrait)');
  const read = (): void => {
    formFactor.value = compact.matches ? 'compact' : medium.matches ? 'medium' : 'wide';
    orientation.value = portrait.matches ? 'portrait' : 'landscape';
  };
  read();
  for (const query of [compact, medium, portrait]) query.addEventListener('change', read);
  onScopeDispose(() => {
    for (const query of [compact, medium, portrait]) query.removeEventListener('change', read);
  });
  return layout;
}
