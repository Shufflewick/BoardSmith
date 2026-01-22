import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  FlowEngine,
  sequence,
  loop,
  repeat,
  eachPlayer,
  forEach,
  actionStep,
  playerActions,
  switchOn,
  ifThen,
  defineFlow,
  execute,
  setVar,
  noop,
  phase,
  TurnOrder,
  turnLoop,
} from '../index.js';
import type { FlowContext, FlowDefinition } from '../index.js';

// Test classes
class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
  value!: number;
}

class Hand extends Space<TestGame> {}
class Deck extends Space<TestGame> {}

describe('Flow Builders', () => {
  it('should create sequence node', () => {
    const node = sequence(noop(), noop());
    expect(node.type).toBe('sequence');
    expect(node.config.steps).toHaveLength(2);
  });

  it('should create loop node', () => {
    const node = loop({
      while: () => true,
      do: noop(),
    });
    expect(node.type).toBe('loop');
  });

  it('should create repeat node', () => {
    const node = repeat(3, noop());
    expect(node.type).toBe('loop');
  });

  it('should create eachPlayer node', () => {
    const node = eachPlayer({
      do: noop(),
    });
    expect(node.type).toBe('each-player');
  });

  it('should create forEach node', () => {
    const node = forEach({
      collection: [1, 2, 3],
      as: 'item',
      do: noop(),
    });
    expect(node.type).toBe('for-each');
  });

  it('should create actionStep node', () => {
    const node = actionStep({
      actions: ['test'],
      prompt: 'Do something',
    });
    expect(node.type).toBe('action-step');
  });

  it('should create switch node', () => {
    const node = switchOn({
      on: () => 'a',
      cases: {
        a: noop(),
        b: noop(),
      },
    });
    expect(node.type).toBe('switch');
  });

  it('should create if node', () => {
    const node = ifThen({
      condition: () => true,
      then: noop(),
      else: noop(),
    });
    expect(node.type).toBe('if');
  });

  it('should create flow definition', () => {
    const flow = defineFlow({
      root: noop(),
      isComplete: () => false,
    });
    expect(flow.root).toBeDefined();
    expect(flow.isComplete).toBeDefined();
  });

  it('should create turnLoop node', () => {
    const node = turnLoop({
      actions: ['move', 'attack', 'endTurn'],
    });
    expect(node.type).toBe('loop');
  });

  it('should create turnLoop with while condition', () => {
    const node = turnLoop({
      name: 'action-loop',
      actions: ['move', 'attack'],
      while: () => true,
      maxIterations: 50,
    });
    expect(node.type).toBe('loop');
    expect(node.config.name).toBe('action-loop');
    expect(node.config.maxIterations).toBe(50);
  });
});

