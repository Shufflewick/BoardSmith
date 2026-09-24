/**
 * THE DEPARTURE GRACE: ONE DEFAULT AND ONE RANGE, FOR EVERY HOST (#338).
 *
 * `world.presence.departGraceMs` is how long a seat's last socket may be gone
 * before the world is told the seat left. Which hooks run, and what a socket
 * close means, are a host's lifecycle policy; the grace's default and its
 * bounds are not. A laptop that used a different default from the platform ran
 * `onArrive` on every page reload that production treats as a flap, so an
 * author's local run was a poor guide to their published one.
 *
 * Every host reads the grace through {@link presenceDepartGraceMs}:
 * `boardsmith dev`'s `LocalWorldHost`, and ShufflewickPub's presence policy.
 */
import { worldRefusal } from './refusals.js';

/** A minute: long enough that a phone changing networks is nobody's
 *  departure, and short enough that "left" is answered while it matters. */
export const WORLD_PRESENCE_DEFAULT_GRACE_MS = 60_000;

/** The floor: a departure shorter than a second is a network hiccup, and the
 *  floor keeps a flap from running game code per blip. */
export const WORLD_PRESENCE_MIN_GRACE_MS = 1_000;

/** The ceiling: a grace measured in days is enrolment, not presence. */
export const WORLD_PRESENCE_MAX_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The grace a bundle declared, defaulted and bounded, or a refusal.
 *
 * REFUSED RATHER THAN CLAMPED: a silently clamped number is a declaration that
 * lies about what the world will do. The refusal names the range and the
 * default, so the author can fix the number in one edit.
 */
export function presenceDepartGraceMs(declared: number | undefined): number {
  const grace = declared ?? WORLD_PRESENCE_DEFAULT_GRACE_MS;
  if (
    Number.isFinite(grace) &&
    grace >= WORLD_PRESENCE_MIN_GRACE_MS &&
    grace <= WORLD_PRESENCE_MAX_GRACE_MS
  ) {
    return grace;
  }
  throw worldRefusal(
    'bundle-not-a-world',
    `This bundle's \`world.presence.departGraceMs\` is ${String(declared)}, and a world ` +
      `accepts ${WORLD_PRESENCE_MIN_GRACE_MS} through ${WORLD_PRESENCE_MAX_GRACE_MS} ` +
      'milliseconds. Below the floor a network hiccup reads as a departure; above the ceiling ' +
      '"left" stops meaning anything within a season. Pick a number inside the bounds, or ' +
      `omit the field for the default (${WORLD_PRESENCE_DEFAULT_GRACE_MS}ms).`,
  );
}
