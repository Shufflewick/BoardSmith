/**
 * Screen-reader announcer composable
 *
 * Lets any game component (custom UI or AutoUI) announce state changes to
 * screen readers by writing through GameShell's existing live-region refs
 * (`politeMessage`/`assertiveMessage`) — no new DOM nodes, no new architecture.
 *
 * Uses provide/inject for component tree access (following the
 * useAnimationEvents/useBoardInteraction pattern).
 *
 * @example
 * ```typescript
 * // In GameShell setup (root component)
 * const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });
 * provideAnnouncer(announcer);
 *
 * // In any descendant component (custom UI or AutoUI)
 * const { announce } = useAnnouncer();
 * announce('3 cards remain');
 * announce('Invalid move', { assertive: true });
 * ```
 */
import { nextTick, type Ref, type InjectionKey, provide, inject } from 'vue';
import { devWarn } from '../../utils/dev.js';

/**
 * Return type for the announcer composable.
 */
export interface UseAnnouncerReturn {
  /**
   * Announce a message to screen readers via GameShell's live regions.
   * Polite by default; pass `{ assertive: true }` for urgent/interrupting announcements.
   *
   * Repeated identical messages are clear-then-set so screen readers re-announce
   * the duplicate. Collisions with GameShell's own announcements are last-write-wins.
   */
  announce: (message: string, options?: { assertive?: boolean }) => void;
}

/**
 * Options for creating an announcer instance.
 */
export interface CreateAnnouncerOptions {
  /** GameShell's existing polite live-region ref (aria-live="polite"). */
  politeMessage: Ref<string>;
  /** GameShell's existing assertive live-region ref (aria-live="assertive" / role="alert"). */
  assertiveMessage: Ref<string>;
  /** GameShell's existing boardsmith-a11y postMessage relay. */
  emitAnnounce: (level: 'polite' | 'assertive', text: string) => void;
}

/**
 * Injection key for the announcer.
 */
export const ANNOUNCER_KEY: InjectionKey<UseAnnouncerReturn> = Symbol('announcer');

/**
 * Create an announcer instance.
 *
 * Call this in a root component (e.g., GameShell) and provide it to descendants,
 * passing GameShell's EXISTING live-region refs and emitAnnounce function.
 *
 * @param options Configuration options
 * @returns Announcer controller
 */
export function createAnnouncer(options: CreateAnnouncerOptions): UseAnnouncerReturn {
  const { politeMessage, assertiveMessage, emitAnnounce } = options;

  function announce(message: string, announceOptions?: { assertive?: boolean }): void {
    const level: 'polite' | 'assertive' = announceOptions?.assertive ? 'assertive' : 'polite';
    const target = level === 'assertive' ? assertiveMessage : politeMessage;

    // Clear-then-set on every call so screen readers re-announce duplicate messages.
    target.value = '';
    void nextTick().then(() => {
      target.value = message;
    });

    emitAnnounce(level, message);
  }

  return { announce };
}

/**
 * Provide the announcer to descendant components.
 */
export function provideAnnouncer(instance: UseAnnouncerReturn): void {
  provide(ANNOUNCER_KEY, instance);
}

/**
 * Use the announcer from an ancestor component (custom UI or AutoUI).
 *
 * Never returns undefined: when called outside a GameShell-provided tree,
 * returns a no-op announcer and warns once (dev mode only).
 */
export function useAnnouncer(): UseAnnouncerReturn {
  // Pass undefined as default to suppress Vue's "injection not found" warning.
  const instance = inject(ANNOUNCER_KEY, undefined);
  if (instance) return instance;

  devWarn(
    'useAnnouncer-no-provider',
    'useAnnouncer() was called with no ancestor GameShell providing an announcer. ' +
      'announce() calls will be no-ops. This composable only works inside a component ' +
      'tree rendered by GameShell (custom UI or AutoUI descendants).'
  );
  return { announce: () => {} };
}
