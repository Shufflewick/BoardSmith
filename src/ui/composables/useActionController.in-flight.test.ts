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

/** A fake server call whose replies the test hands back one by one, in the order they were asked. */
function heldCalls<T>() {
  const pending: Array<ReturnType<typeof deferred<T>>> = [];
  const fn = vi.fn(() => {
    const reply = deferred<T>();
    pending.push(reply);
    return reply.promise;
  });
  return { fn, reply: (i: number, value: T) => pending[i].resolve(value) };
}

type ChoicesReply = { success: boolean; choices?: Array<{ value: unknown; display: string }> };

describe('a choice fetch that answers after the action moved on (#856)', () => {
  const goblin = { value: 'goblin', display: 'Goblin' };
  const orc = { value: 'orc', display: 'Orc' };
  // Both actions name their pick `target`; attack's has one static choice, heal's two.
  const metadata: Record<string, EnrichedActionMetadata> = {
    attack: {
      name: 'attack',
      prompt: 'Attack',
      selections: [
        { name: 'weapon', type: 'choice', prompt: 'Weapon', choices: [{ value: 'axe', display: 'Axe' }, { value: 'bow', display: 'Bow' }] },
        { name: 'target', type: 'choice', prompt: 'Target', choices: [goblin] },
      ],
    },
    strike: {
      name: 'strike',
      prompt: 'Strike',
      selections: [{ name: 'target', type: 'choice', prompt: 'Target', choices: [goblin] }],
    },
    heal: {
      name: 'heal',
      prompt: 'Heal',
      selections: [{ name: 'target', type: 'choice', prompt: 'Target', choices: [goblin, orc] }],
    },
  };

  function controllerWithHeldFetches() {
    const fetches = heldCalls<ChoicesReply>();
    const sendAction = vi.fn(async () => ({ success: true }));
    const controller = useActionController({
      sendAction,
      availableActions: ref(['attack', 'strike', 'heal']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      fetchPickChoices: fetches.fn,
      autoFill: true,
      autoExecute: true,
    });
    return { controller, sendAction, fetches };
  }

  it("start(): the old action's fetch does not auto-fill or execute the next action's same-named pick", async () => {
    const { controller, sendAction, fetches } = controllerWithHeldFetches();

    void controller.start('strike');
    await flush();
    controller.cancel();
    void controller.start('heal');
    await flush();
    fetches.reply(0, { success: true, choices: [goblin] });
    await flush();

    expect(controller.currentAction.value).toBe('heal');
    expect(controller.currentArgs.value).toEqual({});
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("fill(): the old action's fetch for its next pick does not auto-fill or execute the next action", async () => {
    const { controller, sendAction, fetches } = controllerWithHeldFetches();

    void controller.start('attack');
    await flush();
    fetches.reply(0, { success: true, choices: [{ value: 'axe', display: 'Axe' }, { value: 'bow', display: 'Bow' }] });
    await flush();
    void controller.fill('weapon', 'axe');
    await flush();
    controller.cancel();
    void controller.start('heal');
    await flush();
    // Call 0 was weapon, then fill and the pick watcher share target's fetch (1); heal's is 2.
    fetches.reply(1, { success: true, choices: [goblin] });
    await flush();

    expect(controller.currentAction.value).toBe('heal');
    expect(controller.currentArgs.value).toEqual({});
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('auto-execute does not send the next action when the old one was cancelled during a before-execute hook', async () => {
    const { controller, sendAction, fetches } = controllerWithHeldFetches();
    const hook = deferred<void>();
    controller.onBeforeAutoExecute(() => hook.promise);

    void controller.start('heal');
    await flush();
    fetches.reply(0, { success: true, choices: [goblin, orc] });
    await flush();
    void controller.fill('target', 'orc');
    await flush();
    controller.cancel();
    void controller.start('attack');
    await flush();
    hook.resolve();
    await flush();

    expect(controller.currentAction.value).toBe('attack');
    expect(sendAction).not.toHaveBeenCalled();
  });
});
