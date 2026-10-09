/**
 * Pins the public member list of the action controller (#514).
 *
 * Adding or removing a member of `UseActionControllerReturn` fails this file's
 * type check, so a change to what a game author sees is a deliberate, reviewed
 * change to the list below. The check is enforced by `boardsmith typecheck`.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { UseActionControllerReturn } from './useActionControllerTypes.js';

describe('UseActionControllerReturn', () => {
  it('has exactly the reviewed public members', () => {
    expectTypeOf<keyof UseActionControllerReturn>().toEqualTypeOf<
      | 'currentAction' | 'currentArgs' | 'currentPick' | 'validElements' | 'currentChoices'
      | 'isReady' | 'isExecuting' | 'lastError' | 'errorTick' | 'isLoadingChoices'
      | 'repeatingState' | 'pendingFollowUp' | 'pendingOnServer' | 'heldFollowUp'
      | 'resumeFollowUp' | 'actionCompletedTick' | 'actionStartTick' | 'lastActionResult'
      | 'execute' | 'start' | 'fill' | 'skip' | 'clear' | 'cancel'
      | 'multiSelectDraft' | 'currentPickDraft' | 'setPickDraft'
      | 'actionQuote' | 'quotePending' | 'quoteError' | 'awaitingConfirmation'
      | 'confirmDisabledReason' | 'confirm' | 'actionMenuPath'
      | 'toggleMultiSelect' | 'confirmMultiSelect' | 'isMultiSelectSelected'
      | 'appendListEntry' | 'removeListEntry'
      | 'getChoices' | 'getValidElements' | 'getActionMetadata'
      | 'actionSnapshot' | 'getCollectedPick'
      | 'setBeforeAutoExecute' | 'animationsPending' | 'showActionPanel'
    >();
  });
});
