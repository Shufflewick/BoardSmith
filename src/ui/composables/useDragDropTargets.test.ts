/**
 * Tests for generic drag-and-drop target derivation (audit F36).
 *
 * Proves drop targets follow the controller's CURRENT pick for any action shape,
 * through the board's own candidates (#724), with the real controller and bridge.
 *
 * D-01 migration: uses refs: [{ ref, role }] instead of singular targetRef / ref.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  useActionController,
  type EnrichedActionMetadata,
} from './useActionController.js';
import type { EnrichedValidElement } from './useActionControllerTypes.js';
import { setupDragDropOrchestration } from './useDragDropTargets.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import { useBoardActionBridge } from './useBoardActionBridge.js';
import { createMockSendAction } from './useActionController.test-helper.js';

/** Flush Vue's scheduler + the async watcher's awaited start()/fetch chain. */
async function flushAll(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

function makeController(
  metadata: Record<string, EnrichedActionMetadata>,
  fetchPickChoices: ReturnType<typeof vi.fn>,
  sendAction = createMockSendAction(),
) {
  const availableActions = ref<string[]>(Object.keys(metadata));
  const actionMetadata = ref<Record<string, EnrichedActionMetadata> | undefined>(metadata);
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

/** A fetchPickChoices that answers each pick by name, as the server does. */
function answerPicks(answers: Record<string, object>) {
  return vi.fn((_action: string, pick: string) => Promise.resolve({ success: true, ...answers[pick] }));
}

/**
 * The real controller, bridge and orchestration over one board, as GameShell
 * wires them, settled: a sole action is already auto-started, as it is by the
 * time a player can drag.
 */
async function wireAll(
  metadata: Record<string, EnrichedActionMetadata>,
  fetchPickChoices: ReturnType<typeof vi.fn>,
  isMyTurn = true,
) {
  const made = makeController(metadata, fetchPickChoices);
  made.isMyTurn.value = isMyTurn;
  const boardInteraction = createBoardInteraction();
  useBoardActionBridge({
    controller: made.controller, boardInteraction, isMyTurn: made.isMyTurn, autoEndTurn: ref(true),
    actionMetadata: made.actionMetadata, availableActions: made.availableActions,
    disabledActions: ref(undefined), isViewingHistory: ref(false),
    runnerIdentity: ref({ gameInstanceId: 'game-a', restoreEpoch: 0 }),
  });
  setupDragDropOrchestration({
    boardInteraction, actionController: made.controller,
    actionMetadata: made.actionMetadata, isMyTurn: made.isMyTurn,
  });
  await flushAll();
  return { ...made, boardInteraction };
}

describe('setupDragDropOrchestration (shared wiring used by ActionPanel AND custom UIs)', () => {
  it('DRAG-TO-SELECT in an open action: dragging a piece of an element->choice (no filterBy) action wires its destinations', async () => {
    const pieces = [{ id: 1, refs: [{ ref: { id: 1 }, role: 'highlight' as const }] }, { id: 2, refs: [{ ref: { id: 2 }, role: 'highlight' as const }] }];
    const fetchPickChoices = answerPicks({
      piece: { validElements: pieces },
      dest: {
        choices: [
          { value: 'a1', display: 'A1', refs: [{ ref: { id: 100 }, role: 'target' }] },
          { value: 'a2', display: 'A2', refs: [{ ref: { id: 101 }, role: 'target' }] },
        ],
      },
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      place: {
        name: 'place',
        selections: [
          { name: 'piece', type: 'element', validElements: pieces },
          { name: 'dest', type: 'choice' },
        ],
      },
    };
    const { controller, boardInteraction } = await wireAll(metadata, fetchPickChoices);

    // Simulate a board / custom-UI drag start.
    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    expect(controller.currentAction.value).toBe('place');
    // Drop targets are now visible through the shared board-interaction state.
    expect(boardInteraction.dropTargets.map(t => t.id).sort()).toEqual([100, 101]);
    expect(boardInteraction.isDropTarget({ id: 100 })).toBe(true);
    expect(boardInteraction.isDropTarget({ id: 999 })).toBe(false);
  });

  it('DRAG-TO-SELECT in an open action: dragging a piece of an element->element action wires the second pick', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      validElements: [
        { id: 10, display: 'Goblin', refs: [{ ref: { id: 10 }, role: 'highlight' }] },
        { id: 11, display: 'Orc', refs: [{ ref: { id: 11 }, role: 'highlight' }] },
      ],
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      attack: {
        name: 'attack',
        selections: [
          { name: 'attacker', type: 'element', validElements: [{ id: 1, refs: [{ ref: { id: 1 }, role: 'highlight' }] }] },
          { name: 'target', type: 'element' },
        ],
      },
    };
    const { controller, boardInteraction } = await wireAll(metadata, fetchPickChoices);

    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    expect(controller.currentAction.value).toBe('attack');
    expect(boardInteraction.dropTargets.map(t => t.id).sort()).toEqual([10, 11]);
  });

  it('derives drop targets for the CURRENT pick of an already-in-progress action', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      validElements: [
        { id: 10, display: 'Goblin', refs: [{ ref: { id: 10 }, role: 'highlight' }] },
        { id: 11, display: 'Orc', refs: [{ ref: { id: 11 }, role: 'highlight' }] },
      ],
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      attack: {
        name: 'attack',
        selections: [
          { name: 'attacker', type: 'element', validElements: [{ id: 1, refs: [{ ref: { id: 1 }, role: 'highlight' }] }] },
          { name: 'target', type: 'element' },
        ],
      },
    };
    const { controller, boardInteraction } = await wireAll(metadata, fetchPickChoices);

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
            { id: 10, display: 'Card 10', refs: [{ ref: { id: 10 }, role: 'highlight' }] },
            { id: 11, display: 'Card 11', refs: [{ ref: { id: 11 }, role: 'highlight' }] },
          ],
        });
      }
      // targetZone — boardRef by name (no id), mirroring the demo's zones.
      return Promise.resolve({
        success: true,
        validElements: [
          { id: 20, display: 'Zone A', refs: [{ ref: { name: 'zone-a' }, role: 'highlight' }] },
          { id: 21, display: 'Zone B', refs: [{ ref: { name: 'zone-b' }, role: 'highlight' }] },
        ],
      });
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      dragDrop: {
        name: 'dragDrop',
        selections: [
          { name: 'card', type: 'element' },
          { name: 'targetZone', type: 'element' },
        ],
      },
    };
    const { controller, boardInteraction, sendAction } = await wireAll(metadata, fetchPickChoices);

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
    const metadata: Record<string, EnrichedActionMetadata> = {
      place: {
        name: 'place',
        selections: [
          { name: 'piece', type: 'element', validElements: [{ id: 1, refs: [{ ref: { id: 1 }, role: 'highlight' }] }] },
          { name: 'dest', type: 'choice' },
        ],
      },
    };
    const { controller, boardInteraction } = await wireAll(metadata, fetchPickChoices, false);

    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    expect(controller.currentAction.value).toBeNull();
    expect(boardInteraction.dropTargets).toEqual([]);
  });
});

