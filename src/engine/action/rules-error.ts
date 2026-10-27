import { isDevThrowEnabled } from '../../utils/dev.js';

/** Said by the runner, and only after it has rolled a failed action back (#808, #989). */
export const NOTHING_CHANGED = 'Nothing was changed.';

/**
 * What a player is told when an action's rules threw something that was not written for them to
 * read: the start of every such message. Kept apart from `action.ts` so the in-browser smoke walk
 * can tell a crash in the rules from a refusal the game wrote, with nothing else of the engine in
 * its bundle (#466).
 */
export function rulesErrorSentence(actionName: string): string {
  return `The "${actionName}" action could not be completed because of an error in the game's rules.`;
}

/**
 * `sentence`, the player's words for a throw nobody wrote for them, with the thrown text after it
 * only where `isDevThrowEnabled` says the reader is the author (#47, #1045).
 */
export function withDevDetail(sentence: string, error: unknown): string {
  return isDevThrowEnabled() ? `${sentence} (${thrownText(error)})` : sentence;
}

function thrownText(error: unknown): string {
  if (error instanceof Error) return error.message;
  // A thrown value with no string form must not turn reporting the crash into a second one.
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}
