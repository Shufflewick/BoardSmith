import type { VueWrapper } from '@vue/test-utils';
import Toast from './Toast.vue';
import DisabledReasonTooltip from './helpers/DisabledReasonTooltip.vue';

/**
 * THE PAGE'S TWO SINGLETONS, AS A ROOT SHELL'S TESTS CHECK THEM (#308).
 *
 * `GameShell` and `WorldShell` each mount the toast and the disabled-reason
 * tooltip at their root, so both exist on every screen, exactly once. A test
 * asserts `countPageSingletons(wrapper)` equals `{ toast: 1, tooltip: 1 }`.
 */
export function countPageSingletons(wrapper: VueWrapper): { toast: number; tooltip: number } {
  return {
    toast: wrapper.findAllComponents(Toast).length,
    tooltip: wrapper.findAllComponents(DisabledReasonTooltip).length,
  };
}

/**
 * The "Failed to resolve component" warnings among those a mount collected
 * through `global.config.warnHandler`. A tag whose import was removed renders
 * as an unknown element and warns on every render; an empty list proves every
 * component the shell rendered resolved.
 */
export function unresolvedComponents(warnings: string[]): string[] {
  return warnings.filter((w) => w.includes('Failed to resolve component'));
}