describe('drag-drop follows the board and the action panel (#724)', () => {
  it('drops onto notation-only destination squares (Checkers)', async () => {
    const pieces = [{ id: 42, refs: [{ ref: { notation: 'd4' }, role: 'highlight' as const }] }, { id: 43, refs: [{ ref: { notation: 'f4' }, role: 'highlight' as const }] }];
    const fetchPickChoices = answerPicks({
      piece: { validElements: pieces },
      destination: {
        choices: [
          { value: 'm1', display: 'e5', refs: [{ ref: { notation: 'e5' }, role: 'target' }] },
          { value: 'm2', display: 'c5', refs: [{ ref: { notation: 'c5' }, role: 'target' }] },
        ],
      },
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      move: {
        name: 'move',
        selections: [
          { name: 'piece', type: 'element', validElements: pieces },
          { name: 'destination', type: 'choice' },
        ],
      },
    };
    const { boardInteraction, sendAction } = await wireAll(metadata, fetchPickChoices);

    boardInteraction.startDrag({ id: 42 });
    await flushAll();
    expect(boardInteraction.isDropTarget({ id: 300, notation: 'c5' })).toBe(true);

    boardInteraction.triggerDrop({ id: 300, notation: 'c5' });
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('move', { piece: 42, destination: 'm2' });
  });

  it('a drop onto a multi-select pick toggles it, as a click does', async () => {
    const fetchPickChoices = vi.fn().mockResolvedValue({
      success: true,
      validElements: [
        { id: 20, display: 'Card 20', refs: [{ ref: { id: 20 }, role: 'highlight' }] },
        { id: 21, display: 'Card 21', refs: [{ ref: { id: 21 }, role: 'highlight' }] },
      ],
      multiSelect: { min: 1, max: 2 },
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      stash: { name: 'stash', selections: [{ name: 'cards', type: 'elements', multiSelect: { min: 1, max: 2 } }] },
    };
    const { controller, boardInteraction } = await wireAll(metadata, fetchPickChoices);
    await controller.start('stash');
    await flushAll();

    boardInteraction.startDrag({ id: 99 });
    await flushAll();
    boardInteraction.triggerDrop({ id: 21 });
    await flushAll();
    expect(controller.multiSelectDraft.value).toEqual({ selectionName: 'cards', values: [21] });
  });

  it('a disabled destination is not a drop target', async () => {
    const pieces = [{ id: 1, refs: [{ ref: { id: 1 }, role: 'highlight' as const }] }, { id: 2, refs: [{ ref: { id: 2 }, role: 'highlight' as const }] }];
    const fetchPickChoices = answerPicks({
      piece: { validElements: pieces },
      dest: {
        choices: [
          { value: 'a', display: 'A', refs: [{ ref: { id: 100 }, role: 'target' }] },
          { value: 'b', display: 'B', refs: [{ ref: { id: 101 }, role: 'target' }] },
          { value: 'c', display: 'C', refs: [{ ref: { id: 102 }, role: 'target' }], disabled: 'blocked' },
        ],
      },
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      place: {
        name: 'place',
        selections: [
          { name: 'piece', type: 'element', validElements: pieces },
          { name: 'dest', type: 'choice' },
        ],
      },
    };
    const { boardInteraction } = await wireAll(metadata, fetchPickChoices);

    boardInteraction.startDrag({ id: 1 });
    await flushAll();
    expect(boardInteraction.dropTargets.map(t => t.id).sort()).toEqual([100, 101]);
  });

  /** Two actions, so the bridge opens neither and a drag must start one itself. */
  function twoActions(pieces: EnrichedValidElement[]) {
    const fetchPickChoices = answerPicks({
      piece: { validElements: pieces },
      dest: {
        choices: [
          { value: 'a', display: 'A', refs: [{ ref: { id: 100 }, role: 'target' }] },
          { value: 'b', display: 'B', refs: [{ ref: { id: 101 }, role: 'target' }] },
        ],
      },
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      move: { name: 'move', selections: [{ name: 'piece', type: 'element' }, { name: 'dest', type: 'choice' }] },
      pass: { name: 'pass', selections: [] },
    };
    return wireAll(metadata, fetchPickChoices);
  }

  it('DRAG-TO-START: dragging an enabled piece starts the action and wires the next pick', async () => {
    const { controller, boardInteraction, sendAction } = await twoActions([
      { id: 1, disabled: 'pinned', refs: [{ ref: { id: 1 }, role: 'highlight' }] },
      { id: 2, refs: [{ ref: { id: 2 }, role: 'highlight' }] },
    ]);
    expect(controller.currentAction.value).toBeNull();

    boardInteraction.startDrag({ id: 2 });
    await flushAll();
    expect(controller.currentAction.value).toBe('move');
    expect(boardInteraction.dropTargets.map(t => t.id).sort()).toEqual([100, 101]);

    boardInteraction.triggerDrop({ id: 101 });
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('move', { piece: 2, dest: 'b' });
  });

  it('DRAG-TO-START: a drag matched by notation starts the action with the matched piece, as a click does', async () => {
    const { controller, boardInteraction, sendAction } = await twoActions([
      { id: 42, refs: [{ ref: { notation: 'd4' }, role: 'highlight' }] },
      { id: 43, refs: [{ ref: { notation: 'f4' }, role: 'highlight' }] },
    ]);

    boardInteraction.startDrag({ notation: 'd4' });
    await flushAll();
    expect(controller.currentArgs.value).toEqual({ piece: 42 });

    boardInteraction.triggerDrop({ id: 100 });
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('move', { piece: 42, dest: 'a' });
  });

  it('DRAG-TO-START: a name-only drag starts the action with the candidate anchored by that name (#945)', async () => {
    const { controller, boardInteraction, sendAction } = await twoActions([
      { id: 42, refs: [{ ref: { name: 'Squad A' }, role: 'highlight' }] },
      { id: 43, refs: [{ ref: { name: 'Squad B' }, role: 'highlight' }] },
    ]);

    boardInteraction.startDrag({ name: 'Squad B' });
    await flushAll();
    expect(controller.currentArgs.value).toEqual({ piece: 43 });

    boardInteraction.triggerDrop({ id: 100 });
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('move', { piece: 43, dest: 'a' });
  });

  it('dragging from the square a candidate is anchored to picks that candidate and a drop completes the move (#943)', async () => {
    const pieces = [{ id: 42, refs: [{ ref: { notation: 'd4' }, role: 'highlight' as const }] }, { id: 43, refs: [{ ref: { notation: 'f4' }, role: 'highlight' as const }] }];
    const fetchPickChoices = answerPicks({
      piece: { validElements: pieces },
      destination: {
        choices: [
          { value: 'm1', display: 'e5', refs: [{ ref: { notation: 'e5' }, role: 'target' }] },
          { value: 'm2', display: 'c5', refs: [{ ref: { notation: 'c5' }, role: 'target' }] },
        ],
      },
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      move: { name: 'move', selections: [{ name: 'piece', type: 'element', validElements: pieces }, { name: 'destination', type: 'choice' }] },
    };
    const { controller, boardInteraction, sendAction } = await wireAll(metadata, fetchPickChoices);
    expect(controller.currentPick.value?.name).toBe('piece');

    // The piece on d4 is dragged on behalf of its square, so the drag carries the square.
    boardInteraction.startDrag({ id: 300, name: 'd4', notation: 'd4' });
    await flushAll();
    expect(controller.currentArgs.value).toEqual({ piece: 42 });

    boardInteraction.triggerDrop({ id: 301, name: 'c5', notation: 'c5' });
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('move', { piece: 42, destination: 'm2' });
  });

  it('dragging a disabled candidate of the open pick starts no drag, as a click on it chooses nothing (#1190)', async () => {
    const pieces = [
      { id: 42, disabled: 'blocked', refs: [{ ref: { notation: 'd4' }, role: 'highlight' as const }] },
      { id: 43, refs: [{ ref: { notation: 'f4' }, role: 'highlight' as const }] },
      { id: 44, refs: [{ ref: { notation: 'h4' }, role: 'highlight' as const }] },
    ];
    const fetchPickChoices = answerPicks({ piece: { validElements: pieces } });
    const metadata: Record<string, EnrichedActionMetadata> = {
      move: { name: 'move', selections: [{ name: 'piece', type: 'element', validElements: pieces }, { name: 'destination', type: 'choice' }] },
    };
    const { controller, boardInteraction, sendAction } = await wireAll(metadata, fetchPickChoices);
    expect(controller.currentPick.value?.name).toBe('piece');

    boardInteraction.startDrag({ id: 300, name: 'd4', notation: 'd4' });
    await flushAll();
    expect(boardInteraction.isDragging).toBe(false);
    expect(boardInteraction.isDropTarget({ notation: 'f4' })).toBe(false);

    boardInteraction.triggerDrop({ id: 301, name: 'f4', notation: 'f4' });
    await flushAll();
    expect(controller.currentArgs.value).toEqual({});
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('dragging a disabled element starts no action', async () => {
    const { controller, boardInteraction } = await twoActions([
      { id: 1, disabled: 'pinned', refs: [{ ref: { id: 1 }, role: 'highlight' }] },
      { id: 2, refs: [{ ref: { id: 2 }, role: 'highlight' }] },
    ]);

    boardInteraction.startDrag({ id: 1 });
    await flushAll();
    expect(controller.currentAction.value).toBeNull();
  });

  it('dragging an element no action can start with starts nothing', async () => {
    const { controller, boardInteraction } = await twoActions([{ id: 2, refs: [{ ref: { id: 2 }, role: 'highlight' }] }]);

    boardInteraction.startDrag({ id: 7 });
    await flushAll();
    expect(controller.currentAction.value).toBeNull();
  });
});

// The server's metadata never lists an element pick's candidates, so with
// several actions on offer and none open the board must ask for them (#1192).
describe('a turn that offers several actions and opens none, as Chess does (#1192)', () => {
  const pieces = [
    { id: 42, refs: [{ ref: { notation: 'd2' }, role: 'highlight' as const }] },
    { id: 43, refs: [{ ref: { notation: 'e2' }, role: 'highlight' as const }] },
  ];

  async function chess() {
    const fetchPickChoices = answerPicks({
      piece: { validElements: pieces },
      destination: {
        choices: [
          { value: 'e3', display: 'e3', refs: [{ ref: { notation: 'e3' }, role: 'target' }] },
          { value: 'e4', display: 'e4', refs: [{ ref: { notation: 'e4' }, role: 'target' }] },
        ],
      },
    });
    const metadata: Record<string, EnrichedActionMetadata> = {
      movePiece: { name: 'movePiece', selections: [{ name: 'piece', type: 'element' }, { name: 'destination', type: 'choice' }] },
      resign: { name: 'resign', selections: [] },
      offerDraw: { name: 'offerDraw', selections: [] },
    };
    return { ...(await wireAll(metadata, fetchPickChoices)), fetchPickChoices };
  }

  it('offers on the board the pieces movePiece can start with', async () => {
    const { controller, boardInteraction } = await chess();
    expect(controller.currentAction.value).toBeNull();
    expect(boardInteraction.isSelectableElement({ id: 300, notation: 'd2' })).toBe(true);
    expect(boardInteraction.isSelectableElement({ id: 302, notation: 'a2' })).toBe(false);
  });

  it('clicking a piece starts movePiece with that piece', async () => {
    const { controller, boardInteraction } = await chess();

    boardInteraction.triggerElementSelect({ id: 300, notation: 'd2' });
    await flushAll();
    expect(controller.currentAction.value).toBe('movePiece');
    expect(controller.currentArgs.value).toEqual({ piece: 42 });
  });

  it('dragging a piece starts movePiece with that piece, and a drop completes the move', async () => {
    const { boardInteraction, sendAction } = await chess();

    boardInteraction.startDrag({ id: 301, notation: 'e2' });
    await flushAll();
    boardInteraction.triggerDrop({ id: 310, notation: 'e4' });
    await flushAll();
    expect(sendAction).toHaveBeenCalledWith('movePiece', { piece: 43, destination: 'e4' });
  });

  it('offers an element by the action that can start with it, when an earlier action disables it', async () => {
    const fetchPickChoices = answerPicks({
      piece: { validElements: [{ id: 42, disabled: 'pinned', refs: [{ ref: { id: 42 }, role: 'highlight' }] }] },
      subject: { validElements: [{ id: 42, refs: [{ ref: { id: 42 }, role: 'highlight' }] }] },
    });
    const { controller, boardInteraction } = await wireAll({
      movePiece: { name: 'movePiece', selections: [{ name: 'piece', type: 'element' }, { name: 'destination', type: 'choice' }] },
      inspect: { name: 'inspect', selections: [{ name: 'subject', type: 'element' }, { name: 'detail', type: 'choice' }] },
    }, fetchPickChoices);

    boardInteraction.triggerElementSelect({ id: 42 });
    await flushAll();
    expect(controller.currentAction.value).toBe('inspect');
    expect(controller.currentArgs.value).toEqual({ subject: 42 });
  });

  it('offers nothing from an earlier state while the new state\'s candidates are on their way', async () => {
    const { boardInteraction, actionMetadata, fetchPickChoices } = await chess();
    expect(boardInteraction.isSelectableElement({ id: 300, notation: 'd2' })).toBe(true);
    fetchPickChoices.mockImplementation(() => new Promise(() => {}));

    actionMetadata.value = { ...actionMetadata.value! };
    await flushAll();
    expect(boardInteraction.isSelectableElement({ id: 300, notation: 'd2' })).toBe(false);
  });

  it('offers nothing on the board on another seat\'s turn', async () => {
    const fetchPickChoices = answerPicks({ piece: { validElements: pieces } });
    const { boardInteraction } = await wireAll({
      movePiece: { name: 'movePiece', selections: [{ name: 'piece', type: 'element' }, { name: 'destination', type: 'choice' }] },
      resign: { name: 'resign', selections: [] },
    }, fetchPickChoices, false);
    expect(boardInteraction.isSelectableElement({ id: 300, notation: 'd2' })).toBe(false);
  });
});

describe('the no-drop-targets warning (#1299)', () => {
  it('states the rule the board uses for a choice: the ref with role target, else the first ref', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pieces = [{ id: 1, refs: [{ ref: { id: 1 }, role: 'highlight' as const }] }, { id: 2, refs: [{ ref: { id: 2 }, role: 'highlight' as const }] }];
    const fetchPickChoices = answerPicks({
      piece: { validElements: pieces },
      dest: { choices: [{ value: 'a1', display: 'A1' }, { value: 'a2', display: 'A2' }] },
    });
    const { boardInteraction } = await wireAll({
      place: { name: 'place', selections: [{ name: 'piece', type: 'element', validElements: pieces }, { name: 'dest', type: 'choice' }] },
    }, fetchPickChoices);

    boardInteraction.startDrag({ id: 1 });
    await flushAll();

    const message = warn.mock.calls.map((call) => String(call[0])).find((text) => text.includes('no drop targets'));
    expect(message).toContain("the ref with role 'target', else the first ref");
    expect(message).not.toContain("refs with role 'target'");
    warn.mockRestore();
  });
});
