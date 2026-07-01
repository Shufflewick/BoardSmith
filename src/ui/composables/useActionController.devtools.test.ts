// @vitest-environment jsdom
/**
 * Tests for the boardsmith:action-resolved CustomEvent dispatch
 * (DEV-03: dev-only instrumentation in useActionController)
 *
 * Covers three dispatch paths:
 *   1. execute() success path (both no-metadata and with-metadata branches)
 *   2. execute() failure path (sendAction returns success:false or throws)
 *   3. Selection-step completion path (handleOnSelectFill + actionComplete)
 *
 * And confirms the dev-gate: import.meta.env.DEV is true under vitest,
 * so events MUST fire in these tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import {
  useActionController,
  type ActionMetadata,
} from './useActionController.js';
import { createMockSendAction, createTestMetadata } from './useActionController.helpers.js';

type ActionResolvedDetail = {
  action: string;
  success: boolean;
  seat: number;
  error?: string;
};

/** Capture boardsmith:action-resolved events during an async operation. */
function captureActionResolvedEvents(): {
  events: CustomEvent<ActionResolvedDetail>[];
  cleanup: () => void;
} {
  const events: CustomEvent<ActionResolvedDetail>[] = [];
  const handler = (e: Event) => events.push(e as CustomEvent<ActionResolvedDetail>);
  window.addEventListener('boardsmith:action-resolved', handler);
  return {
    events,
    cleanup: () => window.removeEventListener('boardsmith:action-resolved', handler),
  };
}