describe('FlowEngine', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });
  });

  describe('Basic Execution', () => {
    it('should complete empty sequence immediately', () => {
      const flow = defineFlow({
        root: sequence(),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.complete).toBe(true);
      expect(state.awaitingInput).toBe(false);
    });

    it('should run setup function', () => {
      let setupCalled = false;

      const flow = defineFlow({
        setup: () => {
          setupCalled = true;
        },
        root: sequence(),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(setupCalled).toBe(true);
    });

    it('should complete when isComplete returns true', () => {
      let iterations = 0;

      const flow = defineFlow({
        root: loop({
          while: () => true,
          do: execute(() => {
            iterations++;
          }),
        }),
        isComplete: () => iterations >= 5,
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.complete).toBe(true);
      expect(iterations).toBe(5);
    });
  });

  describe('Loop Execution', () => {
    it('should execute loop while condition is true', () => {
      let count = 0;

      const flow = defineFlow({
        root: loop({
          while: () => count < 3,
          do: execute(() => {
            count++;
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(count).toBe(3);
    });

    it('should respect maxIterations', () => {
      let count = 0;

      const flow = defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 5,
          do: execute(() => {
            count++;
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(count).toBe(5);
    });

    it('should execute repeat fixed times', () => {
      let count = 0;

      const flow = defineFlow({
        root: repeat(
          4,
          execute(() => {
            count++;
          })
        ),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(count).toBe(4);
    });
  });

  describe('EachPlayer Execution', () => {
    it('should iterate through all players', () => {
      const visitedPlayers: number[] = [];

      const flow = defineFlow({
        root: eachPlayer({
          name: 'player',
          do: execute((ctx) => {
            visitedPlayers.push(ctx.player!.seat);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(visitedPlayers).toEqual([1, 2, 3]);
    });

    it('should filter players', () => {
      const visitedPlayers: number[] = [];

      const flow = defineFlow({
        root: eachPlayer({
          filter: (p) => p.seat !== 2,  // Skip player at seat 2
          do: execute((ctx) => {
            visitedPlayers.push(ctx.player!.seat);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(visitedPlayers).toEqual([1, 3]);  // Positions 1 and 3, skipping 2
    });

    it('should iterate backward', () => {
      const visitedPlayers: number[] = [];

      const flow = defineFlow({
        root: eachPlayer({
          direction: 'backward',
          do: execute((ctx) => {
            visitedPlayers.push(ctx.player!.seat);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(visitedPlayers).toEqual([3, 2, 1]);
    });
  });

  describe('ForEach Execution', () => {
    it('should iterate through collection', () => {
      const items: number[] = [];

      const flow = defineFlow({
        root: forEach({
          collection: [10, 20, 30],
          as: 'num',
          do: execute((ctx) => {
            items.push(ctx.get('num') as number);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(items).toEqual([10, 20, 30]);
    });

    it('should use dynamic collection', () => {
      const deck = game.create(Deck, 'deck');
      deck.createMany(3, Card, 'card', (i) => ({
        suit: 'H',
        rank: String(i + 1),
        value: i + 1,
      }));

      const cardNames: string[] = [];

      const flow = defineFlow({
        root: forEach({
          collection: (ctx) => [...ctx.game.all(Card)],
          as: 'card',
          do: execute((ctx) => {
            cardNames.push((ctx.get('card') as Card).name);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(cardNames).toHaveLength(3);
    });
  });

  describe('Variables', () => {
    it('should set and get variables', () => {
      let finalValue: number | undefined;

      const flow = defineFlow({
        root: sequence(
          setVar('counter', 0),
          setVar('counter', (ctx) => (ctx.get('counter') as number) + 1),
          setVar('counter', (ctx) => (ctx.get('counter') as number) + 10),
          execute((ctx) => {
            finalValue = ctx.get('counter') as number;
          })
        ),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(finalValue).toBe(11);
    });
  });

  describe('Conditionals', () => {
    it('should execute then branch when condition is true', () => {
      let branch = '';

      const flow = defineFlow({
        root: ifThen({
          condition: () => {
            branch = 'then'; // Set directly in condition
            return true;
          },
          then: sequence(), // Empty sequence
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(branch).toBe('then');
    });

    it('should execute else branch when condition is false', () => {
      const flow = defineFlow({
        root: ifThen({
          condition: () => false,
          then: sequence(),
          else: setVar('test', 'else'),
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.position.variables.test).toBe('else');
    });

    it('should handle switch cases', () => {
      const flow = defineFlow({
        root: switchOn({
          on: () => 'b',
          cases: {
            a: setVar('result', 'case-a'),
            b: setVar('result', 'case-b'),
            c: setVar('result', 'case-c'),
          },
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.position.variables.result).toBe('case-b');
    });

    it('should use switch default case', () => {
      const flow = defineFlow({
        root: switchOn({
          on: () => 'x',
          cases: {
            a: setVar('result', 'case-a'),
          },
          default: setVar('result', 'default'),
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.position.variables.result).toBe('default');
    });
  });

  describe('ActionStep', () => {
    beforeEach(() => {
      // Register a test action
      const testAction = Action.create('test')
        .chooseFrom('choice', { choices: ['a', 'b', 'c'] })
        .execute((args) => {
          return { success: true, data: { choice: args.choice } };
        });

      game.registerAction(testAction);
    });

    it('should pause for player action', () => {
      const flow = defineFlow({
        root: actionStep({
          actions: ['test'],
          prompt: 'Make a choice',
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.awaitingInput).toBe(true);
      expect(state.availableActions).toContain('test');
      expect(state.currentPlayer).toBe(1);
    });

    it('should resume after action', () => {
      let afterAction = false;

      const flow = defineFlow({
        root: sequence(
          actionStep({
            actions: ['test'],
          }),
          execute(() => {
            afterAction = true;
          })
        ),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();

      expect(state.awaitingInput).toBe(true);

      state = engine.resume('test', { choice: 'a' });

      expect(state.awaitingInput).toBe(false);
      expect(afterAction).toBe(true);
    });

    it('should skip if condition is met', () => {
      let actionReached = false;

      const flow = defineFlow({
        root: actionStep({
          actions: ['test'],
          skipIf: () => true,
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.awaitingInput).toBe(false);
      expect(state.complete).toBe(true);
    });

    it('should repeat until condition', () => {
      let actionCount = 0;

      const flow = defineFlow({
        root: sequence(
          setVar('count', 0),
          actionStep({
            actions: ['test'],
            repeatUntil: (ctx) => (ctx.get('count') as number) >= 2,
          })
        ),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();

      // First action
      expect(state.awaitingInput).toBe(true);
      state = engine.resume('test', { choice: 'a' });

      // Still awaiting because count < 2
      expect(state.awaitingInput).toBe(true);

      // Set count manually via action side effect
      // For this test, we'll just continue twice
      state = engine.resume('test', { choice: 'b' });

      // Should continue until repeatUntil evaluates
    });
  });

  describe('State Serialization', () => {
    it('should serialize flow position', () => {
      const flow = defineFlow({
        root: sequence(
          setVar('step', 1),
          actionStep({ actions: ['test'] }),
          setVar('step', 2),
        ),
      });

      // Register action
      game.registerAction(
        Action.create('test')
          .execute(() => ({ success: true }))
      );

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.position).toBeDefined();
      expect(state.position.path).toBeInstanceOf(Array);
      expect(state.position.variables).toBeDefined();
    });

    it('should include variables in position', () => {
      const flow = defineFlow({
        root: sequence(
          setVar('myVar', 42),
          actionStep({ actions: ['test'] }),
        ),
      });

      game.registerAction(
        Action.create('test')
          .execute(() => ({ success: true }))
      );

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.position.variables.myVar).toBe(42);
    });
  });
});

describe('Game Flow Integration', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });

    // Set up game elements
    const deck = game.create(Deck, 'deck');
    deck.createMany(10, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));

    game.create(Hand, 'hand0', { player: game.getPlayer(1)! });
    game.create(Hand, 'hand1', { player: game.getPlayer(2)! });

    // Register actions
    const drawAction = Action.create('draw')
      .condition({
        'deck exists': (ctx) => ctx.game.first(Deck) !== undefined,
        'deck has cards': (ctx) => {
          const deck = ctx.game.first(Deck);
          return deck !== undefined && deck.count(Card) > 0;
        },
      })
      .execute((args, ctx) => {
        const deck = ctx.game.first(Deck)!;
        const card = deck.first(Card);
        const hand = ctx.player.my(Hand);
        if (card && hand) {
          card.putInto(hand);
          return { success: true, message: `Drew ${card.name}` };
        }
        return { success: false, error: 'Cannot draw' };
      });

    const passAction = Action.create('pass')
      .execute(() => ({ success: true }));

    game.registerActions(drawAction, passAction);
  });

  it('should set and start flow', () => {
    const flow = defineFlow({
      root: eachPlayer({
        do: actionStep({
          actions: ['draw', 'pass'],
        }),
      }),
    });

    game.setFlow(flow);
    const state = game.startFlow();

    expect(game.phase).toBe('started');
    expect(state.awaitingInput).toBe(true);
    expect(state.currentPlayer).toBe(1);
  });

  it('should continue flow after action', () => {
    const flow = defineFlow({
      root: eachPlayer({
        do: actionStep({
          actions: ['draw', 'pass'],
        }),
      }),
    });

    game.setFlow(flow);
    let state = game.startFlow();

    // Player 1 draws
    state = game.continueFlow('draw', {});
    expect(state.currentPlayer).toBe(2);

    // Player 2 passes
    state = game.continueFlow('pass', {});
    expect(state.complete).toBe(true);
  });

  it('should get flow state', () => {
    const flow = defineFlow({
      root: actionStep({ actions: ['pass'] }),
    });

    game.setFlow(flow);
    game.startFlow();

    const state = game.getFlowState();
    expect(state).toBeDefined();
    expect(state!.awaitingInput).toBe(true);
  });

  it('should check isAwaitingInput', () => {
    const flow = defineFlow({
      root: actionStep({ actions: ['pass'] }),
    });

    game.setFlow(flow);
    game.startFlow();

    expect(game.isAwaitingInput()).toBe(true);

    game.continueFlow('pass', {});

    expect(game.isAwaitingInput()).toBe(false);
  });

  it('should get current flow player', () => {
    const flow = defineFlow({
      root: eachPlayer({
        do: actionStep({ actions: ['pass'] }),
      }),
    });

    game.setFlow(flow);
    game.startFlow();

    expect(game.getCurrentFlowPlayer()).toBe(game.getPlayer(1)!);

    game.continueFlow('pass', {});

    expect(game.getCurrentFlowPlayer()).toBe(game.getPlayer(2)!);
  });

  it('should get available flow actions', () => {
    const flow = defineFlow({
      root: actionStep({ actions: ['draw', 'pass'] }),
    });

    game.setFlow(flow);
    game.startFlow();

    const actions = game.getFlowAvailableActions();
    expect(actions).toContain('draw');
    expect(actions).toContain('pass');
  });

  it('should finish game when flow completes', () => {
    const flow = defineFlow({
      root: actionStep({ actions: ['pass'] }),
    });

    game.setFlow(flow);
    game.startFlow();
    game.continueFlow('pass', {});

    expect(game.phase).toBe('finished');
  });

  it('should determine winners when flow completes', () => {
    const flow = defineFlow({
      root: actionStep({ actions: ['pass'] }),
      getWinners: (ctx) => [ctx.game.getPlayer(1)!],
    });

    game.setFlow(flow);
    game.startFlow();
    game.continueFlow('pass', {});

    expect(game.getWinners()).toHaveLength(1);
    expect(game.getWinners()[0]).toBe(game.getPlayer(1)!);
  });
});

describe('Complex Flow Scenarios', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('should handle turn-based game flow', () => {
    // Register simple action
    game.registerAction(
      Action.create('play')
        .execute((args, ctx) => {
          ctx.game.message(`${ctx.player.name} played`);
          return { success: true };
        })
    );

    let turnCount = 0;

    const flow = defineFlow({
      root: loop({
        while: () => turnCount < 4,
        do: eachPlayer({
          do: sequence(
            execute(() => {
              turnCount++;
            }),
            actionStep({ actions: ['play'] })
          ),
        }),
      }),
    });

    game.setFlow(flow);
    let state = game.startFlow();

    // Play 4 turns (2 rounds of 2 players)
    for (let i = 0; i < 4; i++) {
      expect(state.awaitingInput).toBe(true);
      state = game.continueFlow('play', {});
    }

    expect(turnCount).toBe(4);
    expect(game.messages).toHaveLength(4);
  });

  it('should handle nested loops', () => {
    game.registerAction(
      Action.create('act')
        .execute(() => ({ success: true }))
    );

    let innerCount = 0;

    const flow = defineFlow({
      root: repeat(
        2,
        eachPlayer({
          do: sequence(
            execute(() => {
              innerCount++;
            }),
            actionStep({ actions: ['act'] })
          ),
        })
      ),
    });

    game.setFlow(flow);
    let state = game.startFlow();

    // 2 outer loops × 2 players = 4 action steps
    for (let i = 0; i < 4; i++) {
      expect(state.awaitingInput).toBe(true);
      state = game.continueFlow('act', {});
    }

    expect(innerCount).toBe(4);
    expect(state.complete).toBe(true);
  });
});

describe('Named Phases', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('should create phase node', () => {
    const node = phase('combat', { do: noop() });
    expect(node.type).toBe('phase');
    expect(node.config.name).toBe('combat');
  });

  it('should track current phase in state', () => {
    const flow = defineFlow({
      root: sequence(
        phase('setup', { do: execute(() => {}) }),
        phase('main', {
          do: actionStep({ actions: ['act'] }),
        })
      ),
    });

    game.registerAction(
      Action.create<TestGame>('act').execute(() => {})
    );

    const engine = new FlowEngine(game, flow);
    const state = engine.start();

    expect(state.currentPhase).toBe('main');
    expect(state.awaitingInput).toBe(true);
  });

  it('should call onEnterPhase hook', () => {
    const enteredPhases: string[] = [];

    const flow = defineFlow({
      root: sequence(
        phase('setup', { do: execute(() => {}) }),
        phase('main', { do: execute(() => {}) })
      ),
      onEnterPhase: (name) => {
        enteredPhases.push(name);
      },
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    expect(enteredPhases).toEqual(['setup', 'main']);
  });

  it('should call onExitPhase hook', () => {
    const exitedPhases: string[] = [];

    const flow = defineFlow({
      root: sequence(
        phase('setup', { do: execute(() => {}) }),
        phase('main', { do: execute(() => {}) })
      ),
      onExitPhase: (name) => {
        exitedPhases.push(name);
      },
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    expect(exitedPhases).toEqual(['setup', 'main']);
  });

  it('should handle nested phases', () => {
    const phaseLog: string[] = [];

    const flow = defineFlow({
      root: phase('outer', {
        do: sequence(
          execute(() => phaseLog.push('in outer')),
          phase('inner', {
            do: execute(() => phaseLog.push('in inner')),
          }),
          execute(() => phaseLog.push('back in outer'))
        ),
      }),
      onEnterPhase: (name) => phaseLog.push(`enter:${name}`),
      onExitPhase: (name) => phaseLog.push(`exit:${name}`),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    expect(phaseLog).toEqual([
      'enter:outer',
      'in outer',
      'enter:inner',
      'in inner',
      'exit:inner',
      'back in outer',
      'exit:outer',
    ]);
  });
});

describe('Move Limits', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    game.registerAction(
      Action.create<TestGame>('act').execute(() => {})
    );
  });

  it('should auto-complete after maxMoves', () => {
    let actionCount = 0;
    game.registerAction(
      Action.create<TestGame>('count').execute(() => {
        actionCount++;
      })
    );

    const flow = defineFlow({
      root: eachPlayer({
        do: actionStep({
          actions: ['count'],
          maxMoves: 2,
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    // Player 0: 2 actions
    expect(state.awaitingInput).toBe(true);
    expect(state.moveCount).toBe(0);
    expect(state.movesRemaining).toBe(2);

    state = engine.resume('count', {});
    expect(state.moveCount).toBe(1);
    expect(state.movesRemaining).toBe(1);

    state = engine.resume('count', {});
    // Should auto-advance to player 2
    expect(state.moveCount).toBe(0);
    expect(state.currentPlayer).toBe(2);

    // Player 2: 2 actions
    state = engine.resume('count', {});
    state = engine.resume('count', {});

    expect(state.complete).toBe(true);
    expect(actionCount).toBe(4);
  });

  it('should track movesRequired until minMoves met', () => {
    game.registerAction(
      Action.create<TestGame>('count').execute(() => {})
    );

    const flow = defineFlow({
      root: actionStep({
        actions: ['count'],
        minMoves: 2,
        maxMoves: 3,
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    expect(state.movesRequired).toBe(2);
    expect(state.movesRemaining).toBe(3);

    state = engine.resume('count', {});
    expect(state.movesRequired).toBe(1);

    state = engine.resume('count', {});
    expect(state.movesRequired).toBe(0);
  });

  it('should not complete with repeatUntil if minMoves not met', () => {
    let shouldEnd = false;
    let actionCount = 0;

    game.registerAction(
      Action.create<TestGame>('count').execute(() => {
        actionCount++;
      })
    );

    const flow = defineFlow({
      root: actionStep({
        actions: ['count'],
        minMoves: 3,
        repeatUntil: () => shouldEnd,
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    // Try to end early
    shouldEnd = true;
    state = engine.resume('count', {}); // 1 action
    expect(state.awaitingInput).toBe(true); // Still waiting, minMoves not met

    state = engine.resume('count', {}); // 2 actions
    expect(state.awaitingInput).toBe(true); // Still waiting

    state = engine.resume('count', {}); // 3 actions, minMoves met
    expect(state.complete).toBe(true); // Now complete

    expect(actionCount).toBe(3);
  });
});

describe('turnLoop Helper', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('should loop until game is finished', () => {
    let actionCount = 0;

    game.registerAction(
      Action.create<TestGame>('act').execute((args, ctx) => {
        actionCount++;
        if (actionCount >= 3) {
          ctx.game.finish();
        }
      })
    );

    const flow = defineFlow({
      root: turnLoop({
        actions: ['act'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    // Action 1
    expect(state.awaitingInput).toBe(true);
    state = engine.resume('act', {});

    // Action 2
    expect(state.awaitingInput).toBe(true);
    state = engine.resume('act', {});

    // Action 3 - game finishes
    expect(state.awaitingInput).toBe(true);
    state = engine.resume('act', {});

    expect(state.complete).toBe(true);
    expect(actionCount).toBe(3);
  });

  it('should loop until while condition is false', () => {
    let actionsRemaining = 3;

    game.registerAction(
      Action.create<TestGame>('act').execute(() => {
        actionsRemaining--;
      })
    );

    const flow = defineFlow({
      root: turnLoop({
        actions: ['act'],
        while: () => actionsRemaining > 0,
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    // 3 actions until condition is false
    state = engine.resume('act', {});
    expect(state.awaitingInput).toBe(true);

    state = engine.resume('act', {});
    expect(state.awaitingInput).toBe(true);

    state = engine.resume('act', {});
    expect(state.complete).toBe(true);

    expect(actionsRemaining).toBe(0);
  });

  it('should respect maxIterations', () => {
    let actionCount = 0;

    game.registerAction(
      Action.create<TestGame>('act').execute(() => {
        actionCount++;
      })
    );

    const flow = defineFlow({
      root: turnLoop({
        actions: ['act'],
        maxIterations: 2,
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    state = engine.resume('act', {});
    state = engine.resume('act', {});

    expect(state.complete).toBe(true);
    expect(actionCount).toBe(2);
  });

  it('should default maxIterations to 100', () => {
    const node = turnLoop({
      actions: ['act'],
    });
    expect(node.config.maxIterations).toBe(100);
  });

  it('should support dynamic actions list', () => {
    const actionsAvailable: string[] = ['draw', 'play'];

    game.registerAction(
      Action.create<TestGame>('draw').execute(() => {})
    );
    game.registerAction(
      Action.create<TestGame>('play').execute(() => {})
    );
    game.registerAction(
      Action.create<TestGame>('endTurn').execute((args, ctx) => {
        ctx.game.finish();
      })
    );

    const flow = defineFlow({
      root: turnLoop({
        actions: () => [...actionsAvailable, 'endTurn'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    const state = engine.start();

    expect(state.availableActions).toContain('draw');
    expect(state.availableActions).toContain('play');
    expect(state.availableActions).toContain('endTurn');
  });

  it('should work with eachPlayer for turn-based games', () => {
    let turnsTaken = 0;
    let endedTurn = false;

    game.registerAction(
      Action.create<TestGame>('act').execute(() => {})
    );
    game.registerAction(
      Action.create<TestGame>('endTurn').execute(() => {
        turnsTaken++;
        endedTurn = true;
      })
    );

    const flow = defineFlow({
      root: loop({
        while: () => turnsTaken < 4,
        do: eachPlayer({
          do: sequence(
            execute(() => {
              endedTurn = false;
            }),
            turnLoop({
              actions: ['act', 'endTurn'],
              while: () => !endedTurn,
            })
          ),
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    // 4 turns (2 rounds × 2 players)
    for (let i = 0; i < 4; i++) {
      expect(state.awaitingInput).toBe(true);
      state = engine.resume('endTurn', {});
    }

    expect(state.complete).toBe(true);
    expect(turnsTaken).toBe(4);
  });
});

describe('Turn Order Presets', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });
  });

  it('should use DEFAULT turn order', () => {
    const visitedPlayers: number[] = [];

    const flow = defineFlow({
      root: eachPlayer({
        ...TurnOrder.DEFAULT,
        do: execute((ctx) => {
          visitedPlayers.push(ctx.player!.seat);
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    expect(visitedPlayers).toEqual([1, 2, 3]);
  });

  it('should use REVERSE turn order', () => {
    const visitedPlayers: number[] = [];

    const flow = defineFlow({
      root: eachPlayer({
        ...TurnOrder.REVERSE,
        do: execute((ctx) => {
          visitedPlayers.push(ctx.player!.seat);
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    expect(visitedPlayers).toEqual([3, 2, 1]);
  });

  it('should use ONLY to filter players', () => {
    const visitedPlayers: number[] = [];

    const flow = defineFlow({
      root: eachPlayer({
        ...TurnOrder.ONLY([1, 3]),  // 1-indexed: players at positions 1 and 3
        do: execute((ctx) => {
          visitedPlayers.push(ctx.player!.seat);
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    // Only players at positions 1 and 3
    expect(visitedPlayers).toEqual([1, 3]);
  });

  it('should use START_FROM with position (no wrap-around)', () => {
    const visitedPlayers: number[] = [];

    const flow = defineFlow({
      root: eachPlayer({
        ...TurnOrder.START_FROM(2),  // 1-indexed: start from player at position 2
        do: execute((ctx) => {
          visitedPlayers.push(ctx.player!.seat);
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    // Starts from player at position 2, goes to end (no wrap-around)
    expect(visitedPlayers).toEqual([2, 3]);
  });

  it('should use CONTINUE from current player', () => {
    // Set current player to position 2
    game.setCurrentPlayer(game.getPlayer(3)!);

    const visitedPlayers: number[] = [];

    const flow = defineFlow({
      root: eachPlayer({
        ...TurnOrder.CONTINUE,
        do: execute((ctx) => {
          visitedPlayers.push(ctx.player!.seat);
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    // Should start from player 2, goes to end
    expect(visitedPlayers).toEqual([3]);
  });

  it('should use ACTIVE_ONLY to skip eliminated players', () => {
    // Create a game class that tracks eliminated status
    class EliminablePlayer extends Player {
      eliminated = false;
    }
    class EliminableGame extends Game<EliminableGame, EliminablePlayer> {}

    const eliminableGame = new EliminableGame({ playerCount: 3 });
    // Mark player at position 2 as eliminated (1-indexed)
    (eliminableGame.getPlayer(2) as any).eliminated = true;

    const visitedPlayers: number[] = [];

    const flow = defineFlow({
      root: eachPlayer({
        ...TurnOrder.ACTIVE_ONLY,
        do: execute((ctx) => {
          visitedPlayers.push(ctx.player!.seat);
        }),
      }),
    });

    const engine = new FlowEngine(eliminableGame, flow);
    engine.start();

    // Player 1 is eliminated, should be skipped
    expect(visitedPlayers).toEqual([1, 3]);
  });
});

describe('Action Chaining with followUp in FlowState', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('should include followUp in FlowState when action returns one', () => {
    // Action that returns a followUp
    const exploreAction = Action.create('explore')
      .execute(() => ({
        success: true,
        followUp: {
          action: 'collect',
          args: { mercId: 42, sectorId: 'A1' },
        },
      }));

    // The follow-up action
    const collectAction = Action.create('collect')
      .execute(() => ({
        success: true,
      }));

    game.registerActions(exploreAction, collectAction);

    const flow = defineFlow({
      root: actionStep({
        actions: ['explore', 'collect'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    expect(state.awaitingInput).toBe(true);

    // Execute explore action
    state = engine.resume('explore', {});

    // FlowState should include followUp
    expect(state.followUp).toBeDefined();
    expect(state.followUp?.action).toBe('collect');
    expect(state.followUp?.args).toEqual({ mercId: 42, sectorId: 'A1' });
  });

  it('should not include followUp in FlowState when action does not return one', () => {
    const simpleAction = Action.create('simple')
      .execute(() => ({
        success: true,
      }));

    game.registerAction(simpleAction);

    const flow = defineFlow({
      root: actionStep({
        actions: ['simple'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    state = engine.resume('simple', {});

    expect(state.followUp).toBeUndefined();
  });

  it('should clear followUp when subsequent action does not return one', () => {
    // First action returns followUp
    const firstAction = Action.create('first')
      .execute(() => ({
        success: true,
        followUp: {
          action: 'second',
          args: { data: 'test' },
        },
      }));

    // Second action does not return followUp
    const secondAction = Action.create('second')
      .execute(() => ({
        success: true,
      }));

    game.registerActions(firstAction, secondAction);

    // Use playerActions to keep awaiting input after each action
    const flow = defineFlow({
      root: playerActions({
        actions: ['first', 'second'],
        // Allow 2 actions total
        repeatUntil: ({ moveCount }) => moveCount >= 2,
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    // First action - should have followUp
    state = engine.resume('first', {});
    expect(state.followUp?.action).toBe('second');

    // Second action - should NOT have followUp (cleared)
    state = engine.resume('second', {});
    expect(state.followUp).toBeUndefined();
  });

  it('should include followUp with element ID from selected element', () => {
    const deck = game.create(Deck, 'deck');
    deck.createMany(3, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));

    const selectAndChainAction = Action.create('selectAndChain')
      .chooseElement('card', { elementClass: Card })
      .execute((args) => {
        const card = args.card as Card;
        return {
          success: true,
          followUp: {
            action: 'processCard',
            args: { cardId: card.id },
          },
        };
      });

    game.registerAction(selectAndChainAction);

    const flow = defineFlow({
      root: actionStep({
        actions: ['selectAndChain'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    const card = deck.first(Card)!;
    state = engine.resume('selectAndChain', { card });

    expect(state.followUp?.action).toBe('processCard');
    expect(state.followUp?.args?.cardId).toBe(card.id);
  });

  it('should not count followUp chains against loop maxIterations', () => {
    // This test verifies the fix for a bug where followUp action chains
    // counted against the parent loop's maxIterations, causing premature
    // turn endings when using recursive followUp patterns within loops.

    let chainDepth = 0;
    const maxChainDepth = 5;

    // Action that chains to itself (like MERC's applyImpact pattern)
    const chainAction = Action.create('chain')
      .execute(() => {
        chainDepth++;
        if (chainDepth < maxChainDepth) {
          return {
            success: true,
            followUp: { action: 'chain', args: {} },
          };
        }
        return { success: true };
      });

    game.registerAction(chainAction);

    // Create a loop with maxIterations: 2 - if followUp counted as iterations,
    // the chain of 5 would exceed this and fail
    const flow = defineFlow({
      root: loop({
        maxIterations: 2,
        while: () => chainDepth < maxChainDepth,
        do: actionStep({
          actions: ['chain'],
        }),
      }),
    });

    const engine = new FlowEngine(game, flow);
    let state = engine.start();

    // First loop iteration - triggers chain of 5 followUps
    expect(state.awaitingInput).toBe(true);
    state = engine.resume('chain', {});

    // Execute all the followUps (each triggered automatically via the flow engine)
    while (state.followUp && !state.complete) {
      state = engine.resume('chain', {});
    }

    // The entire chain should complete successfully
    expect(chainDepth).toBe(maxChainDepth);
    expect(state.complete).toBe(true);

    // If followUp counted as iterations, we would have failed at iteration 2
    // with chainDepth still less than maxChainDepth
  });
});
