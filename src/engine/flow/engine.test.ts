import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  FlowEngine,
  FlowHaltedError,
  sequence,
  loop,
  repeat,
  eachPlayer,
  forEach,
  actionStep,
  simultaneousActionStep,
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
import { _clearShownWarnings } from '../../utils/dev.js';

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
    expect((node.config as { steps: unknown[] }).steps).toHaveLength(2);
  });

  it('should create loop node', () => {
    const node = loop({
      maxIterations: 10,
      while: () => true,
      do: noop(),
    });
    expect(node.type).toBe('loop');
  });

  it('should create repeat node', () => {
    const node = repeat(3, noop());
    expect(node.type).toBe('repeat');
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
    expect((node.config as { maxIterations?: number }).maxIterations).toBe(50);
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
          maxIterations: 10,
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
          maxIterations: 10,
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

    it('should throw when a loop hits its maxIterations safety cap', () => {
      let count = 0;

      const flow = defineFlow({
        root: loop({
          name: 'runaway-loop',
          while: () => true,
          maxIterations: 5,
          do: execute(() => {
            count++;
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);

      // The cap is a safety assertion, not a terminator: hitting it must fail
      // loud, naming the loop and the iteration count, instead of silently
      // completing.
      expect(() => engine.start()).toThrow(/runaway-loop/);
      expect(() => engine.start()).toThrow(/maxIterations safety cap/);
      expect(() => engine.start()).toThrow(/5 iterations/);
      // The loop body ran up to the cap before throwing.
      expect(count).toBeGreaterThanOrEqual(5);
    });

    it('completes cleanly when its while condition becomes false below the cap', () => {
      let count = 0;

      const flow = defineFlow({
        root: loop({
          name: 'condition-loop',
          while: () => count < 3,
          maxIterations: 100,
          do: execute(() => {
            count++;
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.complete).toBe(true);
      expect(count).toBe(3);
    });

    // Test D (LIBX-02, no-regression): a bounded loop must still throw the loud
    // "safety assertion" cap-hit error when it exceeds a numeric maxIterations,
    // even after the unbounded valve is introduced.
    it('still throws the loud safety-assertion error for a bounded loop that exceeds its numeric maxIterations', () => {
      let count = 0;

      const flow = defineFlow({
        root: loop({
          name: 'bounded-runaway-loop',
          while: () => true,
          maxIterations: 5,
          do: execute(() => {
            count++;
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);

      expect(() => engine.start()).toThrow(/maxIterations safety cap/);
      expect(count).toBeGreaterThanOrEqual(5);
    });

    // Test C (LIBX-02): an `unbounded: true` loop must be able to run past
    // DEFAULT_MAX_ITERATIONS (10000) per-loop iterations without ever hitting
    // the per-loop cap-hit throw, terminating only when its `while` condition
    // flips false. Each iteration pauses on an actionStep and is driven forward
    // by a separate engine.resume() call from the test — this resets run()'s
    // own per-call iteration counter every time, so the *loop's own* cumulative
    // iteration count (persisted in frame.data across resumes) can exceed 10000
    // without the whole-flow run() tripwire (also gated at 10000) ever firing.
    it('unbounded: true loop runs past DEFAULT_MAX_ITERATIONS per-loop iterations and exits cleanly on while-false', () => {
      const ITERATIONS_PAST_CAP = 10001;
      let count = 0;

      game.registerAction(Action.create('tick').execute(() => ({ success: true })));

      const flow = defineFlow({
        root: loop({
          name: 'unbounded-loop',
          unbounded: true,
          while: () => count <= ITERATIONS_PAST_CAP,
          do: sequence(
            execute(() => {
              count++;
            }),
            actionStep({ actions: ['tick'] })
          ),
        }),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();
      expect(state.awaitingInput).toBe(true);

      let resumes = 0;
      while (!state.complete) {
        state = engine.resume('tick', {});
        resumes++;
        // Guard against the test itself runaway-looping if something regresses.
        if (resumes > ITERATIONS_PAST_CAP + 10) {
          throw new Error('Test runaway: loop never completed via while-false');
        }
      }

      expect(state.complete).toBe(true);
      expect(count).toBeGreaterThan(10000);
    });

    // Test E (LIBX-02): the whole-flow tripwire in run() must still fire for a
    // genuinely stuck `unbounded: true` loop whose `while` never flips false —
    // driven entirely within a SINGLE continuous engine.start() call (no
    // resuming), proving the global tripwire is not defeated by `unbounded`.
    // Distinguished from Test D by asserting the run()-level message (not the
    // per-loop cap-hit message), since an unbounded loop's own cap is Infinity.
    it('the whole-flow run() tripwire still fires for a stuck unbounded loop (not the per-loop cap)', () => {
      const flow = defineFlow({
        root: loop({
          name: 'stuck-unbounded-loop',
          unbounded: true,
          while: () => true,
          do: execute(() => {}),
        }),
      });

      const engine = new FlowEngine(game, flow);

      let caught: Error | undefined;
      try {
        engine.start();
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).toBeDefined();
      expect(caught!.message).toMatch(/exceeded 10000 iterations/);
      expect(caught!.message).not.toMatch(/maxIterations safety cap/);
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

    it('should allow reusing repeat flow definitions across engine instances', () => {
      game.registerAction(
        Action.create('test')
          .chooseFrom('choice', { choices: ['a', 'b'] })
          .execute(() => ({ success: true }))
      );

      const flow = defineFlow({
        root: repeat(2, actionStep({ actions: ['test'] })),
      });

      const engine1 = new FlowEngine(game, flow);
      let state = engine1.start();
      expect(state.awaitingInput).toBe(true);
      state = engine1.resume('test', { choice: 'a' });
      expect(state.awaitingInput).toBe(true);
      state = engine1.resume('test', { choice: 'b' });
      expect(state.complete).toBe(true);

      const engine2 = new FlowEngine(game, flow);
      const restartState = engine2.start();
      expect(restartState.awaitingInput).toBe(true);
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

    it('should re-check filter dynamically between player turns', () => {
      game.registerAction(
        Action.create('act').execute((args, ctx) => {
          if (ctx.player.seat === 1) {
            (ctx.game.getPlayerOrThrow(2) as any).eliminated = true;
          }
          return { success: true };
        })
      );

      const flow = defineFlow({
        root: eachPlayer({
          filter: (player) => !(player as any).eliminated,
          do: actionStep({ actions: ['act'] }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();
      expect(state.currentPlayer).toBe(1);

      state = engine.resume('act', {});
      expect(state.currentPlayer).toBe(3);
    });

    describe('ENG-02 startingPlayer wrap-around', () => {
      it('wraps around the full player list when startingPlayer is non-zero', () => {
        const fourPlayerGame = new TestGame({ playerCount: 4 });
        const visitedPlayers: number[] = [];

        const flow = defineFlow({
          root: eachPlayer({
            startingPlayer: (ctx) => ctx.game.getPlayerOrThrow(3),
            do: execute((ctx) => {
              visitedPlayers.push(ctx.player!.seat);
            }),
          }),
        });

        const engine = new FlowEngine(fourPlayerGame, flow);
        engine.start();

        // Every player must get a turn this round, starting from seat 3 and
        // wrapping back around to seats 1 and 2 -- not truncating at the end
        // of the underlying player list.
        expect(visitedPlayers).toEqual([3, 4, 1, 2]);
      });

      it('starts from the next eligible seat when startingPlayer is filtered out (WR-01)', () => {
        // LEFT_OF_DEALER + SKIP_IF composition: the player left of the dealer
        // has folded. The round must start from the next eligible seat AFTER
        // the filtered-out starting player (wrap semantics), not silently
        // fall back to the first seat in the filtered list.
        const fourPlayerGame = new TestGame({ playerCount: 4 });
        const visitedPlayers: number[] = [];

        const flow = defineFlow({
          root: eachPlayer({
            startingPlayer: (ctx) => ctx.game.getPlayerOrThrow(2),
            filter: (p) => p.seat !== 2,
            do: execute((ctx) => {
              visitedPlayers.push(ctx.player!.seat);
            }),
          }),
        });

        const engine = new FlowEngine(fourPlayerGame, flow);
        engine.start();

        expect(visitedPlayers).toEqual([3, 4, 1]);
      });

      it('visits all players in natural order when no startingPlayer is given (control)', () => {
        const fourPlayerGame = new TestGame({ playerCount: 4 });
        const visitedPlayers: number[] = [];

        const flow = defineFlow({
          root: eachPlayer({
            do: execute((ctx) => {
              visitedPlayers.push(ctx.player!.seat);
            }),
          }),
        });

        const engine = new FlowEngine(fourPlayerGame, flow);
        engine.start();

        expect(visitedPlayers).toEqual([1, 2, 3, 4]);
      });
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
            cardNames.push((ctx.get('card') as Card).name!);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(cardNames).toHaveLength(3);
    });

    it('should visit every original item when the loop body mutates the source collection', () => {
      const deck = game.create(Deck, 'deck');
      const pile = game.create(Deck, 'pile');
      const cards = deck.createMany(4, Card, 'card', (i) => ({
        suit: 'H',
        rank: String(i + 1),
        value: i + 1,
      }));
      const originalIds = cards.map((c) => c.id);

      const visitedIds: number[] = [];

      const flow = defineFlow({
        root: forEach({
          collection: (ctx) => [...ctx.game.all(Card)],
          as: 'card',
          do: execute((ctx) => {
            const card = ctx.get('card') as Card;
            visitedIds.push(card.id);
            // Mutate the source collection: move the visited card out of `deck`.
            card.putInto(pile);
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start();

      expect(visitedIds).toHaveLength(originalIds.length);
      expect(new Set(visitedIds)).toEqual(new Set(originalIds));
    });

    it('should resume a mid-loop checkpoint with the original snapshot, not a recomputed collection', () => {
      // ENG-06: frame.data.forEachItems is the load-bearing serialization contract.
      // A restore mid-loop must visit the original snapshot's tail even if the
      // source collection has changed between checkpoint and restore.
      const deck = game.create(Deck, 'deck');
      const cards = deck.createMany(3, Card, 'card', (i) => ({
        suit: 'H',
        rank: String(i + 1),
        value: i + 1,
      }));
      const originalIds = cards.map((c) => c.id);

      game.registerAction(Action.create('step').execute(() => ({ success: true })));

      const visitedIds: number[] = [];
      const flow = defineFlow({
        root: forEach({
          collection: (ctx) => [...ctx.game.all(Card)],
          as: 'card',
          do: sequence(
            execute((ctx) => {
              visitedIds.push((ctx.get('card') as Card).id);
            }),
            actionStep({ actions: ['step'] })
          ),
        }),
      });

      const engine = new FlowEngine(game, flow);
      engine.start(); // iteration 1 begins, awaiting 'step'
      const state = engine.resume('step', {}); // iteration 2 begins, awaiting 'step'
      expect(visitedIds).toEqual(originalIds.slice(0, 2));
      expect(state.complete).toBe(false);

      // Mutate the collection source AFTER the checkpoint: a recomputed
      // collection would now contain a 4th card.
      const lateCard = deck.create(Card, 'late-card', { suit: 'S', rank: '9', value: 9 });

      const restored = new FlowEngine(game, flow);
      const restoreResult = restored.restoreFullState(state);
      expect(restoreResult.success).toBe(true);

      let resumed = restored.resume('step', {}); // completes iteration 2, iteration 3 begins
      expect(resumed.complete).toBe(false);
      resumed = restored.resume('step', {}); // completes iteration 3 -- snapshot exhausted

      // The restored loop visited exactly the original snapshot's tail: the late
      // card was never visited and the loop ended after the original 3 items.
      expect(resumed.complete).toBe(true);
      expect(visitedIds).toEqual(originalIds);
      expect(visitedIds).not.toContain(lateCard.id);
    });

    it('should throw when a snapshotted element has been permanently deleted mid-loop', () => {
      const deck = game.create(Deck, 'deck');
      const [, card2] = deck.createMany(2, Card, 'card', (i) => ({
        suit: 'H',
        rank: String(i + 1),
        value: i + 1,
      }));

      const flow = defineFlow({
        root: forEach({
          collection: (ctx) => [...ctx.game.all(Card)],
          as: 'card',
          do: execute(() => {
            // Surgically detach card2 from the tree entirely (not moved to the
            // pile, so getElementById cannot find it anywhere).
            const index = deck._t.children.indexOf(card2);
            if (index !== -1) {
              deck._t.children.splice(index, 1);
              card2._t.parent = undefined;
            }
          }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      expect(() => engine.start()).toThrow(/no longer exists in the game tree/);
    });

    it('should throw on collection items that are neither GameElements nor JSON primitives', () => {
      const flow = defineFlow({
        root: forEach({
          // Cast past the compile-time constraint to exercise the runtime guard.
          collection: [{ round: 1 }, { round: 2 }] as unknown as number[],
          as: 'r',
          do: noop(),
        }),
      });

      const engine = new FlowEngine(game, flow);
      expect(() => engine.start()).toThrow(/not a GameElement or JSON primitive/);
    });
  });

  describe('Variables', () => {
    it('should set and get variables', () => {
      let finalValue: number | undefined;

      const flow = defineFlow({
        root: sequence(
          setVar('counter', 0),
          setVar('counter', (ctx: FlowContext) => (ctx.get('counter') as number) + 1),
          setVar('counter', (ctx: FlowContext) => (ctx.get('counter') as number) + 10),
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

    it('should throw an actionable error when switchOn has no matching case and no default', () => {
      const flow = defineFlow({
        root: switchOn({
          on: () => 'combatt',
          cases: {
            draw: setVar('result', 'case-draw'),
            play: setVar('result', 'case-play'),
            combat: setVar('result', 'case-combat'),
          },
        }),
      });

      const engine = new FlowEngine(game, flow);

      expect(() => engine.start()).toThrow(/no matching case/);
      expect(() => engine.start()).toThrow(/combatt/);
      expect(() => engine.start()).toThrow(/draw/);
      expect(() => engine.start()).toThrow(/play/);
      expect(() => engine.start()).toThrow(/combat/);
    });

    it('should execute the matched branch when switchOn has a matching case (control)', () => {
      const flow = defineFlow({
        root: switchOn({
          on: () => 'play',
          cases: {
            draw: setVar('result', 'case-draw'),
            play: setVar('result', 'case-play'),
            combat: setVar('result', 'case-combat'),
          },
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();

      expect(state.position.variables.result).toBe('case-play');
    });

    it('should execute the default branch when switchOn has no matching case but has a default (control)', () => {
      const flow = defineFlow({
        root: switchOn({
          on: () => 'combatt',
          cases: {
            draw: setVar('result', 'case-draw'),
            play: setVar('result', 'case-play'),
            combat: setVar('result', 'case-combat'),
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

    it('should reject actions outside the current flow allow-list', () => {
      game.registerAction(
        Action.create('other').execute(() => ({ success: true }))
      );

      const flow = defineFlow({
        root: actionStep({
          actions: ['test'],
        }),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();
      expect(state.availableActions).toEqual(['test']);

      state = engine.resume('other', {});
      expect(state.awaitingInput).toBe(true);
      expect(state.complete).toBe(false);
      expect(state.actionError).toContain('not available');
      expect(state.availableActions).toEqual(['test']);
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

    it('should not auto-complete the next step from a stale lastActionResult', () => {
      game.registerActions(
        Action.create('first').execute(() => ({ success: true })),
        Action.create('second').execute(() => ({ success: true }))
      );

      const flow = defineFlow({
        root: sequence(
          actionStep({ actions: ['first'] }),
          actionStep({
            actions: ['second'],
            repeatUntil: () => true,
          })
        ),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();
      expect(state.availableActions).toEqual(['first']);

      state = engine.resume('first', {});
      expect(state.complete).toBe(false);
      expect(state.awaitingInput).toBe(true);
      expect(state.availableActions).toEqual(['second']);
    });

    it('should not leak player override to sibling action steps', () => {
      const playerA = game.getPlayer(1)!;
      const playerB = game.getPlayer(2)!;

      const flow = defineFlow({
        root: eachPlayer({
          filter: (p) => p === playerA,
          do: sequence(
            // Step 1: override player to B
            actionStep({
              name: 'decision-for-b',
              player: () => playerB,
              actions: ['test'],
            }),
            // Step 2: no override — should use Player A from eachPlayer
            actionStep({
              name: 'player-a-action',
              actions: ['test'],
            }),
          ),
        }),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();

      // Step 1 should be for Player B (override)
      expect(state.awaitingInput).toBe(true);
      expect(state.currentPlayer).toBe(playerB.seat);

      state = engine.resume('test', { choice: 'a' });

      // Step 2 should be for Player A (from eachPlayer), not Player B
      expect(state.awaitingInput).toBe(true);
      expect(state.currentPlayer).toBe(playerA.seat);
    });

    it('should not leak player override across eachPlayer iterations', () => {
      const playerA = game.getPlayer(1)!;
      const playerB = game.getPlayer(2)!;
      const playerC = game.getPlayer(3)!;

      const flow = defineFlow({
        root: eachPlayer({
          do: sequence(
            // Override to player C for every player's turn
            actionStep({
              name: 'ask-c',
              player: () => playerC,
              actions: ['test'],
            }),
            // Should use the eachPlayer's current player, not C
            actionStep({
              name: 'own-action',
              actions: ['test'],
            }),
          ),
        }),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();

      // Player A's turn: step 1 overrides to C
      expect(state.currentPlayer).toBe(playerC.seat);
      state = engine.resume('test', { choice: 'a' });

      // Player A's turn: step 2 should be A
      expect(state.currentPlayer).toBe(playerA.seat);
      state = engine.resume('test', { choice: 'a' });

      // Player B's turn: step 1 overrides to C
      expect(state.currentPlayer).toBe(playerC.seat);
      state = engine.resume('test', { choice: 'a' });

      // Player B's turn: step 2 should be B
      expect(state.currentPlayer).toBe(playerB.seat);
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

    it('should restore the active if/else branch correctly', () => {
      game.registerActions(
        Action.create('thenAction').execute(() => ({ success: true })),
        Action.create('elseAction').execute(() => ({ success: true }))
      );

      const flow = defineFlow({
        root: ifThen({
          condition: () => false,
          then: actionStep({ actions: ['thenAction'] }),
          else: actionStep({ actions: ['elseAction'] }),
        }),
      });

      const engine = new FlowEngine(game, flow);
      const state = engine.start();
      expect(state.availableActions).toEqual(['elseAction']);

      const restored = new FlowEngine(game, flow);
      const restoreResult = restored.restoreFullState(state);
      expect(restoreResult.success).toBe(true);

      const resumed = restored.resume('elseAction', {});
      expect(resumed.complete).toBe(true);
    });

    it('should preserve move counts across full-state restore', () => {
      game.registerAction(
        Action.create('count').execute(() => ({ success: true }))
      );

      const flow = defineFlow({
        root: actionStep({
          actions: ['count'],
          maxMoves: 2,
        }),
      });

      const engine = new FlowEngine(game, flow);
      let state = engine.start();
      state = engine.resume('count', {});
      expect(state.moveCount).toBe(1);

      const restored = new FlowEngine(game, flow);
      const restoreResult = restored.restoreFullState(state);
      expect(restoreResult.success).toBe(true);

      const resumed = restored.resume('count', {});
      expect(resumed.complete).toBe(true);
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
        maxIterations: 10,
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
      Action.create('act').execute(() => {})
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
      Action.create('act').execute(() => {})
    );
  });

  it('should auto-complete after maxMoves', () => {
    let actionCount = 0;
    game.registerAction(
      Action.create('count').execute(() => {
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
      Action.create('count').execute(() => {})
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
      Action.create('count').execute(() => {
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
      Action.create('act').execute((args, ctx) => {
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
      Action.create('act').execute(() => {
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

  it('terminates a turnLoop via its while condition', () => {
    let actionCount = 0;

    game.registerAction(
      Action.create('act').execute(() => {
        actionCount++;
      })
    );

    // Terminate via a real condition (stop after 2 actions), not by abusing
    // the maxIterations safety cap as a loop terminator.
    const flow = defineFlow({
      root: turnLoop({
        actions: ['act'],
        while: () => actionCount < 2,
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
    expect((node.config as { maxIterations?: number }).maxIterations).toBe(100);
  });

  it('should support dynamic actions list', () => {
    const actionsAvailable: string[] = ['draw', 'play'];

    game.registerAction(
      Action.create('draw').execute(() => {})
    );
    game.registerAction(
      Action.create('play').execute(() => {})
    );
    game.registerAction(
      Action.create('endTurn').execute((args, ctx) => {
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
      Action.create('act').execute(() => {})
    );
    game.registerAction(
      Action.create('endTurn').execute(() => {
        turnsTaken++;
        endedTurn = true;
      })
    );

    const flow = defineFlow({
      root: loop({
        maxIterations: 10,
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

  it('should use START_FROM with position (wraps around)', () => {
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

    // Starts from player at position 2, wraps back around to player 1
    expect(visitedPlayers).toEqual([2, 3, 1]);
  });

  it('should use CONTINUE from current player (wraps around)', () => {
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

    // Should start from player 3, wrap back around to players 1 and 2
    expect(visitedPlayers).toEqual([3, 1, 2]);
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
        repeatUntil: (ctx) => (ctx as unknown as { moveCount: number }).moveCount >= 2,
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

describe('Unknown action warning (F20)', () => {
  let game: TestGame;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('actionStep references a non-existent method in the warning is not used; points to the real API', () => {
    const flow = defineFlow({
      root: actionStep({ actions: ['nope'] }),
    });

    new FlowEngine(game, flow).start();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;

    // Names the unknown action.
    expect(message).toContain("references unknown action 'nope'");
    // Points to the REAL builder + registration API (Action.create(...).execute(...)
    // registered via this.registerActions(...) in the game's constructor) --
    // there is no defineActions()/defineFlow() lifecycle hook (139-02 DOCX-04).
    expect(message).toContain('registerActions(');
    expect(message).toContain("Action.create('nope')");
    expect(message).toContain("game's constructor");
    // Must NOT reference any of the non-existent phantom APIs (the F20 defect
    // and its 139-02 successor: action()/.do()/defineActions() never existed).
    expect(message).not.toContain('defineAction(');
    expect(message).not.toContain("game.defineAction('nope', ...)");
    expect(message).not.toContain('defineActions()');
    expect(message).not.toMatch(/\baction\('nope'\)/);
  });

  it('simultaneous-action-step warning also points to the real API', () => {
    const flow = defineFlow({
      root: simultaneousActionStep({ actions: ['missing'] }),
    });

    new FlowEngine(game, flow).start();

    expect(warnSpy).toHaveBeenCalled();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain("references unknown action 'missing'");
    expect(message).toContain('registerActions(');
    expect(message).not.toContain('defineAction(');
  });
});

describe('ENG-03 simultaneous action failure signaling', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });

    // A validated action: rejects any choice outside ['a', 'b', 'c'].
    const testAction = Action.create('test')
      .chooseFrom('choice', { choices: ['a', 'b', 'c'] })
      .execute((args) => {
        return { success: true, data: { choice: args.choice } };
      });

    game.registerAction(testAction);
  });

  it('sets actionError when a simultaneous action fails validation, without disturbing awaitingPlayers/awaitingInput', () => {
    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['test'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    const startState = engine.start();

    expect(startState.awaitingInput).toBe(true);
    expect(startState.awaitingPlayers).toHaveLength(3);

    // Player 1 submits an invalid choice ('z' is not in ['a', 'b', 'c']).
    const state = engine.resume('test', { choice: 'z' }, 1);

    expect(state.actionError).toBeDefined();
    expect(state.awaitingInput).toBe(true);
    expect(state.awaitingPlayers).toHaveLength(3);
    expect(state.awaitingPlayers?.every((p) => !p.completed)).toBe(true);
  });

  it('clears actionError once a later action in the same step succeeds (fail-then-succeed)', () => {
    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['test'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    // Player 1 fails first.
    const failState = engine.resume('test', { choice: 'z' }, 1);
    expect(failState.actionError).toBeDefined();

    // Player 2 then succeeds in the same step.
    const successState = engine.resume('test', { choice: 'a' }, 2);
    expect(successState.actionError).toBeUndefined();
  });

  // WR-03: the simultaneous pre-flight checks must mirror resume()'s graceful
  // actionError contract. A double-submit after completing, an action outside
  // the allow-list, or a non-awaiting player are ordinary player-input races
  // in concurrent play — not developer errors — so they must record
  // actionError and return state instead of throwing ENGINE_ERROR.
  it('records actionError instead of throwing when a player resubmits after completing (WR-03)', () => {
    const acted = new Set<number>();
    game.registerAction(
      Action.create('done').execute((args, ctx) => {
        acted.add(ctx.player.seat);
        return { success: true };
      })
    );

    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['done'],
        playerDone: (ctx, p) => acted.has(p.seat),
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    // Player 1 completes their simultaneous step.
    const first = engine.resume('done', {}, 1);
    expect(first.awaitingInput).toBe(true);

    // Ordinary race in concurrent play: player 1 double-submits.
    const state = engine.resume('done', {}, 1);
    expect(state.actionError).toContain('already completed');
    expect(state.awaitingInput).toBe(true);
    expect(state.awaitingPlayers).toHaveLength(3);
  });

  it('records actionError instead of throwing when the action is not in the player allow-list (WR-03)', () => {
    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['test'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    const state = engine.resume('not-allowed', { choice: 'a' }, 1);
    expect(state.actionError).toContain('not-allowed');
    expect(state.actionError).toContain('not available');
    expect(state.awaitingInput).toBe(true);
  });

  it('records actionError instead of throwing when the acting player is not awaiting (WR-03)', () => {
    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['test'],
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    const state = engine.resume('test', { choice: 'a' }, 99);
    expect(state.actionError).toContain('not awaiting');
    expect(state.awaitingInput).toBe(true);
  });

  // WR-06: everything that runs AFTER the action commits in
  // resumeSimultaneousAction — playerDone, the actions re-eval, allDone, and
  // flow advancement — is developer-callback code evaluating live game state,
  // exactly the failure class WR-02 covered on the sequential path. A throw
  // there must surface as FlowHaltedError so GameRunner records the committed
  // action; a plain Error would silently diverge actionHistory from applied
  // game state.
  it('wraps a post-commit playerDone throw in FlowHaltedError (WR-06)', () => {
    let committed = false;
    game.registerAction(
      Action.create('done').execute(() => {
        committed = true;
        return { success: true };
      })
    );

    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['done'],
        // Setup-time evaluation succeeds; the post-commit evaluation throws.
        playerDone: () => {
          if (!committed) return false;
          throw new Error('playerDone exploded');
        },
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    let caught: unknown;
    try {
      engine.resume('done', {}, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FlowHaltedError);
    expect((caught as Error).message).toContain('playerDone exploded');
  });

  it('wraps a post-commit allDone throw in FlowHaltedError (WR-06)', () => {
    const acted = new Set<number>();
    game.registerAction(
      Action.create('done').execute((args, ctx) => {
        acted.add(ctx.player.seat);
        return { success: true };
      })
    );

    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['done'],
        playerDone: (ctx, p) => acted.has(p.seat),
        // Setup-time evaluation succeeds; the post-commit evaluation throws.
        allDone: () => {
          if (acted.size === 0) return false;
          throw new Error('allDone exploded');
        },
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    let caught: unknown;
    try {
      engine.resume('done', {}, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FlowHaltedError);
    expect((caught as Error).message).toContain('allDone exploded');
  });

  it('wraps a post-commit actions() re-eval throw in FlowHaltedError (WR-06)', () => {
    let committed = false;
    game.registerAction(
      Action.create('done').execute(() => {
        committed = true;
        return { success: true };
      })
    );

    const flow = defineFlow({
      root: simultaneousActionStep({
        // Setup-time evaluations succeed; the post-commit re-eval throws.
        actions: () => {
          if (committed) throw new Error('actions re-eval exploded');
          return ['done'];
        },
        playerDone: () => false,
      }),
    });

    const engine = new FlowEngine(game, flow);
    engine.start();

    let caught: unknown;
    try {
      engine.resume('done', {}, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FlowHaltedError);
    expect((caught as Error).message).toContain('actions re-eval exploded');
  });
});

describe('Flow variable get() unset-key warning (F24)', () => {
  let game: TestGame;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });
    _clearShownWarnings();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns when ctx.get reads a flow variable that was never set (typo)', () => {
    let read: unknown = 'sentinel';
    const flow = defineFlow({
      root: execute((ctx) => {
        // Simulates a typo: setVar wrote 'turnCount' but get reads 'turnCout'.
        read = ctx.get('turnCout');
      }),
    });

    new FlowEngine(game, flow).start();

    expect(read).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain("ctx.get('turnCout')");
    expect(message).toContain('never set');
  });

  it('does NOT warn when the variable was set first (including set to undefined)', () => {
    const flow = defineFlow({
      root: sequence(
        setVar('turnCount', 0),
        setVar('maybe', undefined),
        execute((ctx) => {
          ctx.get('turnCount');
          ctx.get('maybe');
        })
      ),
    });

    new FlowEngine(game, flow).start();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn for a forEach-bound variable read inside the loop body', () => {
    const flow = defineFlow({
      root: forEach({
        collection: [1, 2, 3],
        as: 'num',
        do: execute((ctx) => {
          ctx.get('num');
        }),
      }),
    });

    new FlowEngine(game, flow).start();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
