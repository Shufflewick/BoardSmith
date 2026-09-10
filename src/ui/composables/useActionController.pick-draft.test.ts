/**
 * THE EDITOR DRAFT, AND EXACTLY HOW LONG IT LIVES (#235).
 *
 * A number or text editor's value used to be a ref inside `ActionPanel`, so
 * anything that unmounted the panel threw it away: collapsing the action bar
 * (#230) is the one a player can reach on purpose, and 1,000 characters of
 * empire description is what it costs. The draft lives here now, beside
 * `multiSelectDraft`, which is in the controller for the same reason -- one
 * source of truth the panel and a custom UI share, surviving either being
 * unmounted.
 *
 * A DRAFT THAT OUTLIVES ITS QUESTION IS THE OPPOSITE BUG, and #229 already
 * fixed it once in the other direction: both editor refs were one-per-panel and
 * never reset, so cancelling a 200-character creed and starting a 20-character
 * nickname opened the nickname PREFILLED and already refusing its own contents.
 * So both halves are held here: the draft comes back where it belongs, and it
 * is unreadable everywhere else.
 *
 * The lifetime is one sentence: a draft belongs to one action asking one
 * selection in one round of a repeating pick, and it is resolved against that
 * identity on every read rather than trusted to have been cleared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick, watch } from 'vue';
import { useActionController, type ActionMetadata } from './useActionController.js';
import { _clearShownWarnings } from '../../utils/dev.js';

// `devWarn` shows each key once per process, so a refusal asserted in one test
// would go unwarned in the next without this.
beforeEach(() => { _clearShownWarnings(); });

const DESCRIBE: ActionMetadata = {
  name: 'describeEmpire',
  prompt: 'Describe empire',
  selections: [
    { name: 'description', type: 'text', prompt: 'Empire description', maxLength: 1000, multiline: true },
  ],
};

const NICKNAME: ActionMetadata = {
  name: 'setNickname',
  prompt: 'Set nickname',
  selections: [{ name: 'description', type: 'text', prompt: 'Nickname', maxLength: 20 }],
};

const RECYCLE: ActionMetadata = {
  name: 'recycle',
  prompt: 'Recycle waste',
  selections: [{ name: 'waste', type: 'number', prompt: 'Waste to recycle', min: 1, integer: true }],
};

const TWO_FIELDS: ActionMetadata = {
  name: 'rename',
  prompt: 'Rename and describe',
  selections: [
    { name: 'title', type: 'text', prompt: 'Title', maxLength: 24 },
    { name: 'blurb', type: 'text', prompt: 'Blurb', maxLength: 200 },
  ],
};

const PICK_A_CARD: ActionMetadata = {
  name: 'pickCard',
  prompt: 'Pick a card',
  selections: [
    {
      name: 'card',
      type: 'choice',
      prompt: 'Which card',
      choices: [{ value: 1, display: 'One' }, { value: 2, display: 'Two' }],
    },
  ],
};

/** A controller over the given actions, with nothing auto-filled or auto-run. */
function controllerOver(...actions: ActionMetadata[]) {
  const metadata: Record<string, ActionMetadata> = {};
  for (const action of actions) metadata[action.name] = action;
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const controller = useActionController({
    sendAction,
    availableActions: ref(actions.map((a) => a.name)),
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
    autoFill: false,
    autoExecute: false,
    fetchPickChoices: vi.fn().mockResolvedValue({ success: true, choices: [] }),
  });
  return { controller, sendAction };
}

describe('the editor draft survives what the panel does not', () => {
  it('holds the value the player has entered for the pick being asked', async () => {
    const { controller } = controllerOver(DESCRIBE);
    await controller.start(DESCRIBE.name, {});
    await nextTick();

    controller.setPickDraft('A draft nobody meant to throw away.');
    expect(controller.currentPickDraft.value).toBe('A draft nobody meant to throw away.');
  });

  it('is a number for a number pick, not the string a field would have given', async () => {
    const { controller } = controllerOver(RECYCLE);
    await controller.start(RECYCLE.name, {});
    await nextTick();

    controller.setPickDraft(7);
    expect(controller.currentPickDraft.value).toBe(7);
  });

  it('is null before the player has entered anything', async () => {
    const { controller } = controllerOver(DESCRIBE);
    await controller.start(DESCRIBE.name, {});
    await nextTick();

    expect(controller.currentPickDraft.value).toBeNull();
  });

  it('is visible to a custom UI, which is why it is here and not in the panel', async () => {
    // The parity rule: the panel and a custom UI are two representations of one
    // state. The typed value was the panel's alone, so a custom UI could not
    // show what the player was in the middle of writing.
    const { controller } = controllerOver(DESCRIBE);
    await controller.start(DESCRIBE.name, {});
    await nextTick();

    const seen: unknown[] = [];
    const unwatch = watch(controller.currentPickDraft, (value) => seen.push(value));
    controller.setPickDraft('Half a sentence');
    await nextTick();
    unwatch();
    expect(seen).toEqual(['Half a sentence']);
  });
});

