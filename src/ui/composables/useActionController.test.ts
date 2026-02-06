/**
 * Test suite for useActionController composable
 *
 * Tests the core unified action handling for ActionPanel and custom UIs:
 * - execute() method with validation and auto-fill
 * - Step-by-step wizard mode (start, fill, skip, cancel)
 * - Auto-fill for single-choice selections
 * - Auto-execute when all selections filled
 * - Error handling and validation
 *
 * Selection-specific tests (repeating, dependsOn, filterBy, text/number,
 * element, multiSelect) are in useActionController.selections.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, reactive, nextTick } from 'vue';
import {
  useActionController,
  injectActionController,
  injectPickStepFn,
  injectBoardInteraction,
  ACTION_CONTROLLER_KEY,
  type ActionMetadata,
} from './useActionController.js';
import { createMockSendAction, createTestMetadata } from './useActionController.helpers.js';

describe('useActionController', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let availableActions: ReturnType<typeof ref<string[]>>;
  let actionMetadata: ReturnType<typeof ref<Record<string, ActionMetadata> | undefined>>;
  let isMyTurn: ReturnType<typeof ref<boolean>>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    availableActions = ref(['endTurn', 'playCard', 'forcedPlay', 'optionalDiscard', 'optionalSingleChoice', 'twoStepOptionalSecond', 'movePiece', 'attack', 'discardMultiple']);
    actionMetadata = ref(createTestMetadata());
    isMyTurn = ref(true);
  });

  describe('initialization', () => {
    it('should initialize with correct default state', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      expect(controller.currentAction.value).toBe(null);
      expect(controller.currentArgs.value).toEqual({});
      expect(controller.currentPick.value).toBe(null);
      expect(controller.isReady.value).toBe(false);
      expect(controller.isExecuting.value).toBe(false);
      expect(controller.lastError.value).toBe(null);
    });
  });

  describe('execute() method', () => {
    it('should execute action with no selections', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('endTurn');

      expect(result.success).toBe(true);
      expect(sendAction).toHaveBeenCalledWith('endTurn', {});
    });

    it('should execute action with provided args', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('playCard', { card: 2 });

      expect(result.success).toBe(true);
      expect(sendAction).toHaveBeenCalledWith('playCard', { card: 2 });
    });

    it('should auto-fill single-choice selections', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('forcedPlay');

      expect(result.success).toBe(true);
      expect(sendAction).toHaveBeenCalledWith('forcedPlay', { card: 42 });
    });

    it('should fail when required selection is missing', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('playCard');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required selection');
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('should fail when action is not available', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('invalidAction');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('should fail when not my turn', async () => {
      isMyTurn.value = false;

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('endTurn');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn');
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('should validate provided args against choices', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('playCard', { card: 999 }); // Invalid card

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid selection');
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('should handle server errors gracefully', async () => {
      sendAction.mockResolvedValueOnce({ success: false, error: 'Server error' });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('endTurn');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server error');
      expect(controller.lastError.value).toBe('Server error');
    });

    it('should handle exceptions gracefully', async () => {
      sendAction.mockRejectedValueOnce(new Error('Network error'));

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('endTurn');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(controller.lastError.value).toBe('Network error');
    });

    it('should succeed for optional selections without value', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('optionalDiscard');

      expect(result.success).toBe(true);
      expect(sendAction).toHaveBeenCalledWith('optionalDiscard', {});
    });
  });

  describe('step-by-step mode (wizard)', () => {
    it('should start an action and track current selection', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false, // Disable auto-execute for wizard mode tests
      });

      controller.start('playCard');

      expect(controller.currentAction.value).toBe('playCard');
      expect(controller.currentPick.value?.name).toBe('card');
      expect(controller.isReady.value).toBe(false);
    });

    it('should fail to start unavailable action', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      controller.start('invalidAction');

      expect(controller.currentAction.value).toBe(null);
      expect(controller.lastError.value).toContain('not available');
    });

    it('should fill a selection with valid value', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('playCard');
      const result = await controller.fill('card', 2);

      expect(result.valid).toBe(true);
      expect(controller.currentArgs.value.card).toBe(2);
      expect(controller.isReady.value).toBe(true);
    });

    it('should reject invalid value in fill()', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('playCard');
      const result = await controller.fill('card', 999);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid selection');
      expect(controller.currentArgs.value.card).toBeUndefined();
    });

    it('should skip optional selection', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('optionalDiscard');
      controller.skip('card');

      expect(controller.currentArgs.value.card).toBe(null);
      expect(controller.isReady.value).toBe(true);
    });

    it('should clear a selection', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('playCard');
      await controller.fill('card', 2);
      expect(controller.currentArgs.value.card).toBe(2);

      controller.clear('card');
      expect(controller.currentArgs.value.card).toBeUndefined();
      expect(controller.isReady.value).toBe(false);
    });

    it('should cancel an action', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('playCard');
      await controller.fill('card', 2);

      controller.cancel();

      expect(controller.currentAction.value).toBe(null);
      expect(controller.currentArgs.value).toEqual({});
      expect(controller.lastError.value).toBe(null);
    });

    it('should progress through multiple selections', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('attack');

      // First selection
      expect(controller.currentPick.value?.name).toBe('attacker');
      await controller.fill('attacker', 1);

      // Second selection
      expect(controller.currentPick.value?.name).toBe('target');
      await controller.fill('target', 10);

      // All filled
      expect(controller.currentPick.value).toBe(null);
      expect(controller.isReady.value).toBe(true);
    });
  });

  describe('auto-fill behavior', () => {
    it('should auto-fill single-choice selection when autoFill is enabled', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
      });

      await controller.start('forcedPlay');
      await nextTick();

      expect(controller.currentArgs.value.card).toBe(42);
      expect(controller.isReady.value).toBe(true);
    });

    it('should not auto-fill when autoFill is disabled', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });

      await controller.start('forcedPlay');
      await nextTick();

      expect(controller.currentArgs.value.card).toBeUndefined();
    });

    it('should not auto-fill optional selection with single choice', async () => {
      // When a selection has optional set, user must consciously choose or skip,
      // even if there's only one choice. Auto-fill would bypass the skip button.
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
      });

      await controller.start('optionalSingleChoice');
      await nextTick();

      // Should NOT auto-fill - user must choose or skip
      expect(controller.currentArgs.value.item).toBeUndefined();
      // Should show the selection with optional skip button
      expect(controller.currentPick.value?.optional).toBe('Done equipping');
    });

    it('should not auto-fill optional second selection even when first auto-fills', async () => {
      // Tests the case where: first selection has 1 choice (auto-fills),
      // second selection is optional with 1 choice (should NOT auto-fill)
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
      });

      await controller.start('twoStepOptionalSecond');
      await nextTick();

      // First selection should auto-fill (not optional)
      expect(controller.currentArgs.value.first).toBe('auto');
      // Second selection should NOT auto-fill because it's optional
      expect(controller.currentArgs.value.second).toBeUndefined();
      // Should show the optional selection
      expect(controller.currentPick.value?.name).toBe('second');
      expect(controller.currentPick.value?.optional).toBe(true);
    });
  });

  describe('auto-execute behavior', () => {
    it('should auto-execute when all selections filled and autoExecute is enabled', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: true,
      });

      await controller.start('forcedPlay');
      await nextTick();
      await nextTick(); // Need extra tick for auto-execute watch

      expect(sendAction).toHaveBeenCalledWith('forcedPlay', { card: 42 });
    });

    it('should not auto-execute when autoExecute is disabled', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
      });

      await controller.start('forcedPlay');
      await nextTick();
      await nextTick();

      expect(sendAction).not.toHaveBeenCalled();
      expect(controller.isReady.value).toBe(true);
    });
  });

  describe('getChoices utility', () => {
    it('should return choices from choice selection', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const selection = actionMetadata.value!.playCard.selections[0];
      const choices = controller.getChoices(selection);

      expect(choices).toHaveLength(3);
      expect(choices[0]).toEqual({ value: 1, display: 'Ace of Spades' });
    });

    it('should return choices from element selection validElements', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const selection = actionMetadata.value!.movePiece.selections[0];
      const choices = controller.getChoices(selection);

      expect(choices).toHaveLength(3);
      expect(choices[0]).toEqual({ value: 100, display: 'Pawn A' });
    });

    it('should return empty array for selection without choices', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      // Create a selection without choices or validElements
      const selection = { name: 'text', type: 'text' as const, prompt: 'Enter text' };
      const choices = controller.getChoices(selection);

      expect(choices).toEqual([]);
    });
  });

  describe('getActionMetadata utility', () => {
    it('should return metadata for known action', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const meta = controller.getActionMetadata('playCard');

      expect(meta).toBeDefined();
      expect(meta!.name).toBe('playCard');
      expect(meta!.selections).toHaveLength(1);
    });

    it('should return undefined for unknown action', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const meta = controller.getActionMetadata('unknownAction');

      expect(meta).toBeUndefined();
    });
  });

  describe('isExecuting guard', () => {
    it('should track executing state during execution', async () => {
      let executingDuringCall = false;

      sendAction.mockImplementation(async () => {
        // Check if isExecuting is true during the call
        await new Promise(resolve => setTimeout(resolve, 10));
        return { success: true };
      });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      // Before execution
      expect(controller.isExecuting.value).toBe(false);

      const promise = controller.execute('endTurn');

      // During execution (synchronously after starting)
      expect(controller.isExecuting.value).toBe(true);

      await promise;

      // After execution
      expect(controller.isExecuting.value).toBe(false);
    });
  });

  describe('state cleanup', () => {
    it('should clear wizard state after auto-execute', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: true,
      });

      // Start action with single choice (will auto-fill and auto-execute)
      await controller.start('forcedPlay');
      await nextTick();
      await nextTick(); // Extra tick for auto-execute watch

      // After auto-execute, wizard state should be cleared
      expect(controller.currentAction.value).toBe(null);
      expect(controller.currentArgs.value).toEqual({});
      expect(sendAction).toHaveBeenCalledWith('forcedPlay', { card: 42 });
    });

    it('should clear wizard state after cancel', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('playCard');
      await controller.fill('card', 2);

      expect(controller.currentAction.value).toBe('playCard');
      expect(controller.currentArgs.value.card).toBe(2);

      controller.cancel();

      // State should be cleared
      expect(controller.currentAction.value).toBe(null);
      expect(controller.currentArgs.value).toEqual({});
    });

    it('should track lastError after failed direct execution', async () => {
      sendAction.mockResolvedValueOnce({ success: false, error: 'Server rejected' });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('endTurn');

      expect(result.success).toBe(false);
      expect(controller.lastError.value).toBe('Server rejected');
    });

    it('should clear lastError when starting new action', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      // Set an error
      await controller.start('invalidAction'); // This sets lastError
      expect(controller.lastError.value).toContain('not available');

      // Start a valid action
      await controller.start('playCard');

      // Error should be cleared
      expect(controller.lastError.value).toBe(null);
    });
  });

  describe('injection helpers', () => {
    it('should export ACTION_CONTROLLER_KEY constant', () => {
      expect(ACTION_CONTROLLER_KEY).toBe('actionController');
    });

    it('should throw error when injectActionController called outside context', () => {
      // Note: We can't properly test inject() without a Vue app context,
      // but we can verify the function exists and throws when inject returns undefined
      expect(() => injectActionController()).toThrow('must be called inside a GameShell context');
    });

    it('should return undefined for optional injections outside context', () => {
      // These return undefined instead of throwing (optional)
      expect(injectPickStepFn()).toBeUndefined();
      expect(injectBoardInteraction()).toBeUndefined();
    });

    it('should export injection helper functions', () => {
      // Verify the functions are exported and callable
      expect(typeof injectPickStepFn).toBe('function');
      expect(typeof injectBoardInteraction).toBe('function');
    });
  });

  describe('externalArgs (bidirectional sync)', () => {
    it('should use external args when provided', () => {
      const externalArgs: Record<string, unknown> = { existing: 'value' };

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        externalArgs,
      });

      // Controller should see the external args
      expect(controller.currentArgs.value.existing).toBe('value');
    });

    it('should write to external args object', async () => {
      const externalArgs: Record<string, unknown> = {};

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        externalArgs,
      });

      await controller.start('playCard');
      await controller.fill('card', 2);

      // Both controller.currentArgs and externalArgs should see the value
      expect(controller.currentArgs.value.card).toBe(2);
      expect(externalArgs.card).toBe(2);
    });

    it('should allow external writes to be seen by controller', () => {
      const externalArgs: Record<string, unknown> = {};

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        externalArgs,
      });

      // Simulate external write (e.g., from custom game board)
      externalArgs.customField = 'custom value';

      // Controller should see it
      expect(controller.currentArgs.value.customField).toBe('custom value');
    });

    it('should clear external args when clearArgs is called', () => {
      const externalArgs: Record<string, unknown> = { a: 1, b: 2 };

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        externalArgs,
      });

      expect(Object.keys(externalArgs).length).toBe(2);

      controller.clearArgs();

      // External args should be cleared
      expect(Object.keys(externalArgs).length).toBe(0);
      expect(Object.keys(controller.currentArgs.value).length).toBe(0);
    });

    it('should clear external args when action is cancelled', async () => {
      const externalArgs: Record<string, unknown> = {};

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        externalArgs,
      });

      await controller.start('playCard');
      await controller.fill('card', 2);
      expect(externalArgs.card).toBe(2);

      controller.cancel();

      // External args should be cleared
      expect(Object.keys(externalArgs).length).toBe(0);
    });

    it('should clear external args after wizard-mode execution via auto-execute', async () => {
      // External args must be reactive for Vue's watch to detect changes
      const externalArgs = reactive<Record<string, unknown>>({});

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: true, // Enable auto-execute to test the wizard flow
        externalArgs,
      });

      await controller.start('playCard');
      await controller.fill('card', 2);
      expect(externalArgs.card).toBe(2);

      // Wait for auto-execute to complete (needs multiple ticks for watch cascade)
      await nextTick();
      await nextTick();
      await nextTick();
      // Also wait for the sendAction promise to resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      // External args should be cleared after wizard execution
      expect(Object.keys(externalArgs).length).toBe(0);
      expect(controller.currentAction.value).toBe(null);
    });

    it('should preserve external args when using direct execute (bypasses wizard)', async () => {
      const externalArgs: Record<string, unknown> = { preserved: 'value' };

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
        externalArgs,
      });

      // Direct execute with explicit args - doesn't use or clear wizard state
      await controller.execute('playCard', { card: 2 });

      // External args should be preserved (direct execute doesn't touch wizard state)
      expect(externalArgs.preserved).toBe('value');
    });
  });

  describe('start() with initialArgs', () => {
    it('should apply initial args when starting an action', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('attack', { args: { attacker: 1 } });

      expect(controller.currentArgs.value.attacker).toBe(1);
      // Should skip to second selection since first is pre-filled
      expect(controller.currentPick.value?.name).toBe('target');
    });

    it('should clear previous args before applying initial args', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      // Start first action and fill some args
      await controller.start('playCard');
      await controller.fill('card', 2);
      expect(controller.currentArgs.value.card).toBe(2);

      // Start new action with different initial args
      await controller.start('attack', { args: { attacker: 1 } });

      // Old args should be cleared
      expect(controller.currentArgs.value.card).toBeUndefined();
      expect(controller.currentArgs.value.attacker).toBe(1);
    });

    it('should work with all args pre-filled making action ready', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });

      await controller.start('attack', { args: { attacker: 1, target: 10 } });

      expect(controller.isReady.value).toBe(true);
      expect(controller.currentPick.value).toBe(null);
    });
  });

  describe('selection choices', () => {
    it('should fetch choices when starting action', async () => {
      const fetchPickChoices = vi.fn().mockResolvedValue({
        success: true,
        choices: [
          { value: 'A', display: 'Choice A' },
          { value: 'B', display: 'Choice B' },
        ],
      });

      // Create metadata with choice selection
      const choiceMeta: Record<string, ActionMetadata> = {
        choiceAction: {
          name: 'choiceAction',
          prompt: 'Select something',
          selections: [
            {
              name: 'item',
              type: 'choice',
              prompt: 'Select item',
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...choiceMeta };
      availableActions.value = [...(availableActions.value ?? []), 'choiceAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        playerSeat: ref(0),
        fetchPickChoices,
      });

      await controller.start('choiceAction');

      expect(fetchPickChoices).toHaveBeenCalledWith('choiceAction', 'item', 0, {});
    });

    it('should track isLoadingChoices state during fetch', async () => {
      let resolveFetch: (value: any) => void;
      const fetchPromise = new Promise(resolve => { resolveFetch = resolve; });

      const fetchPickChoices = vi.fn().mockReturnValue(fetchPromise);

      const choiceMeta: Record<string, ActionMetadata> = {
        choiceAction: {
          name: 'choiceAction',
          prompt: 'Select something',
          selections: [
            { name: 'item', type: 'choice', prompt: 'Select' },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...choiceMeta };
      availableActions.value = [...(availableActions.value ?? []), 'choiceAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        fetchPickChoices,
      });

      const startPromise = controller.start('choiceAction');

      // Should be loading
      expect(controller.isLoadingChoices.value).toBe(true);

      resolveFetch!({ success: true, choices: [] });
      await startPromise;

      // Should no longer be loading
      expect(controller.isLoadingChoices.value).toBe(false);
    });

    it('should use fetched choices in getChoices()', async () => {
      const fetchPickChoices = vi.fn().mockResolvedValue({
        success: true,
        choices: [
          { value: 'fetched1', display: 'Fetched 1' },
          { value: 'fetched2', display: 'Fetched 2' },
        ],
      });

      const choiceMeta: Record<string, ActionMetadata> = {
        choiceAction: {
          name: 'choiceAction',
          prompt: 'Select something',
          selections: [
            { name: 'item', type: 'choice', prompt: 'Select' },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...choiceMeta };
      availableActions.value = [...(availableActions.value ?? []), 'choiceAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        fetchPickChoices,
      });

      await controller.start('choiceAction');

      const selection = actionMetadata.value!.choiceAction.selections[0];
      const choices = controller.getChoices(selection);

      expect(choices).toHaveLength(2);
      expect(choices[0].value).toBe('fetched1');
    });

    it('should fetch choices for all selections (always-fetch approach)', async () => {
      // The mock returns choices for both selections - 'x' for both
      const fetchPickChoices = vi.fn().mockResolvedValue({
        success: true,
        choices: [{ value: 'x', display: 'X' }],
      });

      const twoStepMeta: Record<string, ActionMetadata> = {
        twoStepAction: {
          name: 'twoStepAction',
          prompt: 'Two step action',
          selections: [
            {
              name: 'first',
              type: 'choice',
              prompt: 'First',
            },
            {
              name: 'second',
              type: 'choice',
              prompt: 'Second',
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...twoStepMeta };
      availableActions.value = [...(availableActions.value ?? []), 'twoStepAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
        fetchPickChoices,
      });

      await controller.start('twoStepAction');
      // First selection fetches choices
      expect(fetchPickChoices).toHaveBeenCalledWith('twoStepAction', 'first', 0, {});

      fetchPickChoices.mockClear();
      // Fill with 'x' which is what was fetched
      await controller.fill('first', 'x');

      // Should fetch for the second selection as well
      expect(fetchPickChoices).toHaveBeenCalledWith('twoStepAction', 'second', 0, { first: 'x' });
    });
  });

  describe('getCurrentChoices()', () => {
    it('should return choices for current selection', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });

      await controller.start('playCard');

      const choices = controller.getCurrentChoices();

      expect(choices).toHaveLength(3);
      expect(choices[0].display).toBe('Ace of Spades');
    });

    it('should return empty array when no action started', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      const choices = controller.getCurrentChoices();

      expect(choices).toEqual([]);
    });
  });

  describe('error recovery', () => {
    it('should allow retry after validation error', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('playCard');

      // First attempt - invalid
      let result = await controller.fill('card', 999);
      expect(result.valid).toBe(false);
      expect(controller.lastError.value).toContain('Invalid');

      // Second attempt - valid
      result = await controller.fill('card', 2);
      expect(result.valid).toBe(true);
      expect(controller.currentArgs.value.card).toBe(2);
    });

    it('should clear error on new action start', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      // Create an error
      await controller.start('invalidAction');
      expect(controller.lastError.value).not.toBeNull();

      // Start a valid action
      await controller.start('playCard');
      expect(controller.lastError.value).toBeNull();
    });
  });

  describe('fetchChoicesForPick()', () => {
    it('should do nothing without fetchPickChoices callback', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        // No fetchPickChoices provided
      });

      await controller.start('playCard');

      // Should not throw
      await controller.fetchChoicesForPick('card');
    });

    it('should do nothing when no action is active', async () => {
      const fetchPickChoices = vi.fn();

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        fetchPickChoices,
      });

      await controller.fetchChoicesForPick('card');

      expect(fetchPickChoices).not.toHaveBeenCalled();
    });
  });

  describe('disabled selections', () => {
    it('should reject disabled choice value with reason string', async () => {
      const disabledMeta: Record<string, ActionMetadata> = {
        selectCard: {
          name: 'selectCard',
          prompt: 'Select a card',
          selections: [
            {
              name: 'card',
              type: 'choice',
              prompt: 'Pick a card',
              choices: [
                { value: 1, display: 'Ace of Spades' },
                { value: 2, display: 'King of Hearts', disabled: 'Already played' },
                { value: 3, display: 'Queen of Diamonds' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...disabledMeta };
      availableActions.value = [...(availableActions.value ?? []), 'selectCard'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('selectCard');
      const result = await controller.fill('card', 2);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Selection disabled: Already played');
      expect(controller.currentArgs.value.card).toBeUndefined();
    });

    it('should reject disabled value in multiSelect array', async () => {
      const disabledMultiMeta: Record<string, ActionMetadata> = {
        selectCards: {
          name: 'selectCards',
          prompt: 'Select cards',
          selections: [
            {
              name: 'cards',
              type: 'choice',
              prompt: 'Pick cards',
              multiSelect: { min: 1, max: 3 },
              choices: [
                { value: 1, display: 'Card A' },
                { value: 2, display: 'Card B', disabled: 'In use' },
                { value: 3, display: 'Card C' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...disabledMultiMeta };
      availableActions.value = [...(availableActions.value ?? []), 'selectCards'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('selectCards');
      const result = await controller.fill('cards', [1, 2]);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Selection disabled: In use');
    });

    it('should auto-fill the single enabled choice when others are disabled', async () => {
      const disabledAutoFillMeta: Record<string, ActionMetadata> = {
        forcedSelect: {
          name: 'forcedSelect',
          prompt: 'Select item',
          selections: [
            {
              name: 'item',
              type: 'choice',
              prompt: 'Pick an item',
              choices: [
                { value: 'a', display: 'Item A', disabled: 'Exhausted' },
                { value: 'b', display: 'Item B' },
                { value: 'c', display: 'Item C', disabled: 'Locked' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...disabledAutoFillMeta };
      availableActions.value = [...(availableActions.value ?? []), 'forcedSelect'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
      });

      await controller.start('forcedSelect');
      await nextTick();

      // Should auto-fill with the only enabled choice
      expect(controller.currentArgs.value.item).toBe('b');
      expect(controller.isReady.value).toBe(true);
    });

    it('should NOT auto-fill when all choices are disabled', async () => {
      const allDisabledMeta: Record<string, ActionMetadata> = {
        allDisabled: {
          name: 'allDisabled',
          prompt: 'All disabled',
          selections: [
            {
              name: 'item',
              type: 'choice',
              prompt: 'Pick an item',
              choices: [
                { value: 'a', display: 'Item A', disabled: 'Exhausted' },
                { value: 'b', display: 'Item B', disabled: 'Locked' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...allDisabledMeta };
      availableActions.value = [...(availableActions.value ?? []), 'allDisabled'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
      });

      await controller.start('allDisabled');
      await nextTick();

      // Should NOT auto-fill - no enabled choices
      expect(controller.currentArgs.value.item).toBeUndefined();
      expect(controller.currentPick.value?.name).toBe('item');
      expect(controller.isReady.value).toBe(false);
    });

    it('should include disabled field in getChoices() return values', async () => {
      const disabledChoicesMeta: Record<string, ActionMetadata> = {
        withDisabled: {
          name: 'withDisabled',
          prompt: 'Action with disabled choices',
          selections: [
            {
              name: 'item',
              type: 'choice',
              prompt: 'Pick an item',
              choices: [
                { value: 1, display: 'Enabled Item' },
                { value: 2, display: 'Disabled Item', disabled: 'Out of stock' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...disabledChoicesMeta };
      availableActions.value = [...(availableActions.value ?? []), 'withDisabled'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });

      await controller.start('withDisabled');

      const choices = controller.getCurrentChoices();

      expect(choices).toHaveLength(2);
      expect(choices[0].disabled).toBeUndefined();
      expect(choices[1].disabled).toBe('Out of stock');
    });

    it('should allow filling enabled choices when disabled ones exist', async () => {
      const mixedMeta: Record<string, ActionMetadata> = {
        mixedChoices: {
          name: 'mixedChoices',
          prompt: 'Mixed choices',
          selections: [
            {
              name: 'card',
              type: 'choice',
              prompt: 'Pick a card',
              choices: [
                { value: 1, display: 'Ace', disabled: 'Not allowed' },
                { value: 2, display: 'King' },
                { value: 3, display: 'Queen' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...mixedMeta };
      availableActions.value = [...(availableActions.value ?? []), 'mixedChoices'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('mixedChoices');

      // Enabled choice should be accepted
      const result = await controller.fill('card', 2);
      expect(result.valid).toBe(true);
      expect(controller.currentArgs.value.card).toBe(2);
    });

    it('should reject disabled value via execute() validation', async () => {
      const disabledExecMeta: Record<string, ActionMetadata> = {
        execDisabled: {
          name: 'execDisabled',
          prompt: 'Execute with disabled',
          selections: [
            {
              name: 'target',
              type: 'choice',
              prompt: 'Pick target',
              choices: [
                { value: 'a', display: 'Target A', disabled: 'Shielded' },
                { value: 'b', display: 'Target B' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...disabledExecMeta };
      availableActions.value = [...(availableActions.value ?? []), 'execDisabled'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('execDisabled', { target: 'a' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Selection disabled: Shielded');
      expect(sendAction).not.toHaveBeenCalled();
    });
  });

});
