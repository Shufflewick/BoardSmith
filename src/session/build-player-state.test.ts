import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type FlowContext,
} from '../engine/index.js';
import { createPlayerView } from '../engine/utils/snapshot.js';
import { GameRunner } from '../runtime/runner.js';
import { GameSession } from './game-session.js';
import { TutorialController } from './tutorial-controller.js';
import { buildPlayerState } from './utils.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';
import { useActionController, type ActionMetadata } from '../ui/composables/useActionController.js';

// Test game classes
class TestGame extends Game<TestGame, Player> {
  board!: Board;
  hands!: Hand[];

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    this.registerElements([Card, Hand, Board]);

    // Create board
    this.board = this.create(Board, 'board');

    // Create per-player hands with visibility
    this.hands = [];
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      this.hands.push(hand);
    }

    // Put a card in each player's hand so we can test per-player visibility
    for (const [i, hand] of this.hands.entries()) {
      hand.create(Card, `secret-${i + 1}`, { value: (i + 1) * 10 });
    }

    // Register actions

    // Action that triggers a single animation event
    const animateAction = Action.create('strike')
      .prompt('Strike')
      .execute((_args, ctx) => {
        ctx.game.animate('combat', { damage: 5 });
      });

    // Action that triggers multiple animation events
    const multiAnimateAction = Action.create('combo')
      .prompt('Combo')
      .execute((_args, ctx) => {
        ctx.game.animate('slash', { target: 'a' });
        ctx.game.animate('thrust', { target: 'b' });
        ctx.game.animate('finisher', { target: 'c' });
      });

    // Action with no animation
    const passAction = Action.create('pass')
      .prompt('Pass turn')
      .execute(() => {});

    this.registerActions(animateAction, multiAnimateAction, passAction);

    // Set up flow
    const gameFlow = defineFlow({
      root: loop({
        while: (ctx: FlowContext) => (ctx.get<number>('round') ?? 1) <= 3,
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({
            actions: ['strike', 'combo', 'pass'],
          }),
        }),
      }),
      setup: (ctx) => ctx.set('round', 1),
    });
    this.setFlow(gameFlow);
  }
}

class Card extends Piece<TestGame> {
  value!: number;
}

class Hand extends Space<TestGame> {}
class Board extends Space<TestGame> {}

describe('buildPlayerState - single truth view (SES-01)', () => {
  let runner: GameRunner<TestGame>;

  beforeEach(() => {
    runner = new GameRunner({
      GameClass: TestGame,
      gameType: 'test-game',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
    });
    runner.start();
  });

  it('returns view field with truth state and no currentView field', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    // view field exists and contains state
    expect(state.view).toBeDefined();
    expect(typeof state.view).toBe('object');

    // No currentView field (theatre split removed in Phase 85)
    expect('currentView' in state).toBe(false);

    // view matches what runner.getPlayerView returns
    const directView = runner.getPlayerView(1).state;
    expect(state.view).toEqual(directView);
  });

  it('preserves per-player visibility filtering', () => {
    const stateP1 = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const stateP2 = buildPlayerState(runner, ['Alice', 'Bob'], 2);

    // Each player should see different views (hidden hands)
    expect(stateP1.view).not.toEqual(stateP2.view);
  });
});

describe('buildPlayerState - availableActions scoped to current player', () => {
  let runner: GameRunner<TestGame>;

  beforeEach(() => {
    runner = new GameRunner({
      GameClass: TestGame,
      gameType: 'test-game',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
    });
    runner.start();
  });

  it('current player sees available actions', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    expect(state.isMyTurn).toBe(true);
    expect(state.availableActions).toBeDefined();
    expect(state.availableActions!.length).toBeGreaterThan(0);
  });

  it('non-current player sees empty available actions', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 2);
    expect(state.isMyTurn).toBe(false);
    expect(state.availableActions).toEqual([]);
  });

  it('non-current player gets no action metadata even when requested', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 2, { includeActionMetadata: true });
    expect(state.isMyTurn).toBe(false);
    expect(state.availableActions).toEqual([]);
    expect(state.actionMetadata).toBeUndefined();
  });
});

