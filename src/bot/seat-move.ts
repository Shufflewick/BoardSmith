import type { Game } from '../engine/index.js';
import { picksFromSeat } from '../engine/element/seat-placeholders.js';
import type { MCTSBot } from './mcts-bot.js';

/**
 * The move `bot` makes for `seat` as a client would send it, the instant it
 * waits for on the step clock (#1541), or why it has no move (#29). The
 * benchmark and the sim's mcts policy both play bots through this (#1701).
 */
export async function playSeatMove(
  bot: MCTSBot,
  game: Game,
  seat: number,
): Promise<{ action: string; args: Record<string, unknown> } | { waitUntil: number } | { stall: string }> {
  const move = await bot.play();
  if (!move && bot.lastWait?.until !== undefined) return { waitUntil: bot.lastWait.until };
  if (!move) return { stall: bot.lastStallReason ?? 'no reason recorded' };
  // The bot names a card its seat cannot see by that seat's placeholder, as a client would (#715).
  return { action: move.action, args: picksFromSeat(game, move.action, move.args, seat) };
}
