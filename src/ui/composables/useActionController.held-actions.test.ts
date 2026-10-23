/**
 * An action the board holds while it is open is cancelled, and the player is
 * told why in the hold's own words (#1450). Left open it would sit at a pick
 * the board will not answer until the hold lifts. The hold is the screen's own
 * state, not a failed action, so it is a notice and never an error (#1461).
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController, type ControllerActionResult } from './useActionController.js';
import { createMockSendAction, createTestMetadata } from './useActionController.test-helper.js';

const WAIT = 'Playing cards waits until the battle playback ends.';

function controllerWith(sendAction = createMockSendAction()) {
  const heldActions = ref<Record<string, string>>({});
  const controller = useActionController({
    sendAction,
    availableActions: ref(['playCard', 'endTurn']),
    actionMetadata: ref(createTestMetadata()),
    isMyTurn: ref(true),
    disabledActions: heldActions,
    heldActions,
  });
  return { controller, heldActions };
}

describe('a hold on the open action (#1450)', () => {
  it('cancels it with the reason as a notice, not an error (#1461)', async () => {
    const { controller, heldActions } = controllerWith();
    await controller.start('playCard');
    expect(controller.currentAction.value).toBe('playCard');

    heldActions.value = { playCard: WAIT };
    await nextTick();

    expect(controller.currentAction.value).toBeNull();
    expect(controller.holdNotice.value).toEqual({ reason: WAIT });
    expect(controller.lastError.value).toBeNull();
    expect(controller.errorTick.value).toBe(0);
  });

  it('gives a new notice each time, so the same reason twice is told twice (#1461)', async () => {
    const { controller, heldActions } = controllerWith();
    await controller.start('playCard');
    heldActions.value = { playCard: WAIT };
    await nextTick();
    const first = controller.holdNotice.value;

    heldActions.value = {};
    await controller.start('playCard');
    heldActions.value = { playCard: WAIT };
    await nextTick();

    expect(controller.holdNotice.value).toEqual({ reason: WAIT });
    expect(controller.holdNotice.value).not.toBe(first);
  });

  it('leaves an action that is not held open', async () => {
    const { controller, heldActions } = controllerWith();
    await controller.start('playCard');

    heldActions.value = { endTurn: WAIT };
    await nextTick();

    expect(controller.currentAction.value).toBe('playCard');
    expect(controller.errorTick.value).toBe(0);
  });

  it('lets an action already sent to the server finish', async () => {
    let reply!: (result: ControllerActionResult) => void;
    const sendAction = vi.fn(() => new Promise<ControllerActionResult>((resolve) => { reply = resolve; }));
    const { controller, heldActions } = controllerWith(sendAction);
    await controller.start('playCard');
    const sent = controller.fill('card', 1);
    await nextTick();
    expect(sendAction).toHaveBeenCalled();

    heldActions.value = { playCard: WAIT };
    await nextTick();
    expect(controller.holdNotice.value).toBeNull();

    reply({ success: true });
    await sent;
    expect(controller.lastError.value).toBeNull();
  });
});