describe('buildPlayerState - animation events (SES-02)', () => {
  let runner: GameRunner<TestGame>;

  beforeEach(() => {
    runner = new GameRunner({
      GameClass: TestGame,
      gameType: 'test-game',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
    });
    runner.start();
  });

  it('includes animationEvents when game has pending events', () => {
    // Perform an action that triggers game.animate()
    runner.performAction('strike', 1, {});

    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    expect(state.animationEvents).toBeDefined();
    expect(state.animationEvents!.length).toBeGreaterThan(0);
    expect(state.animationEvents![0].type).toBe('combat');
    expect(state.lastAnimationEventId).toBe(state.animationEvents![state.animationEvents!.length - 1].id);
  });

  it('omits animationEvents when buffer is empty', () => {
    // No action performed -- buffer is empty
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    expect(state.animationEvents).toBeUndefined();
    expect(state.lastAnimationEventId).toBeUndefined();
  });

  it('includes all animation events from a single action', () => {
    // Perform an action that triggers 3 animate() calls
    runner.performAction('combo', 1, {});

    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    expect(state.animationEvents).toHaveLength(3);
    expect(state.animationEvents![0].id).toBe(1);
    expect(state.animationEvents![1].id).toBe(2);
    expect(state.animationEvents![2].id).toBe(3);
    expect(state.lastAnimationEventId).toBe(3);
  });
});

// ============================================
// Tutorial test game for parity + cross-layer tests
// ============================================

class TutorialParityGame extends Game<TutorialParityGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);
    this.registerElements([ParitySpace]);

    const moveAction = Action.create('move')
      .prompt('Move a piece')
      .chooseFrom('piece', { choices: ['a', 'b', 'c'] })
      .execute(() => {});

    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute(() => {});

    this.registerActions(moveAction, passAction);

    const flow = defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 20,
        do: eachPlayer({
          do: actionStep({ actions: ['move', 'pass'] }),
        }),
      }),
    });
    this.setFlow(flow);
  }
}

class ParitySpace extends Space<TutorialParityGame> {}

const PARITY_TUTORIAL: TutorialDefinition = {
  steps: [
    { id: 'intro', gate: { action: 'move' }, suppressAutoFill: true },
    { id: 'next', gate: { action: 'pass' } },
  ],
};

const SUPPRESS_TUTORIAL: TutorialDefinition = {
  steps: [
    { id: 'teach-move', gate: { action: 'move' }, suppressAutoFill: true },
  ],
};

// ============================================
// Parity tests: buildPlayerState vs createPlayerView
// ============================================

