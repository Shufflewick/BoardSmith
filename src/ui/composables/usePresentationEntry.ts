/**
 * usePresentationEntry — the presentation overlay entry for one AutoUI element.
 *
 * Reads the overlay AutoRenderer provides (D-04) and resolves it through
 * resolvePresentation, which strips image and stats from hidden placeholders
 * (PRESENT-02), so no renderer indexes the overlay maps itself.
 */
import { computed, inject, type ComputedRef } from 'vue';
import { resolvePresentation, type PresentationOverlay } from '../components/auto-ui/presentation.js';
import { GAME_CONTEXT_KEYS } from './useGameContext.js';

export function usePresentationEntry(element: () => Parameters<typeof resolvePresentation>[0]) {
  const overlay = inject(GAME_CONTEXT_KEYS.presentation, undefined) as ComputedRef<PresentationOverlay | undefined> | undefined;
  return computed(() => resolvePresentation(element(), overlay?.value));
}
