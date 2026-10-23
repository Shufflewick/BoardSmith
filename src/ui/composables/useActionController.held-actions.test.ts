/**
 * An action the board holds while it is open is cancelled, and the player is
 * told why in the hold's own words (#1450). Left open it would sit at a pick
 * the board will not answer until the hold lifts.
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
  it('cancels it with the reason', async () => {
    const { controller, heldActions } = controllerWith();
    await controller.start('playCard');
    expect(controller.currentAction.value).toBe('playCard');

    heldActions.value = { playCard: WAIT };
    await nextTick();

    expect(controller.currentAction.value).toBeNull();
    expect(controller.lastError.value).toBe(WAIT);
    expect(controller.errorTick.value).toBe(1);
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
    expect(controller.errorTick.value).toBe(0);

    reply({ success: true });
    await sent;
    expect(controller.lastError.value).toBeNull();
  });
});
