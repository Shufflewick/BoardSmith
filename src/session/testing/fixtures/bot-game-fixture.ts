/**
 * The bot-capable fixture: a 2-seat game carrying a real `ai` config, so ops
 * that need a bot (`hint`, `heatmapToggle`, the AI-vs-AI demo loop) are
 * reachable from ANY test file.
 *
 * It lived inside `snapshot-session-host.test.ts` until Phase 68 — already
 * `export`ed, but from a file whose top-level `describe(...)` blocks would be
 * registered a SECOND time by anyone who imported it. That made it exported and
 * still unreachable, the same defect class `boundary-key.test.ts`'s reachability
 * test exists to catch. It is a fixture, so it now lives with the fixtures.
 *
 * Its flow is `loop(actionStep(..., repeatUntil: () => false))`, which keeps the
 * SAME action-step frame open across repeated `move` actions. Two consequences
 * it is chosen for:
 *  - undo is frame-scoped (UNDO-03), so undo actually has something to undo;
 *  - the turn boundary stands STILL across a move, so a teaching op's
 *    re-broadcast can be compared against the preceding one
 *    (`turn-boundary.test.ts` case 5b, the production path for Pitfall 3).
 *
 * MEMORY note: MCTS short-circuits when only 1 move is available — the bot
 * skips the clone step. Tests that need real MCTS branching require 2+ choices,
 * which is why `move` offers `chooseFrom('direction', ['left', 'right'])`.
 */

import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../../engine/index.js';
import type { AIConfig } from '../../../ai/types.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

export class BotGame extends Game<BotGame, Player> {
  moveCount = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('move')
        .chooseFrom('direction', { choices: ['left', 'right'] })
        .execute(() => {
          this.moveCount++;
          return { success: true };
        }),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          // 155-03: repeatUntil (never true within these tests) keeps the
          // SAME action-step frame -- and its moveCount -- open across
          // repeated 'move' actions. Without it, a plain single-move
          // actionStep auto-completes and reopens a FRESH frame
          // (moveCount === 0) after every move, and undo (now frame-scoped,
          // UNDO-03) would always report "No actions to undo" -- this
          // fixture's undo test needs undo to actually succeed.
          do: actionStep({
            actions: ['move'],
            player: (ctx) => ctx.game.getPlayer(1)!,
            repeatUntil: () => false,
          }),
        }),
      }),
    );
  }
}

// Extended def type — supports ai config (Plans 02/03 will add ai? to GameDefinitionLike;
// for now this test-local interface allows the fixture to carry the ai config).
interface BotGameDefinitionLike extends GameDefinitionLike {
  ai?: AIConfig;
}

const botGameAI: AIConfig = {
  objectives: (_game, _playerIndex) => ({
    moves: {
      checker: (game) => Math.min(1, (game as BotGame).moveCount / 20),
      weight: 1,
    },
  }),
  // Extract 'direction' arg as notation so heatmap entries have extractable cell refs.
  // Without this, DEST_ARGS fallback wouldn't find 'direction' and entries would be empty.
  hintTargetFromMove: (move) => {
    const dir = (move.args as { direction?: string }).direction;
    return dir ? { notation: dir } : undefined;
  },
};

export const botGameDef: BotGameDefinitionLike = {
  gameClass: BotGame as new (...args: unknown[]) => unknown,
  gameType: 'bot-game',
  minPlayers: 1,
  maxPlayers: 2,
  ai: botGameAI,
};

export const botGameOptions = { playerCount: 2, seed: 'bot-seed' };
