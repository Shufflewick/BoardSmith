/**
 * What a player is told when an action's rules threw something that was not written for them to
 * read: the start of every such message. Kept apart from `action.ts` so the in-browser smoke walk
 * can tell a crash in the rules from a refusal the game wrote, with nothing else of the engine in
 * its bundle (#466).
 */
export function rulesErrorSentence(actionName: string): string {
  return `The "${actionName}" action could not be completed because of an error in the game's rules.`;
}
