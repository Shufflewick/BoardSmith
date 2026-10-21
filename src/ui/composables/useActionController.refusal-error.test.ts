/**
 * Every refusal from execute() reaches lastError and errorTick, so the shell
 * toasts it even when a custom UI button ignores the returned result (#1342).
 */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useActionController, type ControllerActionResult } from './useActionController.js';
import type { EnrichedActionMetadata } from './useActionControllerTypes.js';

const metadata: Record<string, EnrichedActionMetadata> = {
  draw: { name: 'draw', prompt: 'Draw', selections: [] },
};

function controllerWith(overrides: {
  isMyTurn?: boolean;
  completed?: boolean;
  disabledActions?: Record<string, string>;
  isViewingHistory?: boolean;
} = {}) {
  const sendAction = vi.fn((): Promise<ControllerActionResult> => new Promise(() => {}));
  const controller = useActionController({
    sendAction,
    availableActions: ref(['draw']),
    actionMetadata: ref(metadata),
    isMyTurn: ref(overrides.isMyTurn ?? true),
    completed: ref(overrides.completed ?? false),
    disabledActions: ref(overrides.disabledActions),
    isViewingHistory: ref(overrides.isViewingHistory ?? false),
  });
  return { controller, sendAction };
}

describe('execute() refusals before sending set lastError (#1342)', () => {
  it.each([
    ['not your turn', { isMyTurn: false }, 'draw', 'Not your turn'],
    ['already submitted', { completed: true }, 'draw', 'You have already submitted your action for this step'],
    ['disabled by the offer', { disabledActions: { draw: 'The deck is empty' } }, 'draw', 'The deck is empty'],
    ['not offered', {}, 'trade', 'Action "trade" is not available'],
    ['viewing history', { isViewingHistory: true }, 'draw', 'Cannot execute an action while viewing historical state.'],
  ] as const)('%s', async (_label, overrides, actionName, error) => {
    const { controller, sendAction } = controllerWith(overrides);

    const result = await controller.execute(actionName);

    expect(result).toEqual({ success: false, error });
    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toBe(error);
    expect(controller.errorTick.value).toBe(1);
  });

  it('while another execute is still out', async () => {
    const { controller, sendAction } = controllerWith();

    void controller.execute('draw');
    const result = await controller.execute('draw');

    expect(result).toEqual({ success: false, error: 'Action already executing' });
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(controller.lastError.value).toBe('Action already executing');
    expect(controller.errorTick.value).toBe(1);
  });
});