describe('the editor draft dies with the question it belonged to', () => {
  it('does not reappear in a different action asking the same selection name', async () => {
    // #229's bug, exactly: two actions both asking for `description`, one
    // bounded at 1000 characters and one at 20. The long draft must not open
    // the short field already refusing its own contents.
    const { controller } = controllerOver(DESCRIBE, NICKNAME);
    await controller.start(DESCRIBE.name, {});
    await nextTick();
    controller.setPickDraft('x'.repeat(200));

    controller.cancel();
    await controller.start(NICKNAME.name, {});
    await nextTick();

    expect(controller.currentPickDraft.value).toBeNull();
  });

  it('does not survive the same action being cancelled and started again', async () => {
    const { controller } = controllerOver(DESCRIBE);
    await controller.start(DESCRIBE.name, {});
    await nextTick();
    controller.setPickDraft('Abandoned on purpose.');

    controller.cancel();
    await controller.start(DESCRIBE.name, {});
    await nextTick();

    expect(controller.currentPickDraft.value).toBeNull();
  });

  it('does not follow the player to the next selection of the same action', async () => {
    const { controller } = controllerOver(TWO_FIELDS);
    await controller.start(TWO_FIELDS.name, {});
    await nextTick();
    expect(controller.currentPick.value?.name).toBe('title');
    controller.setPickDraft('The Second Empire');

    await controller.fill('title', 'The Second Empire');
    await nextTick();

    expect(controller.currentPick.value?.name).toBe('blurb');
    expect(controller.currentPickDraft.value).toBeNull();
  });

  it('does not carry from one round of a repeating pick into the next', async () => {
    // The same selection, asked again. `accumulated.length` is the third part
    // of a draft's identity for exactly this: round two is a fresh question
    // that happens to have round one's name.
    const pickStep = vi.fn().mockResolvedValue({ success: true, done: false, nextChoices: [] });
    const repeated: ActionMetadata = {
      name: 'stockpile',
      prompt: 'Stockpile',
      selections: [
        { name: 'amount', type: 'number', prompt: 'How much', min: 1, repeat: { hasOnEach: false } },
      ],
    };
    const controller = useActionController({
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      availableActions: ref([repeated.name]),
      actionMetadata: ref({ [repeated.name]: repeated }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
      pickStep,
    });
    await controller.start(repeated.name, {});
    await nextTick();
    controller.setPickDraft(4);
    expect(controller.currentPickDraft.value).toBe(4);

    await controller.fill('amount', 4);
    await nextTick();

    expect(controller.repeatingState.value?.accumulated).toHaveLength(1);
    expect(controller.currentPick.value?.name).toBe('amount');
    expect(controller.currentPickDraft.value).toBeNull();
  });

  it('is gone once the action has been executed', async () => {
    const { controller } = controllerOver(RECYCLE);
    await controller.start(RECYCLE.name, {});
    await nextTick();
    controller.setPickDraft(3);

    await controller.fill('waste', 3);
    await controller.execute(RECYCLE.name, { waste: 3 });
    await nextTick();

    expect(controller.currentPickDraft.value).toBeNull();
  });

  it('is dropped when the selection it belongs to is cleared', async () => {
    const { controller } = controllerOver(DESCRIBE);
    await controller.start(DESCRIBE.name, {});
    await nextTick();
    controller.setPickDraft('Typed, then reconsidered.');

    controller.clear('description');
    await nextTick();

    expect(controller.currentPickDraft.value).toBeNull();
  });
});

describe('a draft can only be written for the question actually being asked', () => {
  it('refuses a draft when no action is under way, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const { controller } = controllerOver(DESCRIBE);

    controller.setPickDraft('Nowhere to put this');

    expect(controller.currentPickDraft.value).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a draft for a pick that has no editor', async () => {
    // A choice pick is a row of buttons. Nothing types into it, so a draft for
    // it is a caller's mistake and not a state the panel could reach.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const { controller } = controllerOver(PICK_A_CARD);
    await controller.start(PICK_A_CARD.name, {});
    await nextTick();

    controller.setPickDraft('typed at a button');

    expect(controller.currentPickDraft.value).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a value of the wrong kind for the pick, rather than storing it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const { controller } = controllerOver(RECYCLE);
    await controller.start(RECYCLE.name, {});
    await nextTick();

    controller.setPickDraft('seven' as unknown as number);

    expect(controller.currentPickDraft.value).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('accepts null anywhere, because clearing the field is always meaningful', async () => {
    const { controller } = controllerOver(DESCRIBE);
    await controller.start(DESCRIBE.name, {});
    await nextTick();
    controller.setPickDraft('Something');

    controller.setPickDraft(null);

    expect(controller.currentPickDraft.value).toBeNull();
  });
});
