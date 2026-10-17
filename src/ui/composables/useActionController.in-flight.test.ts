/**
 * What the controller does while a request it sent is still out: a second
 * request for the same thing is refused, and a reply that arrives after the
 * action moved on is dropped instead of being applied to whatever is current.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController, type ControllerActionResult } from './useActionController.js';
import type { EnrichedActionMetadata } from './useActionControllerTypes.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

describe('execute() guards itself, whoever calls it (#855)', () => {
  const metadata: Record<string, EnrichedActionMetadata> = {
    buy: { name: 'buy', prompt: 'Buy', selections: [] },
  };

  function controllerWith(isViewingHistory = ref(false)) {
    const reply = deferred<ControllerActionResult>();
    const sendAction = vi.fn(() => reply.promise);
    const controller = useActionController({
      sendAction,
      availableActions: ref(['buy']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      isViewingHistory,
    });
    return { controller, sendAction, reply };
  }

  it('refuses a second execute while the first is still out', async () => {
    const { controller, sendAction, reply } = controllerWith();

    const first = controller.execute('buy');
    const second = controller.execute('buy');
    reply.resolve({ success: true });
    await Promise.all([first, second]);

    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(await second).toEqual({ success: false, error: 'Action already executing' });
  });

  it('refuses to send while viewing history', async () => {
    const { controller, sendAction, reply } = controllerWith(ref(true));

    const result = controller.execute('buy');
    reply.resolve({ success: true });

    expect(sendAction).not.toHaveBeenCalled();
    expect(await result).toEqual({ success: false, error: 'Cannot execute an action while viewing historical state.' });
  });

  it('still sends once the first execute has finished', async () => {
    const { controller, sendAction, reply } = controllerWith();

    const first = controller.execute('buy');
    reply.resolve({ success: true });
    await first;
    await controller.execute('buy');
    await flush();

    expect(sendAction).toHaveBeenCalledTimes(2);
  });
});
