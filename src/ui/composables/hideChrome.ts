/**
 * A board asks the shell to hide its chrome over the board (#1538).
 *
 * The board whose player has asked to see the whole field registers in its `setup`:
 *
 * ```ts
 * import { useHideChrome } from 'boardsmith/ui';
 *
 * const fieldOnly = ref(false);
 * useHideChrome(() => fieldOnly.value);
 * ```
 *
 * While the function returns true the shell hides the players panel (the phone
 * strip included) and the action bar. The function is read reactively, so the
 * chrome comes back when it returns false, and when the board unmounts.
 */
import { computed, inject, onScopeDispose, shallowReactive, type ComputedRef, type InjectionKey } from 'vue';

/** A shell's register of the boards asking it to hide its chrome. */
interface HideChrome {
  /** Add a request; returns the release. */
  register(hidden: () => boolean): () => void;
  /** True while any registered request returns true. */
  hidden: ComputedRef<boolean>;
}

export const HIDE_CHROME_KEY: InjectionKey<HideChrome> = Symbol('boardsmith:hide-chrome');

export function createHideChrome(): HideChrome {
  const active = shallowReactive(new Set<() => boolean>());
  return {
    register(hidden) {
      // Wrapped, so one function registered twice is two entries, each released on its own.
      const entry = () => hidden();
      active.add(entry);
      return () => active.delete(entry);
    },
    hidden: computed(() => [...active].some((hidden) => hidden())),
  };
}

/**
 * Hide the shell's players panel and action bar while `hidden` returns true.
 * Call it in a board's `setup`; see the file comment.
 */
export function useHideChrome(hidden: () => boolean): void {
  const chrome = inject(HIDE_CHROME_KEY, null);
  if (!chrome) {
    throw new Error(
      'useHideChrome() was called outside a board. Call it in the setup of the board ' +
        'GameShell or WorldShell renders (or one renderAsSeat mounts): the chrome it hides is theirs.',
    );
  }
  onScopeDispose(chrome.register(hidden));
}
