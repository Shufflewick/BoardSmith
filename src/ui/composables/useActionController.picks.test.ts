/**
 * Test suite for useActionController pick-related functionality
 *
 * Tests pick handling including:
 * - Repeating picks
 * - Dependent picks (dependsOn)
 * - Filtered picks (filterBy)
 * - Text and number inputs
 * - Element picks
 * - MultiSelect validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  useActionController,
  type ActionMetadata,
  type PickChoicesResult,
} from './useActionController.js';
import { createMockSendAction, createTestMetadata } from './useActionController.helpers.js';
import type { TutorialStepView } from '../../engine/tutorial/types.js';

describe('useActionController picks', () => {
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

  describe('repeating selections', () => {
    it('should call pickStep for repeating selections', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        done: false,
        nextChoices: [{ value: 2, display: 'Two' }],
      });

      const repeatMeta: Record<string, ActionMetadata> = {
        repeatAction: {
          name: 'repeatAction',
          prompt: 'Select multiple',
          selections: [
            {
              name: 'items',
              type: 'choice',
              prompt: 'Select items',
              repeat: { hasOnEach: false },
              choices: [
                { value: 1, display: 'One' },
                { value: 2, display: 'Two' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...repeatMeta };
      availableActions.value = [...(availableActions.value ?? []), 'repeatAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        playerSeat: ref(0),
        pickStep,
      });

      await controller.start('repeatAction');
      await controller.fill('items', 1);

      expect(pickStep).toHaveBeenCalledWith(0, 'items', 1, 'repeatAction', {});
    });

    it('should accumulate values in repeatingState', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        done: false,
        nextChoices: [{ value: 2, display: 'Two' }, { value: 3, display: 'Three' }],
      });

      const repeatMeta: Record<string, ActionMetadata> = {
        repeatAction: {
          name: 'repeatAction',
          prompt: 'Select multiple',
          selections: [
            {
              name: 'items',
              type: 'choice',
              prompt: 'Select items',
              repeat: { hasOnEach: false },
              choices: [{ value: 1, display: 'One' }, { value: 2, display: 'Two' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...repeatMeta };
      availableActions.value = [...(availableActions.value ?? []), 'repeatAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        pickStep,
      });

      await controller.start('repeatAction');
      await controller.fill('items', 1);

      // accumulated now stores {value, display} objects
      expect(controller.repeatingState.value?.accumulated).toEqual([{ value: 1, display: 'One' }]);

      await controller.fill('items', 2);
      expect(controller.repeatingState.value?.accumulated).toEqual([
        { value: 1, display: 'One' },
        { value: 2, display: 'Two' },
      ]);
    });

    it('should clear action when actionComplete is true', async () => {
      const pickStep = vi.fn()
        .mockResolvedValueOnce({ success: true, done: false })
        .mockResolvedValueOnce({ success: true, actionComplete: true });

      const repeatMeta: Record<string, ActionMetadata> = {
        repeatAction: {
          name: 'repeatAction',
          prompt: 'Select until done',
          selections: [
            {
              name: 'items',
              type: 'choice',
              prompt: 'Select',
              repeat: { hasOnEach: false, terminator: 'done' },
              choices: [{ value: 1, display: 'One' }, { value: 'done', display: 'Done' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...repeatMeta };
      availableActions.value = [...(availableActions.value ?? []), 'repeatAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        pickStep,
      });

      await controller.start('repeatAction');
      await controller.fill('items', 1);

      expect(controller.currentAction.value).toBe('repeatAction');

      await controller.fill('items', 'done');

      // Action should be cleared
      expect(controller.currentAction.value).toBe(null);
      expect(controller.repeatingState.value).toBe(null);
    });

    it('should update currentChoices from nextChoices', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        done: false,
        nextChoices: [{ value: 'new1', display: 'New 1' }, { value: 'new2', display: 'New 2' }],
      });

      const repeatMeta: Record<string, ActionMetadata> = {
        repeatAction: {
          name: 'repeatAction',
          prompt: 'Select',
          selections: [
            {
              name: 'items',
              type: 'choice',
              prompt: 'Select',
              repeat: { hasOnEach: false },
              choices: [{ value: 'old', display: 'Old' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...repeatMeta };
      availableActions.value = [...(availableActions.value ?? []), 'repeatAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        pickStep,
      });

      await controller.start('repeatAction');
      await controller.fill('items', 'old');

      expect(controller.repeatingState.value?.currentChoices).toEqual([
        { value: 'new1', display: 'New 1' },
        { value: 'new2', display: 'New 2' },
      ]);
    });

    it('should handle pickStep errors', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: false,
        error: 'Invalid selection',
      });

      const repeatMeta: Record<string, ActionMetadata> = {
        repeatAction: {
          name: 'repeatAction',
          prompt: 'Select',
          selections: [
            {
              name: 'items',
              type: 'choice',
              prompt: 'Select',
              repeat: { hasOnEach: false },
              choices: [{ value: 1, display: 'One' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...repeatMeta };
      availableActions.value = [...(availableActions.value ?? []), 'repeatAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        pickStep,
      });

      await controller.start('repeatAction');
      const result = await controller.fill('items', 1);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid selection');
      expect(controller.lastError.value).toBe('Invalid selection');
    });

    it('should clear accumulated for hasOnEach selections', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        done: false,
      });

      const repeatMeta: Record<string, ActionMetadata> = {
        repeatAction: {
          name: 'repeatAction',
          prompt: 'Process each',
          selections: [
            {
              name: 'items',
              type: 'choice',
              prompt: 'Select',
              repeat: { hasOnEach: true }, // Items processed immediately
              choices: [{ value: 1, display: 'One' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...repeatMeta };
      availableActions.value = [...(availableActions.value ?? []), 'repeatAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        pickStep,
      });

      await controller.start('repeatAction');
      await controller.fill('items', 1);

      // With hasOnEach, accumulated should be cleared after processing
      expect(controller.repeatingState.value?.accumulated).toEqual([]);
    });
  });

  describe('dependsOn selections', () => {
    it('should return empty choices when dependent selection not yet made', () => {
      const dependsMeta: Record<string, ActionMetadata> = {
        dependsAction: {
          name: 'dependsAction',
          prompt: 'Select with depends',
          selections: [
            {
              name: 'category',
              type: 'choice',
              prompt: 'Select category',
              choices: [
                { value: 'fruits', display: 'Fruits' },
                { value: 'veggies', display: 'Vegetables' },
              ],
            },
            {
              name: 'item',
              type: 'choice',
              prompt: 'Select item',
              dependsOn: 'category',
              choicesByDependentValue: {
                fruits: [
                  { value: 'apple', display: 'Apple' },
                  { value: 'banana', display: 'Banana' },
                ],
                veggies: [
                  { value: 'carrot', display: 'Carrot' },
                  { value: 'broccoli', display: 'Broccoli' },
                ],
              },
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...dependsMeta };
      availableActions.value = [...(availableActions.value ?? []), 'dependsAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      const itemSelection = dependsMeta.dependsAction.selections[1];
      const choices = controller.getChoices(itemSelection);

      // No category selected yet, so no choices
      expect(choices).toEqual([]);
    });

    it('should return correct choices based on dependent value', async () => {
      const dependsMeta: Record<string, ActionMetadata> = {
        dependsAction: {
          name: 'dependsAction',
          prompt: 'Select with depends',
          selections: [
            {
              name: 'category',
              type: 'choice',
              prompt: 'Select category',
              choices: [
                { value: 'fruits', display: 'Fruits' },
                { value: 'veggies', display: 'Vegetables' },
              ],
            },
            {
              name: 'item',
              type: 'choice',
              prompt: 'Select item',
              dependsOn: 'category',
              choicesByDependentValue: {
                fruits: [
                  { value: 'apple', display: 'Apple' },
                  { value: 'banana', display: 'Banana' },
                ],
                veggies: [
                  { value: 'carrot', display: 'Carrot' },
                  { value: 'broccoli', display: 'Broccoli' },
                ],
              },
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...dependsMeta };
      availableActions.value = [...(availableActions.value ?? []), 'dependsAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });

      await controller.start('dependsAction');
      await controller.fill('category', 'fruits');

      const itemSelection = dependsMeta.dependsAction.selections[1];
      const choices = controller.getChoices(itemSelection);

      expect(choices).toHaveLength(2);
      expect(choices[0].value).toBe('apple');
      expect(choices[1].value).toBe('banana');
    });

    it('should update choices when dependent value changes', async () => {
      const dependsMeta: Record<string, ActionMetadata> = {
        dependsAction: {
          name: 'dependsAction',
          prompt: 'Select with depends',
          selections: [
            {
              name: 'category',
              type: 'choice',
              prompt: 'Select category',
              choices: [
                { value: 'fruits', display: 'Fruits' },
                { value: 'veggies', display: 'Vegetables' },
              ],
            },
            {
              name: 'item',
              type: 'choice',
              prompt: 'Select item',
              dependsOn: 'category',
              choicesByDependentValue: {
                fruits: [{ value: 'apple', display: 'Apple' }],
                veggies: [{ value: 'carrot', display: 'Carrot' }],
              },
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...dependsMeta };
      availableActions.value = [...(availableActions.value ?? []), 'dependsAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });

      await controller.start('dependsAction');
      await controller.fill('category', 'fruits');

      const itemSelection = dependsMeta.dependsAction.selections[1];
      let choices = controller.getChoices(itemSelection);
      expect(choices[0].value).toBe('apple');

      // Change category
      controller.clear('category');
      await controller.fill('category', 'veggies');

      choices = controller.getChoices(itemSelection);
      expect(choices[0].value).toBe('carrot');
    });
  });

  describe('filterBy selections', () => {
    it('should filter choices based on previous selection value', async () => {
      const filterMeta: Record<string, ActionMetadata> = {
        filterAction: {
          name: 'filterAction',
          prompt: 'Select with filter',
          selections: [
            {
              name: 'color',
              type: 'choice',
              prompt: 'Select color',
              choices: [
                { value: 'red', display: 'Red' },
                { value: 'blue', display: 'Blue' },
              ],
            },
            {
              name: 'item',
              type: 'choice',
              prompt: 'Select item',
              filterBy: { key: 'color', selectionName: 'color' },
              choices: [
                { value: { id: 1, color: 'red' }, display: 'Red Apple' },
                { value: { id: 2, color: 'red' }, display: 'Red Cherry' },
                { value: { id: 3, color: 'blue' }, display: 'Blueberry' },
                { value: { id: 4, color: 'blue' }, display: 'Blue Plum' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...filterMeta };
      availableActions.value = [...(availableActions.value ?? []), 'filterAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: false,
      });

      await controller.start('filterAction');
      await controller.fill('color', 'red');

      const itemSelection = filterMeta.filterAction.selections[1];
      const choices = controller.getChoices(itemSelection);

      expect(choices).toHaveLength(2);
      expect(choices.every(c => (c.value as any).color === 'red')).toBe(true);
    });

    it('should return all choices when filter selection not made', () => {
      const filterMeta: Record<string, ActionMetadata> = {
        filterAction: {
          name: 'filterAction',
          prompt: 'Select with filter',
          selections: [
            {
              name: 'color',
              type: 'choice',
              prompt: 'Select color',
              choices: [{ value: 'red', display: 'Red' }],
            },
            {
              name: 'item',
              type: 'choice',
              prompt: 'Select item',
              filterBy: { key: 'color', selectionName: 'color' },
              choices: [
                { value: { id: 1, color: 'red' }, display: 'Red' },
                { value: { id: 2, color: 'blue' }, display: 'Blue' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...filterMeta };
      availableActions.value = [...(availableActions.value ?? []), 'filterAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      const itemSelection = filterMeta.filterAction.selections[1];
      const choices = controller.getChoices(itemSelection);

      // No color selected, returns all (filter not applied)
      expect(choices).toHaveLength(2);
    });
  });

  describe('text and number inputs', () => {
    it('should accept text input for text selection type', async () => {
      const textMeta: Record<string, ActionMetadata> = {
        nameAction: {
          name: 'nameAction',
          prompt: 'Enter name',
          selections: [
            {
              name: 'playerName',
              type: 'text',
              prompt: 'Enter your name',
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...textMeta };
      availableActions.value = [...(availableActions.value ?? []), 'nameAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('nameAction');
      const result = await controller.fill('playerName', 'Alice');

      expect(result.valid).toBe(true);
      expect(controller.currentArgs.value.playerName).toBe('Alice');
    });

    it('should accept number input for number selection type', async () => {
      const numberMeta: Record<string, ActionMetadata> = {
        bidAction: {
          name: 'bidAction',
          prompt: 'Place bid',
          selections: [
            {
              name: 'amount',
              type: 'number',
              prompt: 'Enter bid amount',
              min: 1,
              max: 100,
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...numberMeta };
      availableActions.value = [...(availableActions.value ?? []), 'bidAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('bidAction');
      const result = await controller.fill('amount', 50);

      expect(result.valid).toBe(true);
      expect(controller.currentArgs.value.amount).toBe(50);
    });

    it('should execute text action successfully', async () => {
      const textMeta: Record<string, ActionMetadata> = {
        nameAction: {
          name: 'nameAction',
          prompt: 'Enter name',
          selections: [
            { name: 'playerName', type: 'text', prompt: 'Enter name' },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...textMeta };
      availableActions.value = [...(availableActions.value ?? []), 'nameAction'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const result = await controller.execute('nameAction', { playerName: 'Bob' });

      expect(result.success).toBe(true);
      expect(sendAction).toHaveBeenCalledWith('nameAction', { playerName: 'Bob' });
    });
  });

  describe('element selections', () => {
    it('should accept valid element ID', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('movePiece');
      const result = await controller.fill('piece', 100);

      expect(result.valid).toBe(true);
      expect(controller.currentArgs.value.piece).toBe(100);
    });

    it('should reject invalid element ID', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('movePiece');
      const result = await controller.fill('piece', 999); // Not in validElements

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid selection');
    });

    it('should convert validElements to choices format', () => {
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
      expect(choices[1]).toEqual({ value: 101, display: 'Pawn B' });
      expect(choices[2]).toEqual({ value: 102, display: 'Knight' });
    });
  });

  describe('onSelect routing (hasOnSelect)', () => {
    it('should route fill through pickStep when selection has hasOnSelect', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        actionComplete: false,
      });

      const onSelectMeta: Record<string, ActionMetadata> = {
        moveWithCallback: {
          name: 'moveWithCallback',
          prompt: 'Move a piece',
          selections: [
            {
              name: 'piece',
              type: 'choice',
              prompt: 'Select a piece',
              hasOnSelect: true,
              choices: [
                { value: 1, display: 'Pawn' },
                { value: 2, display: 'Knight' },
              ],
            },
            {
              name: 'destination',
              type: 'choice',
              prompt: 'Select destination',
              choices: [
                { value: 'a1', display: 'A1' },
                { value: 'b2', display: 'B2' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...onSelectMeta };
      availableActions.value = [...(availableActions.value ?? []), 'moveWithCallback'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        playerSeat: ref(1),
        pickStep,
      });

      await controller.start('moveWithCallback');
      await controller.fill('piece', 1);

      expect(pickStep).toHaveBeenCalledWith(1, 'piece', 1, 'moveWithCallback', {});
    });

    it('should clear state when pickStep returns actionComplete', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        actionComplete: true,
      });

      const onSelectMeta: Record<string, ActionMetadata> = {
        singleStepOnSelect: {
          name: 'singleStepOnSelect',
          prompt: 'Quick action',
          selections: [
            {
              name: 'target',
              type: 'choice',
              prompt: 'Pick target',
              hasOnSelect: true,
              choices: [
                { value: 'a', display: 'Alpha' },
                { value: 'b', display: 'Beta' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...onSelectMeta };
      availableActions.value = [...(availableActions.value ?? []), 'singleStepOnSelect'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        playerSeat: ref(1),
        pickStep,
      });

      await controller.start('singleStepOnSelect');
      const result = await controller.fill('target', 'a');

      expect(result.valid).toBe(true);
      expect(controller.currentAction.value).toBeNull();
    });

    it('should route subsequent selections through pickStep when pendingOnServer', async () => {
      let callCount = 0;
      const pickStep = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { success: true, actionComplete: false };
        }
        return { success: true, actionComplete: true };
      });

      const onSelectMeta: Record<string, ActionMetadata> = {
        twoStepOnSelect: {
          name: 'twoStepOnSelect',
          prompt: 'Two steps',
          selections: [
            {
              name: 'first',
              type: 'choice',
              prompt: 'First pick',
              hasOnSelect: true,
              choices: [
                { value: 1, display: 'One' },
                { value: 2, display: 'Two' },
              ],
            },
            {
              name: 'second',
              type: 'choice',
              prompt: 'Second pick',
              choices: [
                { value: 'x', display: 'X' },
                { value: 'y', display: 'Y' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...onSelectMeta };
      availableActions.value = [...(availableActions.value ?? []), 'twoStepOnSelect'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        playerSeat: ref(1),
        pickStep,
      });

      await controller.start('twoStepOnSelect');
      await controller.fill('first', 1);

      // First selection routed via hasOnSelect
      expect(pickStep).toHaveBeenCalledTimes(1);

      // Second selection should also route via pickStep because pendingOnServer is true
      await controller.fill('second', 'x');
      expect(pickStep).toHaveBeenCalledTimes(2);
      expect(pickStep).toHaveBeenLastCalledWith(1, 'second', 'x', 'twoStepOnSelect', { first: 1 });
    });

    it('should not auto-execute when pendingOnServer is true', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        actionComplete: false,
      });

      const onSelectMeta: Record<string, ActionMetadata> = {
        autoExecTest: {
          name: 'autoExecTest',
          prompt: 'Test auto-exec guard',
          selections: [
            {
              name: 'step1',
              type: 'choice',
              prompt: 'First',
              hasOnSelect: true,
              choices: [
                { value: 1, display: 'One' },
                { value: 2, display: 'Two' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...onSelectMeta };
      availableActions.value = [...(availableActions.value ?? []), 'autoExecTest'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: true,
        playerSeat: ref(1),
        pickStep,
      });

      await controller.start('autoExecTest');
      await controller.fill('step1', 1);

      // sendAction should NOT have been called — server handles execution
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('should call cancelPendingAction on cancel when pendingOnServer', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        actionComplete: false,
      });
      const cancelPendingAction = vi.fn().mockResolvedValue(undefined);

      const onSelectMeta: Record<string, ActionMetadata> = {
        cancelTest: {
          name: 'cancelTest',
          prompt: 'Cancel test',
          selections: [
            {
              name: 'step1',
              type: 'choice',
              prompt: 'First',
              hasOnSelect: true,
              choices: [
                { value: 1, display: 'One' },
                { value: 2, display: 'Two' },
              ],
            },
            {
              name: 'step2',
              type: 'choice',
              prompt: 'Second',
              choices: [
                { value: 'a', display: 'A' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...onSelectMeta };
      availableActions.value = [...(availableActions.value ?? []), 'cancelTest'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        playerSeat: ref(1),
        pickStep,
        cancelPendingAction,
      });

      await controller.start('cancelTest');
      await controller.fill('step1', 1);

      // Now cancel — should call cancelPendingAction
      controller.cancel();
      expect(cancelPendingAction).toHaveBeenCalledWith(1);
      expect(controller.currentAction.value).toBeNull();
    });

    it('should not call cancelPendingAction on cancel when NOT pendingOnServer', async () => {
      const cancelPendingAction = vi.fn().mockResolvedValue(undefined);

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        cancelPendingAction,
      });

      await controller.start('playCard');
      controller.cancel();

      expect(cancelPendingAction).not.toHaveBeenCalled();
    });
  });

  describe('followUp auto-fill submission (R-04)', () => {
    // Regression tests for the multi-jump hang bug:
    // When a followUp action's remaining selections are ALL auto-filled to a single legal
    // choice, the auto-execute watcher is gated by pendingOnServer = true and never fires.
    // The fix: after fetchAndAutoFill completes with isReady = true, route the first
    // auto-filled selection through handleOnSelectFill to submit via the server's
    // selection-step path.
    //
    // IMPORTANT: These tests use pickStep (selection-step path), NOT sendAction with full
    // args. A full-args doAction would bypass the bug entirely — this path is what the live
    // checkers UI exercises when the only legal continuation jump is auto-filled.

    it('should submit continuation through pickStep when all followUp selections auto-fill to single choice', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        actionComplete: true,
      });

      // The followUp action: piece is pre-filled by server, destination has exactly ONE
      // legal choice (auto-fills) — mirrors the checkers forced multi-jump scenario.
      const multiJumpMeta: Record<string, ActionMetadata> = {
        jump: {
          name: 'jump',
          prompt: 'Continue jump',
          selections: [
            {
              name: 'piece',
              type: 'choice',
              prompt: 'Jumping piece (pre-filled)',
              choices: [{ value: 5, display: 'Piece 5' }],
            },
            {
              name: 'destination',
              type: 'choice',
              prompt: 'Jump destination (one legal choice)',
              choices: [{ value: 'd4', display: 'Square d4' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...multiJumpMeta };
      availableActions.value = [...(availableActions.value ?? []), 'jump'];

      // Initial action (the first jump) returns a followUp with piece pre-filled.
      sendAction.mockResolvedValueOnce({
        success: true,
        followUp: {
          action: 'jump',
          args: { piece: 5 },
          display: { piece: 'Piece 5' },
        },
      });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: true,
        autoFill: true,
        playerSeat: ref(0),
        pickStep,
      });

      // Execute the first jump — triggers the followUp
      await controller.execute('endTurn');
      // Allow the async followUp IIFE (nextTick + startFollowUp + handleOnSelectFill) to settle
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      // pickStep must have been called with the auto-filled destination.
      // This is the server-side submission that was missing (the hang).
      expect(pickStep).toHaveBeenCalled();
      const call = pickStep.mock.calls[0];
      expect(call[0]).toBe(0);           // player seat
      expect(call[1]).toBe('destination'); // selection name
      expect(call[2]).toBe('d4');          // auto-filled value
      expect(call[3]).toBe('jump');        // action name
      // initialArgs must contain both the pre-filled piece AND the auto-filled destination
      // (buildServerArgs reflects collectedPicks at time of call).
      expect(call[4]).toMatchObject({ piece: 5, destination: 'd4' });

      // The action must be complete — not hanging.
      expect(controller.currentAction.value).toBeNull();
      expect(controller.pendingOnServer.value).toBe(false);

      // sendAction was called exactly once (the initial action, NOT the followUp).
      // The followUp is handled via pickStep (selection-step path), never via sendAction.
      expect(sendAction).toHaveBeenCalledTimes(1);
    });

    it('should NOT submit via pickStep when followUp has multiple destination choices (user must choose)', async () => {
      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        actionComplete: false,
      });

      const multiChoiceMeta: Record<string, ActionMetadata> = {
        jump: {
          name: 'jump',
          prompt: 'Continue jump',
          selections: [
            {
              name: 'piece',
              type: 'choice',
              prompt: 'Jumping piece (pre-filled)',
              choices: [{ value: 5, display: 'Piece 5' }],
            },
            {
              name: 'destination',
              type: 'choice',
              prompt: 'Jump destination (two choices — user picks)',
              choices: [
                { value: 'd4', display: 'Square d4' },
                { value: 'f4', display: 'Square f4' },
              ],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...multiChoiceMeta };
      availableActions.value = [...(availableActions.value ?? []), 'jump'];

      sendAction.mockResolvedValueOnce({
        success: true,
        followUp: {
          action: 'jump',
          args: { piece: 5 },
          display: { piece: 'Piece 5' },
        },
      });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: true,
        autoFill: true,
        playerSeat: ref(0),
        pickStep,
      });

      await controller.execute('endTurn');
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      // pickStep must NOT have been called — user must choose among the two destinations.
      expect(pickStep).not.toHaveBeenCalled();
      // Action is still in progress, waiting for user input.
      expect(controller.currentAction.value).toBe('jump');
    });

    it('should submit continuation through pickStep when tutorialStep suppressAutoFill lifts (R-04 timing race)', async () => {
      // Regression test for the checkers tutorial multi-jump hang.
      //
      // The race: when execute() returns a followUp, startFollowUp runs via nextTick.
      // At that moment the game_state broadcast (which advances tutorialStep) has NOT
      // yet arrived. tutorialStep is still the completing step (execute-capture,
      // suppressAutoFill:true) → auto-fill is suppressed → isReady stays false →
      // the existing R-04 guard misses → hang.
      //
      // After the broadcast, tutorialStep updates to multi-jump-continue (no
      // suppressAutoFill). The fix watches tutorialStep and retries auto-fill +
      // R-04 submission when suppressAutoFill changes true → false.
      //
      // This test FAILS without the tutorialStep watcher (pickStep never called
      // after broadcast) and PASSES with it.

      const tutorialStep = ref<TutorialStepView | undefined>({
        stepId: 'execute-capture',
        suppressAutoFill: true,
        content: [],
      });

      const pickStep = vi.fn().mockResolvedValue({
        success: true,
        actionComplete: true,
      });

      // The followUp action: piece pre-filled, destination has exactly ONE legal
      // choice (forces auto-fill) — mirrors the checkers forced multi-jump.
      const multiJumpMeta: Record<string, ActionMetadata> = {
        jump: {
          name: 'jump',
          prompt: 'Continue jump',
          selections: [
            {
              name: 'piece',
              type: 'choice',
              prompt: 'Jumping piece (pre-filled)',
              choices: [{ value: 5, display: 'Piece 5' }],
            },
            {
              name: 'destination',
              type: 'choice',
              prompt: 'Jump destination (one legal choice)',
              choices: [{ value: 'd4', display: 'Square d4' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...multiJumpMeta };
      availableActions.value = [...(availableActions.value ?? []), 'jump'];

      // First action returns a followUp with piece pre-filled (the state broadcast
      // that advances tutorialStep will arrive separately — simulated below).
      sendAction.mockResolvedValueOnce({
        success: true,
        followUp: {
          action: 'jump',
          args: { piece: 5 },
          display: { piece: 'Piece 5' },
        },
      });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: true,
        autoFill: true,
        playerSeat: ref(0),
        pickStep,
        tutorialStep,
      });

      // Execute first action → followUp queued via nextTick.
      await controller.execute('endTurn');
      // Settle nextTick + startFollowUp (including fetchAndAutoFill which is sync
      // here — no fetchPickChoices — so one tick is enough).
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      // ASSERT: auto-fill was suppressed by the stale execute-capture step.
      // pickStep must NOT have been called yet — this is the hang state.
      expect(pickStep).not.toHaveBeenCalled();
      expect(controller.currentAction.value).toBe('jump');
      expect(controller.pendingOnServer.value).toBe(true);

      // Simulate game_state broadcast arriving: tutorial advances to multi-jump-continue.
      // In production this comes from the WebSocket channel after the action op completes.
      tutorialStep.value = {
        stepId: 'multi-jump-continue',
        // suppressAutoFill: not set (= undefined/false) — continuation is forced
        content: [],
      };

      // Allow the tutorialStep watcher to fire + handleOnSelectFill to complete.
      await nextTick();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 10));

      // ASSERT: pickStep was called with the auto-filled destination.
      expect(pickStep).toHaveBeenCalled();
      const call = pickStep.mock.calls[0];
      expect(call[1]).toBe('destination'); // selection name
      expect(call[2]).toBe('d4');          // auto-filled value
      expect(call[3]).toBe('jump');        // action name

      // Action must be complete — no longer hanging.
      expect(controller.currentAction.value).toBeNull();
      expect(controller.pendingOnServer.value).toBe(false);

      // sendAction called once only (the initial action, not the followUp).
      expect(sendAction).toHaveBeenCalledTimes(1);
    });

    it('should NOT change behavior when followUp has no pickStep (sendAction path)', async () => {
      // A followUp without pickStep uses the sendAction path (existing, unmodified behavior).
      // This test ensures the R-04 fix does not break that path.
      const noPickStepMeta: Record<string, ActionMetadata> = {
        collect: {
          name: 'collect',
          prompt: 'Collect item',
          selections: [
            {
              name: 'item',
              type: 'choice',
              prompt: 'Select item (one choice, optional)',
              optional: true,
              choices: [{ value: 'coin', display: 'Coin' }],
            },
          ],
        },
      };

      actionMetadata.value = { ...createTestMetadata(), ...noPickStepMeta };
      availableActions.value = [...(availableActions.value ?? []), 'collect'];

      sendAction.mockResolvedValueOnce({
        success: true,
        followUp: {
          action: 'collect',
          args: { sector: 3 },
          display: { sector: 'Sector 3' },
        },
      });
      // Second sendAction call for the followUp action itself (after skip)
      sendAction.mockResolvedValueOnce({ success: true });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: true,
        autoFill: false, // autoFill off → destination won't be auto-filled
        playerSeat: ref(0),
        // NO pickStep provided
      });

      await controller.execute('endTurn');
      await new Promise(resolve => setTimeout(resolve, 10));
      await nextTick();

      // followUp started, action is waiting for user to choose or skip
      expect(controller.currentAction.value).toBe('collect');

      // Skip the optional selection — triggers executeCurrentAction (sendAction path)
      controller.skip('item');
      await nextTick();
      await nextTick();

      expect(sendAction).toHaveBeenCalledTimes(2);
      const lastCall = sendAction.mock.calls[1];
      expect(lastCall[0]).toBe('collect');
      expect(lastCall[1]).toHaveProperty('sector', 3);
    });
  });

  describe('R-06: stale choice-fetch race after action completion', () => {
    // Regression tests for the post-multijump stale-choice race:
    // When fetchChoicesForPick is in-flight and the action is cleared
    // (completed/cancelled/replaced), the resolved result must be DISCARDED —
    // not written to the snapshot of any later action.
    //
    // Fix: a monotonic `choiceFetchGen` counter is bumped by clearAdvancedState().
    // Each fetchChoicesForPick call captures the counter before the await and
    // checks it after. If they differ the result is silently dropped.
    //
    // These tests FAIL without the generation guard and PASS with it.

    it('discards in-flight fetch result after cancel() bumps the generation (R-06)', async () => {
      // Deferred fetch: we control when it resolves.
      let resolveOldFetch!: (result: PickChoicesResult) => void;
      const oldFetchPromise = new Promise<PickChoicesResult>((resolve) => {
        resolveOldFetch = resolve;
      });

      const fetchPickChoices = vi.fn().mockReturnValueOnce(oldFetchPromise);

      const moveMeta: Record<string, ActionMetadata> = {
        move: {
          name: 'move',
          prompt: 'Move piece',
          selections: [
            { name: 'destination', type: 'choice', prompt: 'Select destination' },
          ],
        },
      };
      actionMetadata.value = { ...createTestMetadata(), ...moveMeta };
      availableActions.value = [...(availableActions.value ?? []), 'move'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        autoFill: false,
        playerSeat: ref(0),
        fetchPickChoices,
      });

      // Start the action — fetchChoicesForPick('destination') suspends on oldFetchPromise.
      const startPromise = controller.start('move');

      // Cancel while the fetch is still in-flight: this bumps choiceFetchGen.
      controller.cancel();

      // Resolve the old fetch with stale choices — the action is already gone.
      resolveOldFetch({ success: true, choices: [{ value: 'stale', display: 'Stale Destination' }] });

      // Allow the suspended fetchChoicesForPick to resume and start() to settle.
      await startPromise;
      await nextTick();

      // Action was cancelled — snapshot must be null. Stale choices must NOT persist.
      expect(controller.currentAction.value).toBeNull();
      expect(controller.actionSnapshot?.value).toBeNull();
      // isLoadingChoices must be false — the finally block ran despite the early return.
      expect(controller.isLoadingChoices.value).toBe(false);
    });

    it('does not write stale choices into the new action snapshot (R-06 new-action pollution)', async () => {
      // Deferred first fetch (for action #1, pre-cancel).
      let resolveOldFetch!: (result: PickChoicesResult) => void;
      const oldFetchPromise = new Promise<PickChoicesResult>((resolve) => {
        resolveOldFetch = resolve;
      });

      // First fetchPickChoices call is the stale in-flight fetch (old action).
      // Subsequent calls (from the new action) return empty immediately.
      const fetchPickChoices = vi.fn()
        .mockReturnValueOnce(oldFetchPromise)
        .mockResolvedValue({ success: true, choices: [] });

      const moveMeta: Record<string, ActionMetadata> = {
        move: {
          name: 'move',
          prompt: 'Move piece',
          selections: [
            { name: 'destination', type: 'choice', prompt: 'Select destination' },
          ],
        },
      };
      actionMetadata.value = { ...createTestMetadata(), ...moveMeta };
      availableActions.value = [...(availableActions.value ?? []), 'move'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        autoFill: false,
        playerSeat: ref(0),
        fetchPickChoices,
      });

      // Action #1 starts — fetch #1 suspends (captured gen = N).
      const startPromise1 = controller.start('move');

      // Cancel action #1: bumps gen to N+1.
      controller.cancel();

      // Action #2 starts: bumps gen to N+2, fetch #2 captured gen = N+2, resolves immediately.
      const startPromise2 = controller.start('move');

      // Resolve the stale fetch with old data: gen check will see N !== N+2, discard.
      resolveOldFetch({ success: true, choices: [{ value: 'stale', display: 'Stale Destination' }] });

      await startPromise1;
      await startPromise2;
      await nextTick();

      // The new action's snapshot must NOT contain the stale choice value.
      const snapshot = controller.actionSnapshot?.value;
      const destSnapshot = snapshot?.pickSnapshots.get('destination');
      if (destSnapshot?.choices) {
        expect(destSnapshot.choices.map(c => c.value)).not.toContain('stale');
      }
      // isLoadingChoices must be settled.
      expect(controller.isLoadingChoices.value).toBe(false);
    });

    it('isLoadingChoices is true while fetch is in-flight and false after (R-06 loading guard)', async () => {
      // This validates the loading-state invariant that ActionPanel uses to decide
      // whether to show "Loading choices..." vs "No options available".
      let resolveDeferred!: (result: PickChoicesResult) => void;
      const deferredPromise = new Promise<PickChoicesResult>((resolve) => {
        resolveDeferred = resolve;
      });

      const fetchPickChoices = vi.fn().mockReturnValue(deferredPromise);

      const moveMeta: Record<string, ActionMetadata> = {
        move: {
          name: 'move',
          prompt: 'Move piece',
          selections: [
            { name: 'destination', type: 'choice', prompt: 'Select destination' },
          ],
        },
      };
      actionMetadata.value = { ...createTestMetadata(), ...moveMeta };
      availableActions.value = [...(availableActions.value ?? []), 'move'];

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
        autoFill: false,
        playerSeat: ref(0),
        fetchPickChoices,
      });

      // Start the action (fetch is now in-flight).
      const startPromise = controller.start('move');

      // Give the JS event loop a tick so fetchChoicesForPick sets isLoadingChoices = true.
      await nextTick();

      // While fetch is in-flight, isLoadingChoices must be true.
      expect(controller.isLoadingChoices.value).toBe(true);

      // Resolve the fetch with an empty result (genuinely no choices).
      resolveDeferred({ success: true, choices: [] });
      await startPromise;
      await nextTick();

      // After fetch completes, isLoadingChoices must be false.
      expect(controller.isLoadingChoices.value).toBe(false);
      // The snapshot should have an empty choices array (no crash, no stale data).
      const snapshot = controller.actionSnapshot?.value;
      const destSnapshot = snapshot?.pickSnapshots.get('destination');
      expect(destSnapshot?.choices).toEqual([]);
    });
  });

  describe('multiSelect validation', () => {
    // Note: Current implementation validates array elements individually,
    // which means multiSelect arrays pass if any element matches a choice.
    // For full validation, server should verify min/max constraints.

    it('should store multiSelect array in wizard mode', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('discardMultiple');
      await controller.fill('cards', [1, 2]);

      expect(controller.currentArgs.value.cards).toEqual([1, 2]);
      expect(controller.isReady.value).toBe(true);
    });

    it('should send multiSelect array via sendAction when ready', async () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoFill: false,
        autoExecute: true,
      });

      // Start the action and fill with the full multi-select array.
      await controller.start('discardMultiple');
      await controller.fill('cards', [1, 2, 3]);

      expect(controller.isReady.value).toBe(true);
      await nextTick();
      await nextTick();

      expect(sendAction).toHaveBeenCalledWith('discardMultiple', { cards: [1, 2, 3] });
    });

    it('should have multiSelect metadata available', () => {
      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
      });

      const meta = controller.getActionMetadata('discardMultiple');
      expect(meta).toBeDefined();
      expect(meta!.selections[0].multiSelect).toEqual({ min: 2, max: 3 });
    });
  });
});
