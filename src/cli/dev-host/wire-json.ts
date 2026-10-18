/**
 * WHAT A PAGE RECEIVES: a host message encoded as the wire carries it.
 *
 * Every `boardsmith dev` send to a page uses this, and so does every answer a
 * rules worker hands the host (#885), so a value reaches the page in one shape
 * whichever thread made it: a game element as its `toJSON`, never a live object.
 */
export function toWireJson(message: unknown): string {
  return JSON.stringify(message);
}
