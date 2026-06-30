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
import { ref, nextTick } from 'vue';
import {
  useActionController,
  injectActionController,
  injectPickStepFn,
  injectBoardInteraction,
  ACTION_CONTROLLER_KEY,
  type ActionMetadata,
} from './useActionController.js';
import { createMockSendAction, createTestMetadata } from './useActionController.helpers.js';
import type { TutorialStepView } from '../../engine/tutorial/types.js';

describe('useActionController', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let availableActions: ReturnType<typeof ref<string[]>>;
  let actionMetadata: ReturnType<typeof ref<Record<string, ActionMetadata> | undefined>>;
  let isMyTurn: ReturnType<typeof ref<boolean>>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    availableActions = ref(['endTurn', 'playCard', 'forcedPlay', 'optionalDiscard', 'optionalSingleChoice', 'twoStepOptionalSecond', 'movePiece', 'attack', 'discardMultiple', 'twoStepSingle']);
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

    it('clears currentAction after execute() of an already-started action (auto-start can resume next turn)', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      // The ActionPanel auto-starts the action (sets currentAction)...
      await controller.start('playCard');
      expect(controller.currentAction.value).toBe('playCard');

      // ...then a custom UI plays via direct execute(). The in-progress action must
      // be cleared so the next auto-start isn't blocked by a stale currentAction.
      const result = await controller.execute('playCard', { card: 2 });
      expect(result.success).toBe(true);
      expect(controller.currentAction.value).toBe(null);
      expect(controller.currentArgs.value).toEqual({});
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

    it('should run setBeforeAutoExecute hook before auto-execute', async () => {
      const calls: string[] = [];
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: true,
      });

      controller.setBeforeAutoExecute((actionName) => {
        calls.push(`hook:${actionName}`);
      });
      // sendAction records execution order via the calls array too
      sendAction.mockImplementation(async (name: string) => {
        calls.push(`send:${name}`);
        return { success: true };
      });

      await controller.start('forcedPlay');
      await nextTick();
      await nextTick();

      // Hook must run before the action is sent
      expect(calls).toEqual(['hook:forcedPlay', 'send:forcedPlay']);
    });

    it('setBeforeAutoExecute replaces the previous hook (single-slot)', async () => {
      const calls: string[] = [];
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: true,
      });

      controller.setBeforeAutoExecute(() => { calls.push('first'); });
      controller.setBeforeAutoExecute(() => { calls.push('second'); });

      await controller.start('forcedPlay');
      await nextTick();
      await nextTick();

      // Only the most recently set hook fires
      expect(calls).toEqual(['second']);
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
    });

    it('should throw when injectBoardInteraction called outside context', () => {
      // Mirrors injectActionController: the board-interaction channel fails
      // loudly with an actionable message instead of silently returning
      // undefined (regression for F21).
      expect(() => injectBoardInteraction()).toThrow('must be called inside a <GameShell>');
    });

    it('should export injection helper functions', () => {
      // Verify the functions are exported and callable
      expect(typeof injectPickStepFn).toBe('function');
      expect(typeof injectBoardInteraction).toBe('function');
    });
  });

  describe('currentArgs ownership', () => {
    it('should keep args isolated to controller state', async () => {
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

      controller.cancel();
      expect(controller.currentArgs.value.card).toBeUndefined();
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

    describe('disabled element-type selections', () => {
      it('should include disabled field in getChoices() for element-type selections', () => {
        const disabledElementMeta: Record<string, ActionMetadata> = {
          moveWithDisabled: {
            name: 'moveWithDisabled',
            prompt: 'Move piece',
            selections: [
              {
                name: 'piece',
                type: 'element',
                prompt: 'Select piece',
                validElements: [
                  { id: 100, display: 'Pawn A' },
                  { id: 101, display: 'Pawn B', disabled: 'Pinned' },
                ],
              },
            ],
          },
        };

        actionMetadata.value = { ...createTestMetadata(), ...disabledElementMeta };
        availableActions.value = [...(availableActions.value ?? []), 'moveWithDisabled'];

        const controller = useActionController({
          sendAction,
          availableActions,
          actionMetadata,
          isMyTurn,
          autoFill: false,
          autoExecute: false,
        });

        controller.start('moveWithDisabled');

        const selection = actionMetadata.value!.moveWithDisabled.selections[0];
        const choices = controller.getChoices(selection);

        expect(choices).toHaveLength(2);
        expect(choices[0].disabled).toBeUndefined();
        expect(choices[1].disabled).toBe('Pinned');

        // getCurrentChoices() should return the same disabled values
        const currentChoices = controller.getCurrentChoices();
        expect(currentChoices).toHaveLength(2);
        expect(currentChoices[0].disabled).toBeUndefined();
        expect(currentChoices[1].disabled).toBe('Pinned');
      });

      it('should reject disabled element value via fill()', async () => {
        const disabledElementMeta: Record<string, ActionMetadata> = {
          moveWithDisabled: {
            name: 'moveWithDisabled',
            prompt: 'Move piece',
            selections: [
              {
                name: 'piece',
                type: 'element',
                prompt: 'Select piece',
                validElements: [
                  { id: 100, display: 'Pawn A' },
                  { id: 101, display: 'Pawn B', disabled: 'Pinned' },
                ],
              },
            ],
          },
        };

        actionMetadata.value = { ...createTestMetadata(), ...disabledElementMeta };
        availableActions.value = [...(availableActions.value ?? []), 'moveWithDisabled'];

        const controller = useActionController({
          sendAction,
          availableActions,
          actionMetadata,
          isMyTurn,
          autoExecute: false,
        });

        await controller.start('moveWithDisabled');

        // Disabled element should be rejected
        const result = await controller.fill('piece', 101);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Selection disabled: Pinned');

        // Enabled element should be accepted
        const ok = await controller.fill('piece', 100);
        expect(ok.valid).toBe(true);
      });

      it('should auto-fill single enabled element when others are disabled', async () => {
        const autoFillElementMeta: Record<string, ActionMetadata> = {
          forcedElement: {
            name: 'forcedElement',
            prompt: 'Select piece',
            selections: [
              {
                name: 'piece',
                type: 'element',
                prompt: 'Select piece',
                validElements: [
                  { id: 100, display: 'Pawn A', disabled: 'Blocked' },
                  { id: 101, display: 'Pawn B' },
                ],
              },
            ],
          },
        };

        actionMetadata.value = { ...createTestMetadata(), ...autoFillElementMeta };
        availableActions.value = [...(availableActions.value ?? []), 'forcedElement'];

        const controller = useActionController({
          sendAction,
          availableActions,
          actionMetadata,
          isMyTurn,
          autoFill: true,
          autoExecute: false,
        });

        await controller.start('forcedElement');
        await nextTick();

        expect(controller.currentArgs.value.piece).toBe(101);
        expect(controller.isReady.value).toBe(true);
      });

      it('should include disabled in getChoices() for elementsByDependentValue', async () => {
        const depElementMeta: Record<string, ActionMetadata> = {
          depElementAction: {
            name: 'depElementAction',
            prompt: 'Select with depends',
            selections: [
              {
                name: 'zone',
                type: 'choice',
                prompt: 'Select zone',
                choices: [{ value: 'north', display: 'North' }],
              },
              {
                name: 'unit',
                type: 'element',
                prompt: 'Select unit',
                dependsOn: 'zone',
                elementsByDependentValue: {
                  north: [
                    { id: 1, display: 'Soldier' },
                    { id: 2, display: 'Medic', disabled: 'Exhausted' },
                  ],
                },
              },
            ],
          },
        };

        actionMetadata.value = { ...createTestMetadata(), ...depElementMeta };
        availableActions.value = [...(availableActions.value ?? []), 'depElementAction'];

        const controller = useActionController({
          sendAction,
          availableActions,
          actionMetadata,
          isMyTurn,
          autoFill: true,
          autoExecute: false,
        });

        await controller.start('depElementAction');
        await nextTick(); // zone auto-fills to 'north'

        const unitSel = depElementMeta.depElementAction.selections[1];
        const choices = controller.getChoices(unitSel);

        expect(choices).toHaveLength(2);
        expect(choices[0].disabled).toBeUndefined();
        expect(choices[1].disabled).toBe('Exhausted');
      });
    });
  });

  describe('followUp + skip + auto-execute', () => {
    it('should preserve followUp pre-filled args when skip triggers auto-execute', async () => {
      // Metadata for the followUp action: one optional selection, no other selections
      const followUpMeta: Record<string, ActionMetadata> = {
        collectEquipment: {
          name: 'collectEquipment',
          prompt: 'Collect equipment',
          selections: [
            {
              name: 'equipment',
              type: 'choice',
              prompt: 'Select equipment',
              optional: true,
              choices: [
                { value: 'sword', display: 'Sword' },
                { value: 'shield', display: 'Shield' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...followUpMeta };
      availableActions.value = [...(availableActions.value ?? []), 'collectEquipment'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: true,
        autoFill: false,
      });

      // Simulate followUp starting with pre-filled args
      // This is what happens when Action A returns { followUp: { action: 'collectEquipment', args: { combatantId: 42, sectorId: 7 } } }
      sendAction.mockResolvedValueOnce({
        success: true,
        followUp: {
          action: 'collectEquipment',
          args: { combatantId: 42, sectorId: 7 },
        },
      });

      // Execute the first action which triggers the followUp
      await controller.execute('endTurn');
      // Wait for setTimeout(0) in executeCurrentAction's followUp handling
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      // Verify followUp started with pre-filled args
      expect(controller.currentAction.value).toBe('collectEquipment');
      expect(controller.currentArgs.value.combatantId).toBe(42);
      expect(controller.currentArgs.value.sectorId).toBe(7);

      // Now skip the optional equipment selection
      controller.skip('equipment');
      await nextTick();
      await nextTick(); // Extra tick for auto-execute watch

      // The auto-execute should have sent the action with ALL args including pre-filled followUp args
      // Bug: executeCurrentAction uses { ...currentArgs.value } which can be wiped by external code
      // Fix: should use buildServerArgs() which reads from collectedPicks (controller-owned state)
      const lastCall = sendAction.mock.calls[sendAction.mock.calls.length - 1];
      expect(lastCall[0]).toBe('collectEquipment');
      expect(lastCall[1]).toHaveProperty('combatantId', 42);
      expect(lastCall[1]).toHaveProperty('sectorId', 7);
    });

    it('buildServerArgs should exclude skipped selections', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        autoFill: false,
      });

      await controller.start('optionalDiscard');
      controller.skip('card');

      // After skip, isReady should be true
      expect(controller.isReady.value).toBe(true);

      // The snapshot should have the skipped entry
      const snapshot = controller.actionSnapshot.value;
      expect(snapshot).not.toBeNull();
      const cardPick = snapshot!.collectedPicks.get('card');
      expect(cardPick).toBeDefined();
      expect(cardPick!.skipped).toBe(true);
      expect(cardPick!.value).toBe(null);

      // When auto-execute sends args, skipped entries should NOT be included as null
      // They should be excluded (server expects undefined for optional missing args)
      // We can verify this by checking that executeCurrentAction sends args without the skipped key
      sendAction.mockClear();

      // Manually trigger auto-execute path by starting and skipping with auto-execute on
      const controller2 = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: true,
        autoFill: false,
      });

      await controller2.start('optionalDiscard');
      controller2.skip('card');
      await nextTick();
      await nextTick();

      // sendAction should have been called without 'card' key (not with card: null)
      expect(sendAction).toHaveBeenCalled();
      const args = sendAction.mock.calls[sendAction.mock.calls.length - 1][1];
      expect(args).not.toHaveProperty('card');
    });
  });

  describe('multiSelect draft (shared in-progress selection)', () => {
    // 'discardMultiple' from createTestMetadata is a choice multiSelect { min: 2, max: 3 }.

    it('toggleMultiSelect accumulates in the draft, NOT in currentArgs', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('discardMultiple');

      await controller.toggleMultiSelect('cards', 1);
      await controller.toggleMultiSelect('cards', 2);

      // Draft holds the in-progress values...
      expect(controller.multiSelectDraft.value).toEqual({ selectionName: 'cards', values: [1, 2] });
      // ...but currentArgs stays undefined until confirm (MERC relies on this).
      expect(controller.currentArgs.value.cards).toBeUndefined();
      expect(controller.isReady.value).toBe(false);
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('toggling an already-selected value removes it from the draft', async () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: false,
      });
      await controller.start('discardMultiple');

      await controller.toggleMultiSelect('cards', 1);
      await controller.toggleMultiSelect('cards', 2);
      await controller.toggleMultiSelect('cards', 1); // remove 1

      expect(controller.multiSelectDraft.value).toEqual({ selectionName: 'cards', values: [2] });
    });

    it('respects max — additions beyond max are ignored', async () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: false,
      });
      await controller.start('discardMultiple'); // max: 3

      await controller.toggleMultiSelect('cards', 1);
      await controller.toggleMultiSelect('cards', 2);
      await controller.toggleMultiSelect('cards', 3);
      await controller.toggleMultiSelect('cards', 4); // exceeds max — ignored

      expect(controller.multiSelectDraft.value?.values).toEqual([1, 2, 3]);
    });

    it('isMultiSelectSelected reflects the draft', async () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: false,
      });
      await controller.start('discardMultiple');

      expect(controller.isMultiSelectSelected('cards', 1)).toBe(false);
      await controller.toggleMultiSelect('cards', 1);
      expect(controller.isMultiSelectSelected('cards', 1)).toBe(true);
      expect(controller.isMultiSelectSelected('cards', 2)).toBe(false);
    });

    it('confirmMultiSelect fills currentArgs with the full array and clears the draft', async () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: false,
      });
      await controller.start('discardMultiple');

      await controller.toggleMultiSelect('cards', 1);
      await controller.toggleMultiSelect('cards', 2);
      await controller.confirmMultiSelect();

      expect(controller.currentArgs.value.cards).toEqual([1, 2]);
      expect(controller.multiSelectDraft.value).toBeNull();
      expect(controller.isReady.value).toBe(true);
    });

    it('min === max auto-confirms: fills currentArgs and the action becomes ready', async () => {
      // Local action with an exact-count (min === max) multiSelect.
      actionMetadata.value = {
        ...createTestMetadata(),
        discardExactly2: {
          name: 'discardExactly2',
          prompt: 'Discard exactly 2',
          selections: [
            {
              name: 'cards',
              type: 'choice',
              prompt: 'Pick 2',
              multiSelect: { min: 2, max: 2 },
              choices: [
                { value: 1, display: 'Card 1' },
                { value: 2, display: 'Card 2' },
                { value: 3, display: 'Card 3' },
              ],
            },
          ],
        },
      };
      availableActions.value = [...(availableActions.value ?? []), 'discardExactly2'];

      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: false,
      });
      await controller.start('discardExactly2');

      await controller.toggleMultiSelect('cards', 1);
      // currentArgs still undefined after first pick
      expect(controller.currentArgs.value.cards).toBeUndefined();

      // Second pick reaches min === max → auto-confirm runs fill()
      await controller.toggleMultiSelect('cards', 3);

      expect(controller.currentArgs.value.cards).toEqual([1, 3]);
      expect(controller.multiSelectDraft.value).toBeNull();
      expect(controller.isReady.value).toBe(true);
    });

    it('min === max auto-confirm triggers auto-execute (fill → execute)', async () => {
      actionMetadata.value = {
        ...createTestMetadata(),
        discardExactly2: {
          name: 'discardExactly2',
          prompt: 'Discard exactly 2',
          selections: [
            {
              name: 'cards',
              type: 'choice',
              prompt: 'Pick 2',
              multiSelect: { min: 2, max: 2 },
              choices: [
                { value: 1, display: 'Card 1' },
                { value: 2, display: 'Card 2' },
              ],
            },
          ],
        },
      };
      availableActions.value = [...(availableActions.value ?? []), 'discardExactly2'];

      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: true,
      });
      await controller.start('discardExactly2');

      await controller.toggleMultiSelect('cards', 1);
      await controller.toggleMultiSelect('cards', 2);
      await nextTick();
      await nextTick();

      expect(sendAction).toHaveBeenCalledWith('discardExactly2', { cards: [1, 2] });
    });

    it('cancel() clears the in-progress draft', async () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: false,
      });
      await controller.start('discardMultiple');
      await controller.toggleMultiSelect('cards', 1);
      expect(controller.multiSelectDraft.value).not.toBeNull();

      controller.cancel();
      expect(controller.multiSelectDraft.value).toBeNull();
    });

    it('toggleMultiSelect on a non-multiSelect selection is a no-op (does not touch currentArgs)', async () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoExecute: false,
      });
      // 'playCard' has a single 'card' choice selection (not multiSelect).
      await controller.start('playCard');

      await controller.toggleMultiSelect('card', 1);

      expect(controller.multiSelectDraft.value).toBeNull();
      expect(controller.currentArgs.value.card).toBeUndefined();
    });
  });

  describe('allCurrentChoicesAnchored', () => {
    let anchoredActionMetadata: ReturnType<typeof ref<Record<string, ActionMetadata> | undefined>>;

    beforeEach(() => {
      anchoredActionMetadata = ref({
        ...createTestMetadata(),
        // All choices are board-anchored: every choice's clickable ref is a NOTATION
        // ref (a board cell the grid renders + makes clickable — e.g. Checkers squares).
        allAnchored: {
          name: 'allAnchored',
          selections: [{
            name: 'targets',
            type: 'choice' as const,
            choices: [
              { value: 1, display: 'Target A', refs: [{ ref: { notation: 'a5' }, role: 'target' as const }] },
              { value: 2, display: 'Target B', refs: [{ ref: { notation: 'c5' }, role: 'target' as const }] },
            ],
          }],
        },
        // Choices carry refs, but they are id-only HIGHLIGHT hints (Go Fish hand/card
        // refs) — NOT a reliable board click surface. Must NOT count as anchored.
        idHintAnchored: {
          name: 'idHintAnchored',
          selections: [{
            name: 'targets',
            type: 'choice' as const,
            choices: [
              { value: 1, display: 'Target A', refs: [{ ref: { id: 10 }, role: 'target' as const }] },
              { value: 2, display: 'Target B', refs: [{ ref: { id: 11 }, role: 'target' as const }] },
            ],
          }],
        },
        // Multi-element pick type
        selectMultiple: {
          name: 'selectMultiple',
          selections: [{
            name: 'pieces',
            type: 'elements' as const,
            validElements: [{ id: 1 }, { id: 2 }],
          }],
        },
      });
    });

    it('returns false when currentPick is null (no action in progress — Pitfall 4 guard)', () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn,
      });
      // No action started → currentPick === null
      expect(controller.currentPick.value).toBeNull();
      expect(controller.allCurrentChoicesAnchored.value).toBe(false);
    });

    it('returns true when pick.type is element and valid elements are available (D-02 board-anchored)', async () => {
      // D-02: footer suppressed when validElements is non-empty (board can fully drive pick).
      const fetchPickChoices = vi.fn(async () => ({ success: true, validElements: [{ id: 100 }, { id: 101 }] }));
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoFill: false, fetchPickChoices,
      });
      await controller.start('movePiece');
      await nextTick();

      expect(controller.currentPick.value?.type).toBe('element');
      expect(controller.allCurrentChoicesAnchored.value).toBe(true);
    });

    it('returns false when pick.type is element but no valid elements were fetched (vacuous case)', async () => {
      // D-02: without a fetch result, validElements is empty → footer must remain so player
      // isn't left with no interaction surface.
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoFill: false,
        // no fetchPickChoices → snapshot validElements stays empty
      });
      await controller.start('movePiece');
      await nextTick();

      expect(controller.currentPick.value?.type).toBe('element');
      expect(controller.allCurrentChoicesAnchored.value).toBe(false);
    });

    it('returns true when pick.type is elements and valid elements are available (D-02 board-anchored)', async () => {
      // D-02: footer suppressed when validElements is non-empty for multi-element picks too.
      const fetchPickChoices = vi.fn(async () => ({ success: true, validElements: [{ id: 1 }, { id: 2 }] }));
      const extendedAvailable = ref([...(availableActions.value ?? []), 'selectMultiple']);
      const controller = useActionController({
        sendAction,
        availableActions: extendedAvailable,
        actionMetadata: anchoredActionMetadata,
        isMyTurn,
        autoFill: false,
        fetchPickChoices,
      });
      await controller.start('selectMultiple');
      await nextTick();

      expect(controller.currentPick.value?.type).toBe('elements');
      expect(controller.allCurrentChoicesAnchored.value).toBe(true);
    });

    it('returns false when pick.type is elements but no valid elements were fetched (vacuous case)', async () => {
      // D-02: without a fetch result, validElements is empty → footer must remain.
      const extendedAvailable = ref([...(availableActions.value ?? []), 'selectMultiple']);
      const controller = useActionController({
        sendAction,
        availableActions: extendedAvailable,
        actionMetadata: anchoredActionMetadata,
        isMyTurn,
        autoFill: false,
        // no fetchPickChoices → snapshot validElements stays empty
      });
      await controller.start('selectMultiple');
      await nextTick();

      expect(controller.currentPick.value?.type).toBe('elements');
      expect(controller.allCurrentChoicesAnchored.value).toBe(false);
    });

    it('returns false when pick.type is choice and no choice has refs', async () => {
      const controller = useActionController({
        sendAction, availableActions, actionMetadata, isMyTurn, autoFill: false, autoExecute: false,
      });
      // 'playCard' has choice picks with no refs
      await controller.start('playCard');
      await nextTick();

      expect(controller.currentPick.value?.type).toBe('choice');
      expect(controller.allCurrentChoicesAnchored.value).toBe(false);
    });

    it('returns false when pick.type is choice even when every choice has a NOTATION ref (D-02: choice picks keep the footer)', async () => {
      // D-02 semantic change: notation refs no longer suppress the footer. Only a non-empty
      // validElements (element/elements picks) suppresses the panel. Choice picks always keep
      // the footer present because validElements is [] for choice types.
      const extendedAvailable = ref([...(availableActions.value ?? []), 'allAnchored']);
      const controller = useActionController({
        sendAction,
        availableActions: extendedAvailable,
        actionMetadata: anchoredActionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });
      await controller.start('allAnchored');
      await nextTick();

      expect(controller.currentPick.value?.type).toBe('choice');
      expect(controller.allCurrentChoicesAnchored.value).toBe(false);
    });

    it('returns false when choices carry only id refs (highlight hints, not board cells — Go Fish ask)', async () => {
      const extendedAvailable = ref([...(availableActions.value ?? []), 'idHintAnchored']);
      const controller = useActionController({
        sendAction,
        availableActions: extendedAvailable,
        actionMetadata: anchoredActionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });
      await controller.start('idHintAnchored');
      await nextTick();

      expect(controller.currentPick.value?.type).toBe('choice');
      // id-only refs are NOT a reliable board click surface → footer must remain.
      expect(controller.allCurrentChoicesAnchored.value).toBe(false);
    });

    it('two-step: element pick anchored, destination choice pick NOT anchored under D-02 (Checkers move)', async () => {
      // Two-step action: step 1 element pick (piece) — fetches validElements → anchored.
      // Step 2 choice pick (destination) — validElements is [] for choice types → NOT anchored (D-02).
      // Both steps react correctly when async-fetched results arrive.
      const fetchPickChoices = vi.fn(async (_action: string, selectionName: string) => {
        if (selectionName === 'piece') {
          return { success: true, validElements: [{ id: 77 }, { id: 78 }] };
        }
        // destination: notation-anchored choices (like Checkers move destinations)
        return {
          success: true,
          choices: [
            { value: { pieceId: 77, toNotation: 'a5' }, display: 'a5', refs: [{ ref: { notation: 'a5' }, role: 'target' as const }] },
            { value: { pieceId: 77, toNotation: 'c5' }, display: 'c5', refs: [{ ref: { notation: 'c5' }, role: 'target' as const }] },
          ],
        };
      });

      const twoStepMeta: Record<string, ActionMetadata> = {
        twoStepMove: {
          name: 'twoStepMove',
          prompt: 'Move',
          selections: [
            { name: 'piece', type: 'element' as const, prompt: 'Pick piece' },
            { name: 'destination', type: 'choice' as const, prompt: 'Pick destination', filterBy: { key: 'pieceId', selectionName: 'piece' } },
          ],
        },
      };

      const extendedAvailable = ref([...(availableActions.value ?? []), 'twoStepMove']);
      const controller = useActionController({
        sendAction,
        availableActions: extendedAvailable,
        actionMetadata: ref({ ...createTestMetadata(), ...twoStepMeta }),
        isMyTurn,
        autoFill: false,
        autoExecute: false,
        fetchPickChoices,
      });

      await controller.start('twoStepMove');
      await nextTick();
      // Step 1 is an element pick with fetchPickChoices returning validElements → anchored (D-02).
      expect(controller.currentPick.value?.name).toBe('piece');
      expect(controller.allCurrentChoicesAnchored.value).toBe(true);

      // Fill the piece → advances to the destination choice pick and fetches its choices.
      await controller.fill('piece', 77);
      await nextTick();

      expect(controller.currentPick.value?.name).toBe('destination');
      // The reactive currentChoices must reflect the freshly-fetched destination choices...
      expect(controller.currentChoices.value).toHaveLength(2);
      // D-02: choice picks keep the footer regardless of ref type (validElements is [] for choice).
      expect(controller.allCurrentChoicesAnchored.value).toBe(false);
    });
  });

  // ============================================================
  // Tutorial auto-fill suppression (Plan 104-03, TUT-02)
  // ============================================================
  describe('tutorial suppressAutoFill', () => {
    /**
     * Case A: Default path unchanged — no tutorial step active.
     * A single enabled choice auto-fills as usual.
     */
    it('Case A (default): single enabled choice auto-fills when no tutorial step is set', async () => {
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

      // Card auto-fills because there is only one choice and no tutorial suppression
      expect(controller.currentArgs.value.card).toBe(42);
      expect(controller.isReady.value).toBe(true);
    });

    /**
     * Case B: Tutorial step-wide suppression.
     * `suppressAutoFill: true` (no `suppressAutoFillFor`) prevents auto-fill
     * for the selection, preserving the teaching click.
     */
    it('Case B (suppressed): suppressAutoFill: true keeps the taught selection unfilled', async () => {
      const tutorialStep = ref<TutorialStepView | undefined>({
        stepId: 'teach-click',
        suppressAutoFill: true,
      });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
        tutorialStep,
      });

      await controller.start('forcedPlay');
      await nextTick();

      // The global autoFill is on, but tutorial suppresses the taught selection.
      // The controller must await the learner's click rather than auto-resolving.
      expect(controller.currentArgs.value.card).toBeUndefined();
      expect(controller.currentPick.value?.name).toBe('card');
    });

    /**
     * Case C: Per-selection (scoped) suppression.
     * `suppressAutoFillFor: 'from'` suppresses only the first selection;
     * the second selection (not taught) still auto-fills after the learner
     * fills the first one manually.
     */
    it('Case C (scoped): suppressAutoFillFor scopes suppression to the taught selection; other selections auto-fill', async () => {
      const tutorialStep = ref<TutorialStepView | undefined>({
        stepId: 'teach-piece-select',
        suppressAutoFill: true,
        suppressAutoFillFor: 'from',
      });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: true,
        autoExecute: false,
        tutorialStep,
      });

      // Only 'from' is suppressed; 'to' should auto-fill after 'from' is provided.
      await controller.start('twoStepSingle');
      await nextTick();

      // Taught selection ('from') must NOT be auto-filled
      expect(controller.currentArgs.value.from).toBeUndefined();
      expect(controller.currentPick.value?.name).toBe('from');

      // Learner fills the taught selection manually
      await controller.fill('from', 'c3');
      await nextTick();

      // Non-taught selection ('to') auto-fills because it is not suppressed
      expect(controller.currentArgs.value.to).toBe('d4');
    });

    /**
     * Case D (R-07): Starting a tutorial RESETS a stale in-progress action.
     *
     * A tutorial's setup() hook may replace the board (e.g. checkers
     * resetToTutorialPreset deletes the standard pieces and creates preset
     * pieces). Any action that was already in progress — including one
     * auto-started against the PRE-tutorial position — then holds a snapshot
     * whose picks reference removed elements. If it survives, clicking the new
     * preset piece matches none of the stale choices and the action can never
     * advance → the tutorial hangs on the very first move.
     *
     * The controller watches tutorialStep: when it transitions inactive→active
     * it cancels the stale (non-server-pending) in-progress action so the UI
     * re-starts it fresh against the new board.
     */
    it('Case D (R-07): turning the tutorial on resets a stale in-progress action', async () => {
      const tutorialStep = ref<TutorialStepView | undefined>(undefined);

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
        tutorialStep,
      });

      // An action is in progress (auto-started against the pre-tutorial board).
      await controller.start('movePiece');
      await nextTick();
      expect(controller.currentAction.value).toBe('movePiece');

      // Tutorial turns ON (setup replaced the board out from under the action).
      tutorialStep.value = { stepId: 'execute-capture', suppressAutoFill: true };
      await nextTick();

      // The stale action is cleared so the UI can re-start fresh against the
      // new board. Without the fix it stays 'movePiece' with dead choices → hang.
      expect(controller.currentAction.value).toBe(null);
      expect(controller.currentArgs.value).toEqual({});
    });

    /**
     * Case E (R-07 guard): a step-to-step advance must NOT reset the action.
     * Only the inactive→active transition resets; defined→defined (e.g.
     * execute-capture → multi-jump-continue) leaves a live action intact, so the
     * R-04 suppress-lift continuation path is preserved.
     */
    it('Case E (R-07 guard): advancing between tutorial steps does not reset the action', async () => {
      const tutorialStep = ref<TutorialStepView | undefined>({
        stepId: 'execute-capture',
        suppressAutoFill: true,
      });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
        tutorialStep,
      });

      await controller.start('movePiece');
      await nextTick();
      expect(controller.currentAction.value).toBe('movePiece');

      // Step advances (both defined) — must not tear down the in-progress action.
      tutorialStep.value = { stepId: 'multi-jump-continue' };
      await nextTick();

      expect(controller.currentAction.value).toBe('movePiece');
    });
  });

});