describe('tutorial projection parity (buildPlayerState vs createPlayerView)', () => {
  let runner: GameRunner<TutorialParityGame>;
  let controller: TutorialController<TutorialParityGame>;

  beforeEach(() => {
    runner = new GameRunner<TutorialParityGame>({
      GameClass: TutorialParityGame,
      gameType: 'parity-test',
      gameOptions: {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'parity',
        tutorial: PARITY_TUTORIAL,
      },
    });
    runner.start();
    controller = new TutorialController(() => runner, { broadcast: vi.fn() });
  });

  it('omits tutorial + disabledActions when no tutorial running', () => {
    // No tutorial started — both projections omit tutorial fields
    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const psv = createPlayerView(runner.game, 1);

    expect(pgs.tutorial).toBeUndefined();
    expect(pgs.disabledActions).toBeUndefined();
    expect(psv.tutorial).toBeUndefined();
    expect(psv.disabledActions).toBeUndefined();
  });

  it('both projections surface identical tutorial + disabledActions when running', () => {
    controller.start(1); // step: 'intro', suppressAutoFill: true, gate.action: 'move'

    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const psv = createPlayerView(runner.game, 1);

    // tutorial fields match
    expect(pgs.tutorial).toBeDefined();
    expect(psv.tutorial).toBeDefined();
    expect(pgs.tutorial).toEqual(psv.tutorial);

    // disabledActions fields match
    expect(pgs.disabledActions).toBeDefined();
    expect(psv.disabledActions).toBeDefined();
    expect(pgs.disabledActions).toEqual(psv.disabledActions);
  });

  it('tutorial field carries stepId and suppressAutoFill from the step', () => {
    controller.start(1);

    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    expect(pgs.tutorial?.stepId).toBe('intro');
    expect(pgs.tutorial?.suppressAutoFill).toBe(true);
  });

  it('disabledActions names actions gated by the step', () => {
    controller.start(1); // gate.action = 'move', so 'pass' is gated

    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    // 'pass' is blocked because the gate only allows 'move'
    expect(pgs.disabledActions?.['pass']).toBeDefined();
    // 'move' is not blocked (it's the allowed action)
    expect(pgs.disabledActions?.['move']).toBeUndefined();
  });

  it('omits tutorial for seat 2 when only seat 1 has started', () => {
    controller.start(1);

    const pgs2 = buildPlayerState(runner, ['Alice', 'Bob'], 2);
    const psv2 = createPlayerView(runner.game, 2);

    expect(pgs2.tutorial).toBeUndefined();
    expect(psv2.tutorial).toBeUndefined();
  });

  it('omits tutorial + disabledActions for spectator (position 0)', () => {
    controller.start(1);

    const pgs0 = buildPlayerState(runner, ['Alice', 'Bob'], 0);

    expect(pgs0.tutorial).toBeUndefined();
    expect(pgs0.disabledActions).toBeUndefined();

    // createPlayerView spectator (position 0) - parity
    const psv0 = createPlayerView(runner.game, 0);
    expect(psv0.tutorial).toBeUndefined();
    expect(psv0.disabledActions).toBeUndefined();
  });

  it('tutorial absent after exit (status exited)', () => {
    controller.start(1);
    controller.exit(1);

    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const psv = createPlayerView(runner.game, 1);

    expect(pgs.tutorial).toBeUndefined();
    expect(psv.tutorial).toBeUndefined();
  });

  it('tutorial absent after completion (status completed)', () => {
    controller.start(1);
    controller.advance(1); // intro → next
    controller.advance(1); // next → completed

    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const psv = createPlayerView(runner.game, 1);

    expect(pgs.tutorial).toBeUndefined();
    expect(psv.tutorial).toBeUndefined();
  });

  it('parity holds across step advance', () => {
    controller.start(1);
    controller.advance(1); // intro → next (gate.action: 'pass')

    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const psv = createPlayerView(runner.game, 1);

    expect(pgs.tutorial).toEqual(psv.tutorial);
    expect(pgs.disabledActions).toEqual(psv.disabledActions);
    expect(pgs.tutorial?.stepId).toBe('next');
  });
});

// ============================================
// Cross-layer integration: engine → controller → projection + undo lockstep
// ============================================

describe('cross-layer integration: engine progress → controller → projection', () => {
  let session: GameSession<TutorialParityGame>;

  beforeEach(() => {
    session = GameSession.create({
      gameType: 'parity-test',
      GameClass: TutorialParityGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'cross-layer',
      tutorial: PARITY_TUTORIAL,
    });
  });

  it('startTutorial → projection shows step + gated action reason', async () => {
    session.startTutorial(1);

    const state = session.buildPlayerState(1);

    expect(state?.tutorial?.stepId).toBe('intro');
    // 'pass' should be in disabledActions (gated by current step that requires 'move')
    expect(state?.disabledActions?.['pass']).toBeDefined();
  });

  it('rewind rewinds the active step in lockstep (tutorialProgress is serialized state)', async () => {
    session.startTutorial(1);

    // Verify step is 'intro'
    expect(session.buildPlayerState(1)?.tutorial?.stepId).toBe('intro');

    // Player performs an action (captured in action history as index 0)
    const result = await session.performAction('move', 1, { piece: 'a' });
    expect(result.success).toBe(true);

    // Controller advances after the action — step moves to 'next'
    // The checkpoint at index 1 now has step 'next' in tutorialProgress
    session.advanceTutorial(1);
    expect(session.buildPlayerState(1)?.tutorial?.stepId).toBe('next');

    // Rewind to before action 0 (i.e., action index 0 = state before first player action).
    // tutorialProgress is serialized with game state, so it rewinds to 'intro'.
    const rewindResult = await session.rewindToAction(0);
    expect(rewindResult.success).toBe(true);

    // After rewind, the active step reverts to 'intro'
    expect(session.buildPlayerState(1)?.tutorial?.stepId).toBe('intro');
  });

  it('gating is inert after exit — all available actions enabled', async () => {
    session.startTutorial(1);
    session.exitTutorial(1);

    const state = session.buildPlayerState(1);
    expect(state?.tutorial).toBeUndefined();
    expect(state?.disabledActions).toBeUndefined();
  });
});

