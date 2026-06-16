/**
 * Tests for generic drag-and-drop target derivation (audit F36).
 *
 * Proves drop targets are now derived from the action controller's CURRENT pick
 * for ANY action shape — including shapes the old ActionPanel watch silently
 * ignored (element -> choice WITHOUT filterBy, `elements` multi-picks) — while
 * the two previously-supported shapes (element -> choice WITH filterBy, and
 * element -> element) keep working identically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  useActionController,
  type ActionMetadata,
} from './useActionController.js';
import {
  deriveDropTargetsForPick,
  setupDragDropOrchestration,
} from './useDragDropTargets.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import { createMockSendAction } from './useActionController.helpers.js';

/** Flush Vue's scheduler + the async watcher's awaited start()/fetch chain. */
async function flushAll(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

function makeController(
  metadata: Record<string, ActionMetadata>,
  fetchPickChoices: ReturnType<typeof vi.fn>,
  sendAction = createMockSendAction(),
) {
  const availableActions = ref<string[]>(Object.keys(metadata));
  const actionMetadata = ref<Record<string, ActionMetadata> | undefined>(metadata);
  const isMyTurn = ref(true);
  const controller = useActionController({
    sendAction,
    availableActions,
    actionMetadata,
    isMyTurn,
    playerSeat: ref(0),
    fetchPickChoices,
  });
  return { controller, availableActions, actionMetadata, isMyTurn, sendAction };
}

describe('deriveDropTargetsForPick (generic derivation)', () => {
  it('NEW SHAPE: element -> choice WITHOUT filterBy exposes drop targets', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      choices: [
        { value: 'a1', display: 'A1', targetRef: { id: 100 } },
        { value: 'a2', display: 'A2', targetRef: { id: 101 } },
      ],
    });
    const metadata: Record<string, ActionMetadata> = {
      place: {
        name: 'place',
        selections: [
          { name: 'piece', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }, { id: 2, ref: { id: 2 } }] },
          { name: 'dest', type: 'choice' }, // no filterBy
        ],
      },
    };
    const { controller, sendAction } = makeController(metadata, fetchPickChoices);

    await controller.start('place', { args: { piece: 1 } });
    const pick = controller.currentPick.value;
    expect(pick?.name).toBe('dest');

    const derived = deriveDropTargetsForPick(controller, pick);
    expect(derived).not.toBeNull();
    expect(derived!.targets.map(t => t.id).sort()).toEqual([100, 101]);

    // Dropping onto a target fills the choice and the action auto-executes.
    derived!.onDrop(101);
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('place', { piece: 1, dest: 'a2' });
  });

  it('EXISTING SHAPE: element -> choice WITH filterBy narrows targets to the selected element', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      choices: [
        { value: { pieceId: 1, to: 'x' }, display: 'X', targetRef: { id: 100 } },
        { value: { pieceId: 1, to: 'z' }, display: 'Z', targetRef: { id: 101 } },
        { value: { pieceId: 2, to: 'y' }, display: 'Y', targetRef: { id: 200 } },
      ],
    });
    const metadata: Record<string, ActionMetadata> = {
      move: {
        name: 'move',
        selections: [
          { name: 'piece', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }, { id: 2, ref: { id: 2 } }] },
          { name: 'dest', type: 'choice', filterBy: { key: 'pieceId', selectionName: 'piece' } },
        ],
      },
    };
    const { controller } = makeController(metadata, fetchPickChoices);

    await controller.start('move', { args: { piece: 1 } });
    const derived = deriveDropTargetsForPick(controller, controller.currentPick.value);
    // Only destinations belonging to piece 1 are drop targets (piece 2's id 200 is filtered out).
    expect(derived!.targets.map(t => t.id).sort()).toEqual([100, 101]);
  });

  it('EXISTING SHAPE: element -> element exposes the second element selection as targets', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      validElements: [
        { id: 10, display: 'Goblin', ref: { id: 10 } },
        { id: 11, display: 'Orc', ref: { id: 11 } },
      ],
    });
    const metadata: Record<string, ActionMetadata> = {
      attack: {
        name: 'attack',
        selections: [
          { name: 'attacker', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }] },
          { name: 'target', type: 'element' },
        ],
      },
    };
    const { controller, sendAction } = makeController(metadata, fetchPickChoices);

    await controller.start('attack', { args: { attacker: 1 } });
    const derived = deriveDropTargetsForPick(controller, controller.currentPick.value);
    expect(derived!.targets.map(t => t.id).sort()).toEqual([10, 11]);

    derived!.onDrop(11);
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('attack', { attacker: 1, target: 11 });
  });

  it('NEW SHAPE: an `elements` multi-pick exposes its valid elements as drop targets', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      validElements: [
        { id: 20, display: 'Card 20', ref: { id: 20 } },
        { id: 21, display: 'Card 21', ref: { id: 21 } },
      ],
      multiSelect: { min: 1, max: 2 },
    });
    const metadata: Record<string, ActionMetadata> = {
      stash: {
        name: 'stash',
        selections: [{ name: 'cards', type: 'elements', multiSelect: { min: 1, max: 2 } }],
      },
    };
    const { controller } = makeController(metadata, fetchPickChoices);

    await controller.start('stash');
    const pick = controller.currentPick.value;
    expect(pick?.type).toBe('elements');
    const derived = deriveDropTargetsForPick(controller, pick);
    expect(derived!.targets.map(t => t.id).sort()).toEqual([20, 21]);
  });

  it('skips disabled elements and choices without a targetRef', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      choices: [
        { value: 'a', display: 'A', targetRef: { id: 100 } },
        { value: 'b', display: 'B' }, // no targetRef -> not droppable
        { value: 'c', display: 'C', targetRef: { id: 102 }, disabled: 'blocked' },
      ],
    });
    const metadata: Record<string, ActionMetadata> = {
      place: {
        name: 'place',
        selections: [
          { name: 'piece', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }] },
          { name: 'dest', type: 'choice' },
        ],
      },
    };
    const { controller } = makeController(metadata, fetchPickChoices);

    await controller.start('place', { args: { piece: 1 } });
    const derived = deriveDropTargetsForPick(controller, controller.currentPick.value);
    expect(derived!.targets.map(t => t.id)).toEqual([100]);
  });

  it('returns null for non-droppable pick types (number/text)', () => {
    const fetchPickChoices = vi.fn();
    const { controller } = makeController({}, fetchPickChoices);
    expect(deriveDropTargetsForPick(controller, { name: 'qty', type: 'number' })).toBeNull();
    expect(deriveDropTargetsForPick(controller, { name: 'note', type: 'text' })).toBeNull();
    expect(deriveDropTargetsForPick(controller, null)).toBeNull();
  });
});

