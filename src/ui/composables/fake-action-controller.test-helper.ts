/**
 * A minimal fake action controller backed by real refs, for the tests that
 * drive `useBoardActionBridge` against a real board-interaction substrate
 * without mounting an ActionPanel or a real controller.
 */
import { vi } from 'vitest';
import { ref, computed } from 'vue';
import type { UseActionControllerReturn, EnrichedPickMetadata, EnrichedValidElement } from './useActionControllerTypes.js';

export function makeController(opts: {
  pick?: EnrichedPickMetadata | null;
  action?: string | null;
  validElements?: EnrichedValidElement[];
}) {
  const currentAction = ref<string | null>(opts.action ?? null);
  const currentPick = computed<EnrichedPickMetadata | null>(() => opts.pick ?? null);
  const currentArgs = ref<Record<string, unknown>>({});
  const isExecuting = ref(false);
  const actionCompletedTick = ref(0);
  const multiSelectDraft = ref(null);
  const actionSnapshot = ref(null);
  const pendingFollowUp = ref(false);
  const pendingOnServer = ref(false);

  const fill = vi.fn(async () => ({ valid: true }));
  const start = vi.fn<UseActionControllerReturn['start']>(async () => ({ success: true }));
  const execute = vi.fn(async () => ({ success: true }));
  const cancel = vi.fn(() => {});
  const toggleMultiSelect = vi.fn(async () => {});

  // Reactive sources the bridge depends on (mirror the real controller, which
  // reads snapshotVersion so async-fetched choices/elements surface reactively).
  const currentChoices = computed(() => opts.pick?.choices ?? []);
  const validElements = computed(() => opts.validElements ?? []);

  const controller = {
    currentAction,
    currentPick,
    currentArgs,
    isExecuting,
    actionCompletedTick,
    multiSelectDraft,
    actionSnapshot,
    pendingFollowUp,
    pendingOnServer,
    currentChoices,
    validElements,
    getCurrentChoices: () => currentChoices.value,
    getValidElements: () => opts.validElements ?? [],
    fill,
    start,
    execute,
    cancel,
    toggleMultiSelect,
  } as unknown as UseActionControllerReturn;

  return { controller, fill, start, execute, toggleMultiSelect, currentAction, currentPick };
}