// ============================================
// End-to-end suppressAutoFill trace:
// Drives real useActionController from actual buildPlayerState projection
// ============================================

describe('end-to-end suppressAutoFill: buildPlayerState projection → useActionController', () => {
  it('auto-fill is suppressed when the projection carries suppressAutoFill:true', async () => {
    // Build a real runner with a suppressAutoFill tutorial step
    const runner = new GameRunner<TutorialParityGame>({
      GameClass: TutorialParityGame,
      gameType: 'suppress-test',
      gameOptions: {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'suppress',
        tutorial: SUPPRESS_TUTORIAL,
      },
    });
    runner.start();

    // Start tutorial so the step is active
    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });
    controller.start(1);

    // Get the REAL buildPlayerState projection (not a hand-authored literal)
    const pgs = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    // Verify the projection carries suppressAutoFill from the step
    expect(pgs.tutorial?.suppressAutoFill).toBe(true);
    expect(pgs.tutorial?.stepId).toBe('teach-move');

    // Wire the real projection into useActionController (the UI layer)
    const tutorialStep = ref(pgs.tutorial);
    const fetchChoices = vi.fn().mockResolvedValue({
      success: true,
      choices: [{ value: 'a', display: 'A' }], // single enabled choice = would auto-fill
    });

    const actionMeta: ActionMetadata = {
      name: 'move',
      prompt: 'Move a piece',
      selections: [
        {
          name: 'piece',
          type: 'choice',
          prompt: 'Select a piece',
          choices: [{ value: 'a', display: 'A' }],
        },
      ],
    };

    const controller2 = useActionController({
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      availableActions: ref(['move']),
      actionMetadata: ref({ move: actionMeta }),
      isMyTurn: ref(true),
      autoExecute: false,
      playerSeat: ref(1),
      fetchPickChoices: fetchChoices,
      tutorialStep,
    });

    // Start the action (triggers fetchAndAutoFill path)
    await controller2.start('move');
    await nextTick();

    // The 'piece' selection has exactly ONE enabled choice ('a'), but the tutorial
    // step has suppressAutoFill:true — so auto-fill must NOT fire.
    // currentArgs should NOT contain 'piece' (if auto-fill fired, it would)
    const currentArgs = controller2.currentArgs.value;
    expect(currentArgs['piece']).toBeUndefined();
  });

  it('auto-fill fires normally when no tutorial step is active', async () => {
    // Same setup but WITHOUT tutorialStep — auto-fill should resolve
    const fetchChoices = vi.fn().mockResolvedValue({
      success: true,
      choices: [{ value: 'a', display: 'A' }],
    });

    const actionMeta: ActionMetadata = {
      name: 'move',
      prompt: 'Move a piece',
      selections: [
        {
          name: 'piece',
          type: 'choice',
          prompt: 'Select a piece',
          choices: [{ value: 'a', display: 'A' }],
        },
      ],
    };

    const controller = useActionController({
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      availableActions: ref(['move']),
      actionMetadata: ref({ move: actionMeta }),
      isMyTurn: ref(true),
      autoExecute: false,
      playerSeat: ref(1),
      fetchPickChoices: fetchChoices,
      // No tutorialStep → auto-fill is not suppressed
    });

    await controller.start('move');
    await nextTick();

    // Without suppressAutoFill, the single choice should auto-fill
    const currentArgs = controller.currentArgs.value;
    expect(currentArgs['piece']).toBe('a');
  });
});
