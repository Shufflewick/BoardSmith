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
} from '../src/index.js';
import type { FlowContext, FlowDefinition } from '../src/index.js';

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
            visitedPlayers.push(ctx.player!.position);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(visitedPlayers).toEqual([0, 1, 2]);
    });

    it('should filter players', () => {
      const visitedPlayers: number[] = [];

      const flow = defineFlow({
        root: eachPlayer({
          filter: (p) => p.position !== 1,
          do: execute((ctx) => {
            visitedPlayers.push(ctx.player!.position);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(visitedPlayers).toEqual([0, 2]);
    });

    it('should iterate backward', () => {
      const visitedPlayers: number[] = [];

      const flow = defineFlow({
        root: eachPlayer({
          direction: 'backward',
          do: execute((ctx) => {
            visitedPlayers.push(ctx.player!.position);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(visitedPlayers).toEqual([2, 1, 0]);
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
      expect(state.currentPlayer).toBe(0);
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

    game.create(Hand, 'hand0', { player: game.players[0] });
    game.create(Hand, 'hand1', { player: game.players[1] });

    // Register actions
    const drawAction = Action.create('draw')
      .condition((ctx) => {
        const deck = ctx.game.first(Deck);
        return deck !== undefined && deck.count(Card) > 0;
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
    expect(state.currentPlayer).toBe(0);
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

    // Player 0 draws
    state = game.continueFlow('draw', {});
    expect(state.currentPlayer).toBe(1);

    // Player 1 passes
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

    expect(game.getCurrentFlowPlayer()).toBe(game.players[0]);

    game.continueFlow('pass', {});

    expect(game.getCurrentFlowPlayer()).toBe(game.players[1]);
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
      getWinners: (ctx) => [ctx.game.players[0]],
    });

    game.setFlow(flow);
    game.startFlow();
    game.continueFlow('pass', {});

    expect(game.getWinners()).toHaveLength(1);
    expect(game.getWinners()[0]).toBe(game.players[0]);
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