describe('setupDragDropOrchestration (shared wiring used by ActionPanel AND custom UIs)', () => {
  let boardInteraction: ReturnType<typeof createBoardInteraction>;

  beforeEach(() => {
    boardInteraction = createBoardInteraction();
  });

  it('NEW SHAPE: dragging an element auto-starts an element->choice (no filterBy) action and wires drop targets', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      choices: [
        { value: 'a1', display: 'A1', targetRef: { id: 100 } },
        { value: 'a2', display: 'A2', targetRef: { id: 101 } },
      ],
    });
    const metadata: Record<string, ActionMetadata> = {
      place: {
        name: 'place',
        selections: [
          { name: 'piece', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }, { id: 2, ref: { id: 2 } }] },
          { name: 'dest', type: 'choice' },
        ],
      },
    };
    const { controller, availableActions, actionMetadata, isMyTurn } = makeController(metadata, fetchPickChoices);

    setupDragDropOrchestration({ boardInteraction, actionController: controller, availableActions, actionMetadata, isMyTurn });

    // Simulate a board / custom-UI drag start.
    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    expect(controller.currentAction.value).toBe('place');
    // Drop targets are now visible through the shared board-interaction state.
    expect(boardInteraction.dropTargets.map(t => t.id).sort()).toEqual([100, 101]);
    expect(boardInteraction.isDropTarget({ id: 100 })).toBe(true);
    expect(boardInteraction.isDropTarget({ id: 999 })).toBe(false);
  });

  it('EXISTING SHAPE: dragging an element auto-starts an element->element action and wires targets', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      validElements: [
        { id: 10, display: 'Goblin', ref: { id: 10 } },
        { id: 11, display: 'Orc', ref: { id: 11 } },
      ],
    });
    const metadata: Record<string, ActionMetadata> = {
      attack: {
        name: 'attack',
        selections: [
          { name: 'attacker', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }] },
          { name: 'target', type: 'element' },
        ],
      },
    };
    const { controller, availableActions, actionMetadata, isMyTurn } = makeController(metadata, fetchPickChoices);

    setupDragDropOrchestration({ boardInteraction, actionController: controller, availableActions, actionMetadata, isMyTurn });

    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    expect(controller.currentAction.value).toBe('attack');
    expect(boardInteraction.dropTargets.map(t => t.id).sort()).toEqual([10, 11]);
  });

  it('derives drop targets for the CURRENT pick of an already-in-progress action', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      validElements: [
        { id: 10, display: 'Goblin', ref: { id: 10 } },
        { id: 11, display: 'Orc', ref: { id: 11 } },
      ],
    });
    const metadata: Record<string, ActionMetadata> = {
      attack: {
        name: 'attack',
        selections: [
          { name: 'attacker', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }] },
          { name: 'target', type: 'element' },
        ],
      },
    };
    const { controller, availableActions, actionMetadata, isMyTurn } = makeController(metadata, fetchPickChoices);

    setupDragDropOrchestration({ boardInteraction, actionController: controller, availableActions, actionMetadata, isMyTurn });

    // Start the action first (attacker already chosen); current pick is now 'target'.
    await controller.start('attack', { args: { attacker: 1 } });
    expect(controller.currentPick.value?.name).toBe('target');

    // A drag while the action is in progress should wire the current pick's targets.
    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    expect(boardInteraction.dropTargets.map(t => t.id).sort()).toEqual([10, 11]);
  });

  it('DRAG-TO-SELECT: dragging a valid element for the CURRENT (first) element pick fills it and wires the NEXT pick', async () => {
    // Models demo-animation `dragDrop`: the UI arms the action first (the "Drag &
    // Drop" button calls start() with no args), so the current pick is the FIRST
    // element pick when the drag begins. Dragging one of its valid elements must be
    // treated as SELECTING that element — advancing to the second pick, whose
    // elements become the real drop targets — exactly like the drag-to-start path.
    const fetchPickChoices = vi.fn().mockImplementation((_action: string, selection: string) => {
      if (selection === 'card') {
        return Promise.resolve({
          success: true,
          validElements: [
            { id: 10, display: 'Card 10', ref: { id: 10 } },
            { id: 11, display: 'Card 11', ref: { id: 11 } },
          ],
        });
      }
      // targetZone — boardRef by name (no id), mirroring the demo's zones.
      return Promise.resolve({
        success: true,
        validElements: [
          { id: 20, display: 'Zone A', ref: { name: 'zone-a' } },
          { id: 21, display: 'Zone B', ref: { name: 'zone-b' } },
        ],
      });
    });
    const metadata: Record<string, ActionMetadata> = {
      dragDrop: {
        name: 'dragDrop',
        selections: [
          { name: 'card', type: 'element' },
          { name: 'targetZone', type: 'element' },
        ],
      },
    };
    const { controller, availableActions, actionMetadata, isMyTurn, sendAction } = makeController(metadata, fetchPickChoices);

    setupDragDropOrchestration({ boardInteraction, actionController: controller, availableActions, actionMetadata, isMyTurn });

    // Arm the action (as the "Drag & Drop" button does). Current pick is 'card'.
    await controller.start('dragDrop');
    await flushAll();
    expect(controller.currentPick.value?.name).toBe('card');

    // Drag a valid card: it selects that card, advances to 'targetZone'.
    boardInteraction.startDrag({ id: 10 });
    await flushAll();

    expect(controller.currentPick.value?.name).toBe('targetZone');
    expect(boardInteraction.dropTargets.map(t => t.ref.name).sort()).toEqual(['zone-a', 'zone-b']);
    expect(boardInteraction.isDropTarget({ name: 'zone-a' })).toBe(true);
    expect(boardInteraction.isDropTarget({ name: 'zone-c' })).toBe(false);

    // Dropping on a zone completes the action with both picks filled.
    boardInteraction.triggerDrop({ name: 'zone-a' });
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('dragDrop', { card: 10, targetZone: 20 });
  });

  it('does not wire drop targets when it is not the player\'s turn', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({ success: true, choices: [] });
    const metadata: Record<string, ActionMetadata> = {
      place: {
        name: 'place',
        selections: [
          { name: 'piece', type: 'element', validElements: [{ id: 1, ref: { id: 1 } }] },
          { name: 'dest', type: 'choice' },
        ],
      },
    };
    const { controller, availableActions, actionMetadata, isMyTurn } = makeController(metadata, fetchPickChoices);
    isMyTurn.value = false;

    setupDragDropOrchestration({ boardInteraction, actionController: controller, availableActions, actionMetadata, isMyTurn });

    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    expect(controller.currentAction.value).toBeNull();
    expect(boardInteraction.dropTargets).toEqual([]);
  });
});
