/**
 * Shared test utilities for useActionController tests
 *
 * Contains mock helpers and test fixtures used across multiple test files.
 */

import { vi } from 'vitest';
import type { ActionMetadata, ActionResult } from '../src/composables/useActionController.js';

/**
 * Creates a mock sendAction function for testing.
 * By default, returns a successful result with the action name and args.
 */
export function createMockSendAction() {
  return vi.fn().mockImplementation(async (actionName: string, args: Record<string, unknown>): Promise<ActionResult> => {
    return { success: true, data: { actionName, args } };
  });
}

/**
 * Creates a comprehensive set of test action metadata.
 * Includes various selection types and configurations for thorough testing.
 */
export function createTestMetadata(): Record<string, ActionMetadata> {
  return {
    // Simple action with no selections
    endTurn: {
      name: 'endTurn',
      prompt: 'End your turn',
      selections: [],
    },
    // Action with a single required choice selection
    playCard: {
      name: 'playCard',
      prompt: 'Play a card',
      selections: [
        {
          name: 'card',
          type: 'choice',
          prompt: 'Select a card',
          choices: [
            { value: 1, display: 'Ace of Spades' },
            { value: 2, display: 'King of Hearts' },
            { value: 3, display: 'Queen of Diamonds' },
          ],
        },
      ],
    },
    // Action with single choice (should auto-fill)
    forcedPlay: {
      name: 'forcedPlay',
      prompt: 'Play the only valid card',
      selections: [
        {
          name: 'card',
          type: 'choice',
          prompt: 'Select a card',
          choices: [
            { value: 42, display: 'Only Option' },
          ],
        },
      ],
    },
    // Action with optional selection
    optionalDiscard: {
      name: 'optionalDiscard',
      prompt: 'Discard a card',
      selections: [
        {
          name: 'card',
          type: 'choice',
          prompt: 'Select a card to discard',
          optional: true,
          choices: [
            { value: 1, display: 'Card 1' },
            { value: 2, display: 'Card 2' },
          ],
        },
      ],
    },
    // Action with optional selection AND single choice (should NOT auto-fill)
    optionalSingleChoice: {
      name: 'optionalSingleChoice',
      prompt: 'Take optional equipment',
      selections: [
        {
          name: 'item',
          type: 'choice',
          prompt: 'Select equipment (or skip)',
          optional: 'Done equipping',
          choices: [
            { value: 'sword', display: 'Sword' },
          ],
        },
      ],
    },
    // Action where first selection auto-fills, second is optional with single choice
    twoStepOptionalSecond: {
      name: 'twoStepOptionalSecond',
      prompt: 'First auto-fills, second is optional single choice',
      selections: [
        {
          name: 'first',
          type: 'choice',
          prompt: 'Select first (only one option)',
          choices: [
            { value: 'auto', display: 'Auto Value' },
          ],
        },
        {
          name: 'second',
          type: 'choice',
          prompt: 'Optional second (single choice)',
          optional: true,
          choices: [
            { value: 'optional', display: 'Optional Value' },
          ],
        },
      ],
    },
    // Action with element selection
    movePiece: {
      name: 'movePiece',
      prompt: 'Move a piece',
      selections: [
        {
          name: 'piece',
          type: 'element',
          prompt: 'Select a piece',
          validElements: [
            { id: 100, display: 'Pawn A' },
            { id: 101, display: 'Pawn B' },
            { id: 102, display: 'Knight' },
          ],
        },
      ],
    },
    // Action with multiple selections
    attack: {
      name: 'attack',
      prompt: 'Attack an enemy',
      selections: [
        {
          name: 'attacker',
          type: 'element',
          prompt: 'Select attacker',
          validElements: [
            { id: 1, display: 'Warrior' },
            { id: 2, display: 'Archer' },
          ],
        },
        {
          name: 'target',
          type: 'element',
          prompt: 'Select target',
          validElements: [
            { id: 10, display: 'Goblin' },
            { id: 11, display: 'Orc' },
          ],
        },
      ],
    },
    // Action with multiSelect
    discardMultiple: {
      name: 'discardMultiple',
      prompt: 'Discard cards',
      selections: [
        {
          name: 'cards',
          type: 'choice',
          prompt: 'Select cards to discard',
          multiSelect: { min: 2, max: 3 },
          choices: [
            { value: 1, display: 'Card 1' },
            { value: 2, display: 'Card 2' },
            { value: 3, display: 'Card 3' },
            { value: 4, display: 'Card 4' },
          ],
        },
      ],
    },
  };
}
