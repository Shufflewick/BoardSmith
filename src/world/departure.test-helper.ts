import { worldAction } from "./action.js";

/**
 * A DEPARTURE HOOK THAT GIVES NOTHING BACK, for a fixture world whose tests are
 * about something else. Every world names one as `world.vacate`
 * (ShufflewickPub #813); a world whose seats hold no ground needs no more.
 */
export const leaveNothing = worldAction("leave")
  .needs(() => [])
  .execute(() => {});
