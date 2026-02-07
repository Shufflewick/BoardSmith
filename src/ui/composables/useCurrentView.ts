import { inject, type ComputedRef } from 'vue';

/**
 * Injection key for current (truth) game view.
 * Only use when you need the latest truth -- most components should use
 * inject('gameView') which provides the theatre state.
 */
export const CURRENT_VIEW_KEY = 'currentGameView';

/**
 * Get the current (truth) game view.
 *
 * Use this ONLY when you need the latest truth, such as:
 * - AI controller decisions
 * - Post-game summary
 * - Score calculations that must reflect latest state
 *
 * For rendering game elements, use inject('gameView') instead (theatre state).
 *
 * @throws Error if called outside GameShell context
 */
export function useCurrentView(): ComputedRef<Record<string, unknown> | null> {
  const view = inject<ComputedRef<Record<string, unknown> | null>>(CURRENT_VIEW_KEY);
  if (!view) {
    throw new Error(
      'useCurrentView() must be called inside a GameShell context. ' +
      'For rendering game elements, use inject(\'gameView\') instead -- ' +
      'it provides the theatre state which is correct for most UI components.'
    );
  }
  return view;
}