describe('useActionController devtools CustomEvent (boardsmith:action-resolved)', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let availableActions: ReturnType<typeof ref<string[]>>;
  let actionMetadata: ReturnType<typeof ref<Record<string, ActionMetadata> | undefined>>;
  let isMyTurn: ReturnType<typeof ref<boolean>>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    availableActions = ref([
      'endTurn',
      'playCard',
      'forcedPlay',
      'optionalDiscard',
      'optionalSingleChoice',
      'twoStepOptionalSecond',
      'movePiece',
      'attack',
      'discardMultiple',
      'twoStepSingle',
    ]);
    actionMetadata = ref(createTestMetadata());
    isMyTurn = ref(true);
  });

  // -------------------------------------------------------------------------
  // Test 1: execute() success path dispatches with success:true, no error key
  // -------------------------------------------------------------------------
  it('dispatches boardsmith:action-resolved with success:true and no error key after execute() succeeds', async () => {
    const { events, cleanup } = captureActionResolvedEvents();

    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      playerSeat: ref(2),
    });

    // 'playCard' has metadata (selection required) → hits the metadata execute branch
    await controller.execute('playCard', { card: 2 });

    cleanup();
    expect(events).toHaveLength(1);
    expect(events[0].detail.action).toBe('playCard');
    expect(events[0].detail.success).toBe(true);
    expect(events[0].detail.seat).toBe(2);
    // error must be absent on success
    expect('error' in events[0].detail).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 2: execute() failure path dispatches with success:false + error
  // -------------------------------------------------------------------------
  it('dispatches boardsmith:action-resolved with success:false and error when execute() fails', async () => {
    sendAction.mockResolvedValueOnce({ success: false, error: 'Server rejected the move' });

    const { events, cleanup } = captureActionResolvedEvents();

    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      playerSeat: ref(0),
    });

    // 'endTurn' has no metadata → hits the no-metadata execute branch
    await controller.execute('endTurn');

    cleanup();
    expect(events).toHaveLength(1);
    expect(events[0].detail.action).toBe('endTurn');
    expect(events[0].detail.success).toBe(false);
    expect(events[0].detail.error).toBe('Server rejected the move');
    expect(events[0].detail.seat).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: selection-step completion path — action name captured before clear
  // -------------------------------------------------------------------------
  it('dispatches with the correct (non-empty) action name on selection-step completion (capture-before-null)', async () => {
    // pickStep returns actionComplete: true on the single fill step
    const pickStep = vi.fn().mockResolvedValue({
      success: true,
      actionComplete: true,
    });

    const onSelectMeta: Record<string, ActionMetadata> = {
      singleStepAction: {
        name: 'singleStepAction',
        prompt: 'Pick a target',
        selections: [
          {
            name: 'target',
            type: 'choice',
            prompt: 'Select target',
            hasOnSelect: true,
            choices: [
              { value: 'a', display: 'Alpha' },
              { value: 'b', display: 'Beta' },
              { value: 'c', display: 'Gamma' },
            ],
          },
        ],
      },
    };

    actionMetadata.value = { ...createTestMetadata(), ...onSelectMeta };
    availableActions.value = [...(availableActions.value ?? []), 'singleStepAction'];

    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute: false,
      playerSeat: ref(1),
      pickStep,
    });

    await controller.start('singleStepAction');

    const { events, cleanup } = captureActionResolvedEvents();

    // fill() routes through handleOnSelectFill → pickStep returns actionComplete: true
    const fillResult = await controller.fill('target', 'a');
    cleanup();

    expect(fillResult.valid).toBe(true);
    expect(controller.currentAction.value).toBeNull(); // cleared by completion path

    expect(events).toHaveLength(1);

    // Proves capture-before-null: action name must be the action that was active,
    // NOT '' or null (which would happen if captured after currentAction.value = null)
    expect(events[0].detail.action).toBe('singleStepAction');
    expect(events[0].detail.action).not.toBe('');
    expect(events[0].detail.success).toBe(true);
    expect(events[0].detail.seat).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 3b: REGRESSION — selection-step completion that chains a followUp MUST
  // still dispatch. This is the go-fish "ask" path (a successful ask lets you go
  // again → followUp). Before the centralized dispatch fix, the followUp branch of
  // handleOnSelectFill was silent, so an agent never saw the action resolve — proven
  // in a live browser (DEV-04) and missed by the original execute()-only tests.
  // -------------------------------------------------------------------------
  it('dispatches on selection-step completion EVEN WHEN the action chains a followUp (go-fish ask regression)', async () => {
    const pickStep = vi.fn().mockResolvedValue({
      success: true,
      actionComplete: true,
      followUp: { action: 'ask', args: {} }, // successful ask → go again
    });

    const askMeta: Record<string, ActionMetadata> = {
      ask: {
        name: 'ask',
        prompt: 'Ask for a rank',
        selections: [
          {
            name: 'rank',
            type: 'choice',
            prompt: 'Which rank?',
            hasOnSelect: true,
            choices: [
              { value: 'K', display: 'King' },
              { value: 'Q', display: 'Queen' },
            ],
          },
        ],
      },
    };

    actionMetadata.value = { ...createTestMetadata(), ...askMeta };
    availableActions.value = [...(availableActions.value ?? []), 'ask'];

    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute: false,
      playerSeat: ref(1),
      pickStep,
    });

    await controller.start('ask');

    const { events, cleanup } = captureActionResolvedEvents();
    await controller.fill('rank', 'K');
    cleanup();

    // The event MUST fire even though a followUp was queued.
    expect(events).toHaveLength(1);
    expect(events[0].detail.action).toBe('ask');
    expect(events[0].detail.success).toBe(true);
    expect(events[0].detail.seat).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 4: dev-gate is active — import.meta.env.DEV is true under vitest
  // -------------------------------------------------------------------------
  it('import.meta.env.DEV is true in vitest, so events fire in tests (dev-gate is active)', async () => {
    // Confirm the guard condition holds in the test environment
    expect(import.meta.env.DEV).toBe(true);

    const { events, cleanup } = captureActionResolvedEvents();

    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      playerSeat: ref(0),
    });

    await controller.execute('endTurn');
    cleanup();

    // At least one boardsmith:action-resolved event should have fired
    expect(events).toHaveLength(1);
    expect(events[0].detail.action).toBe('endTurn');
  });
});
