/**
 * What the controller does while a request it sent is still out: a second
 * request for the same thing is refused, and a reply that arrives after the
 * action moved on is dropped instead of being applied to whatever is current.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController, type ControllerActionResult } from './useActionController.js';
import type { EnrichedActionMetadata, PickStepResponse } from './useActionControllerTypes.js';

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
    // A double-click is not the player's mistake, so nothing reaches the toast (#1348).
    expect(controller.lastError.value).toBeNull();
    expect(controller.errorTick.value).toBe(0);
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

describe('a pick step that is still awaiting the server (#854)', () => {
  const pieces = [{ value: 'p1', display: 'Pawn 1' }, { value: 'p2', display: 'Pawn 2' }];
  const metadata: Record<string, EnrichedActionMetadata> = {
    move: {
      name: 'move',
      prompt: 'Move',
      selections: [
        { name: 'piece', type: 'choice', prompt: 'Piece', hasOnSelect: true, choices: pieces },
        { name: 'to', type: 'choice', prompt: 'To', choices: [{ value: 'a', display: 'A' }, { value: 'b', display: 'B' }] },
      ],
    },
    shift: {
      name: 'shift',
      prompt: 'Shift',
      selections: [
        { name: 'piece', type: 'choice', prompt: 'Piece', hasOnSelect: true, choices: pieces },
        { name: 'bonus', type: 'choice', prompt: 'Bonus', optional: true, choices: [{ value: 'x', display: 'X' }, { value: 'y', display: 'Y' }] },
      ],
    },
    collect: {
      name: 'collect',
      prompt: 'Collect',
      selections: [{ name: 'gem', type: 'choice', prompt: 'Gem', repeat: { hasOnEach: false }, choices: [{ value: 'ruby', display: 'Ruby' }, { value: 'opal', display: 'Opal' }] }],
    },
    draw: {
      name: 'draw',
      prompt: 'Draw',
      selections: [
        { name: 'piece', type: 'choice', prompt: 'Card', choices: [{ value: 'c1', display: 'Card 1' }, { value: 'c2', display: 'Card 2' }] },
        { name: 'pile', type: 'choice', prompt: 'Pile', choices: [{ value: 'l', display: 'Left' }, { value: 'r', display: 'Right' }] },
      ],
    },
  };

  function controllerWithHeldSteps() {
    const steps = heldCalls<PickStepResponse>();
    const sendAction = vi.fn(async () => ({ success: true }));
    const cancelPendingAction = vi.fn(async () => {});
    const controller = useActionController({
      sendAction,
      availableActions: ref(['move', 'shift', 'collect', 'draw']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      pickStep: steps.fn,
      cancelPendingAction,
      autoFill: false,
    });
    return { controller, sendAction, steps, cancelPendingAction };
  }

  async function cancelMidStepThenDraw(action: 'move' | 'collect', pick: string, value: string) {
    const t = controllerWithHeldSteps();
    await t.controller.start(action);
    const fill = t.controller.fill(pick, value);
    await flush();
    t.controller.cancel();
    await t.controller.start('draw');
    return { ...t, fill };
  }

  it('a completing reply that arrives after cancel and a new action is published under the old action, leaving the new one alone', async () => {
    const t = await cancelMidStepThenDraw('move', 'piece', 'p1');
    await t.controller.fill('piece', 'c1');
    t.steps.reply(0, { success: true, actionComplete: true, data: { moved: 'p1' } });
    await t.fill;
    await flush();

    expect(t.controller.currentAction.value).toBe('draw');
    expect(t.controller.currentArgs.value).toEqual({ piece: 'c1' });
    expect(t.controller.lastActionResult.value).toEqual({
      action: 'move',
      seat: 0,
      result: { success: true, data: { moved: 'p1' }, message: undefined, followUp: undefined },
    });
  });

  it('a continuing reply that arrives after cancel and a new action does not write into it or send its next pick', async () => {
    const t = await cancelMidStepThenDraw('move', 'piece', 'p1');
    t.steps.reply(0, { success: true });
    await t.fill;
    await flush();

    expect(t.controller.currentAction.value).toBe('draw');
    expect(t.controller.currentArgs.value).toEqual({});
    expect(t.steps.fn).toHaveBeenCalledTimes(1);
  });

  it('a repeating pick reply that completes after the action was cancelled and started again is published, leaving the new one alone', async () => {
    const { controller, steps } = controllerWithHeldSteps();
    await controller.start('collect');
    const stale = controller.fill('gem', 'ruby');
    controller.cancel();
    await controller.start('collect');
    const fresh = controller.fill('gem', 'opal');
    steps.reply(0, { success: true, actionComplete: true, data: { gems: ['ruby'] } });
    await stale;
    await flush();

    expect(controller.currentAction.value).toBe('collect');
    expect(controller.repeatingState.value?.accumulated.map(a => a.value)).toEqual(['opal']);
    expect(controller.lastActionResult.value?.result.data).toEqual({ gems: ['ruby'] });
    steps.reply(1, { success: true });
    await fresh;
  });

  it('a step that fails after its action was cancelled shows no error', async () => {
    let fail!: (err: Error) => void;
    const pickStep = vi.fn(() => new Promise<PickStepResponse>((_, reject) => { fail = reject; }));
    const controller = useActionController({
      sendAction: vi.fn(async () => ({ success: true })),
      availableActions: ref(['move']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      pickStep,
      autoFill: false,
    });
    await controller.start('move');
    const fill = controller.fill('piece', 'p1');
    controller.cancel();
    fail(new Error('connection lost'));
    await fill;

    expect(controller.lastError.value).toBeNull();
    expect(controller.errorTick.value).toBe(0);
  });

  it('cancel while the first step is out tells the server, which is holding the action by then', async () => {
    const t = await cancelMidStepThenDraw('move', 'piece', 'p1');

    expect(t.cancelPendingAction).toHaveBeenCalledTimes(1);
  });

  it('a second fill while a step is out is refused, visibly, and sends nothing', async () => {
    const { controller, steps } = controllerWithHeldSteps();
    await controller.start('move');
    const first = controller.fill('piece', 'p1');
    const second = controller.fill('piece', 'p1');
    await flush();
    const sent = steps.fn.mock.calls.length;
    steps.reply(0, { success: true });
    if (sent > 1) steps.reply(1, { success: true });
    await first;

    expect(sent).toBe(1);
    expect(await second).toEqual({ valid: false, error: 'Still waiting for the server to answer your last pick.' });
    expect(controller.lastError.value).toBe('Still waiting for the server to answer your last pick.');
  });

  it('a skip while a step is out is refused, visibly', async () => {
    const { controller, steps } = controllerWithHeldSteps();
    await controller.start('shift');
    const first = controller.fill('piece', 'p1');
    controller.skip('bonus');
    steps.reply(0, { success: true });
    await first;

    expect(controller.currentArgs.value).toEqual({ piece: 'p1' });
    expect(controller.lastError.value).toBe('Still waiting for the server to answer your last pick.');
  });

  it('a new action can send its first pick while the cancelled action\'s step is still out', async () => {
    const { controller, steps } = controllerWithHeldSteps();
    await controller.start('move');
    void controller.fill('piece', 'p1');
    controller.cancel();
    await controller.start('move');
    void controller.fill('piece', 'p2');
    await flush();

    expect(steps.fn).toHaveBeenCalledTimes(2);
  });
});

describe("a follow-up's first fetch that answers after the follow-up was cancelled", () => {
  it('does not send a pick step for the action current by then', async () => {
    const targets = [{ value: 'a', display: 'A' }, { value: 'b', display: 'B' }];
    const chase: EnrichedActionMetadata = {
      name: 'chase',
      prompt: 'Chase',
      selections: [{ name: 'target', type: 'choice', prompt: 'Target', choices: [targets[0]] }],
    };
    const metadata: Record<string, EnrichedActionMetadata> = {
      go: { name: 'go', prompt: 'Go', selections: [] },
      draw: {
        name: 'draw',
        prompt: 'Draw',
        selections: [{ name: 'target', type: 'choice', prompt: 'Target', hasOnSelect: true, choices: targets }],
      },
    };
    const fetches = heldCalls<ChoicesReply>();
    const steps = heldCalls<PickStepResponse>();
    const controller = useActionController({
      sendAction: vi.fn(async () => ({ success: true, followUp: { action: 'chase', args: {}, metadata: chase } })),
      availableActions: ref(['go', 'draw']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      fetchPickChoices: fetches.fn,
      pickStep: steps.fn,
      autoFill: true,
      autoExecute: true,
    });

    await controller.execute('go');
    await flush();
    expect(controller.currentAction.value).toBe('chase');
    controller.cancel();
    void controller.start('draw');
    await flush();
    fetches.reply(1, { success: true, choices: targets });
    await flush();
    const fill = controller.fill('target', 'a');
    await flush();
    steps.reply(0, { success: true });
    await fill;
    // chase's own fetch, answered last: it offers one target, which would auto-fill.
    fetches.reply(0, { success: true, choices: [targets[0]] });
    await flush();

    expect(controller.currentAction.value).toBe('draw');
    expect(steps.fn).toHaveBeenCalledTimes(1);
  });
});

describe('a reply that answers after the page changed seats (#1150)', () => {
  const metadata: Record<string, EnrichedActionMetadata> = {
    buy: { name: 'buy', prompt: 'Buy', selections: [] },
    pay: { name: 'pay', prompt: 'Pay', selections: [] },
  };

  function seatedController() {
    const reply = deferred<ControllerActionResult>();
    const playerSeat = ref(1);
    const controller = useActionController({
      sendAction: vi.fn(() => reply.promise),
      availableActions: ref(['buy', 'pay']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      playerSeat,
    });
    return { controller, playerSeat, reply };
  }

  it("is published under the seat that sent it, and its follow-up is not started for the next seat", async () => {
    const { controller, playerSeat, reply } = seatedController();
    const sent = controller.execute('buy');
    playerSeat.value = 2;
    await flush();
    reply.resolve({ success: true, followUp: { action: 'pay' } });
    await sent;
    await flush();

    expect(controller.currentAction.value).toBeNull();
    expect(controller.lastActionResult.value?.seat).toBe(1);
  });

  it("does not show the sending seat's error to the next seat", async () => {
    const { controller, playerSeat, reply } = seatedController();

    const sent = controller.execute('buy');
    playerSeat.value = 2;
    await flush();
    reply.resolve({ success: false, error: 'Not enough gold' });

    expect(await sent).toEqual({ success: false, error: 'Not enough gold' });
    expect(controller.lastError.value).toBeNull();
    expect(controller.lastActionResult.value?.seat).toBe(1);
  });
});
