import type { Game } from '../engine/index.js';
import { picksFromSeat } from '../engine/element/seat-placeholders.js';
import type { MCTSBot } from './mcts-bot.js';
import type { BotMove } from './types.js';

/**
 * What `bot` found for its seat: the move as the bot names it, a wait (#1537),
 * or a stall with the bot's reason, if it gave one (#29). The live session's
 * botSuggest and {@link playSeatMove} both read a search through this (#1715).
 */
export async function searchSeat(
  bot: MCTSBot,
): Promise<{ move: BotMove } | { wait: { until?: number } } | { stall: string | undefined }> {
  const move = await bot.play();
  if (move) return { move };
  if (bot.lastWait) return { wait: bot.lastWait };
  return { stall: bot.lastStallReason };
}

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
  const found = await searchSeat(bot);
  // A harness stops on a wait with no instant; holding the seat as the live host does would change sim and benchmark results (#1715).
  if ('wait' in found && found.wait.until !== undefined) return { waitUntil: found.wait.until };
  if (!('move' in found)) return { stall: bot.lastStallReason ?? 'no reason recorded' };
  // The bot names a card its seat cannot see by that seat's placeholder, as a client would (#715).
  return { action: found.move.action, args: picksFromSeat(game, found.move.action, found.move.args, seat) };
}
