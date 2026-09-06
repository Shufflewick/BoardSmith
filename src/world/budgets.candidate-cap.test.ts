/**
 * R2 (#170 §8): two numbers for one phenomenon, set by two tickets.
 *
 * `MAX_FLAT_CHOICE_CANDIDATES` (#172) is the panel's READING threshold: past it
 * a wrapping row of pills is an unlabelled grid, so the panel hands the pick to
 * the board instead. `maxCandidatesPerSelection` (#169) is the host's SAFETY
 * NET: past it the offer's size is a function of the resident tree rather than
 * of the declaration, so the world is refused when it is built.
 *
 * They are not competing values, and the relationship is stated once, here: the
 * engine's cap is strictly larger. If a host set it below 24 the panel's
 * deferral rule would be unreachable for worlds -- every set the engine allowed
 * would already be small enough to render as buttons -- and #172's board handoff
 * would be dead code no test could catch.
 */
import { describe, it, expect } from 'vitest';
import { worldBudgets } from './budgets.js';
import { MAX_FLAT_CHOICE_CANDIDATES } from '../engine/element/action-metadata.js';

describe('R2: the engine cap is the safety net above the panel threshold', () => {
  it('ships a default well above the panel threshold', () => {
    expect(worldBudgets().maxCandidatesPerSelection).toBeGreaterThan(MAX_FLAT_CHOICE_CANDIDATES);
  });

  it('lets a host raise it', () => {
    expect(worldBudgets({ maxCandidatesPerSelection: 400 }).maxCandidatesPerSelection).toBe(400);
  });

  it('refuses a host that sets it at or below the panel threshold', () => {
    expect(() => worldBudgets({ maxCandidatesPerSelection: MAX_FLAT_CHOICE_CANDIDATES }))
      .toThrow(/maxCandidatesPerSelection/);
    expect(() => worldBudgets({ maxCandidatesPerSelection: 10 }))
      .toThrow(new RegExp(String(MAX_FLAT_CHOICE_CANDIDATES)));
  });

  it('says why, in a sentence a host can act on', () => {
    expect(() => worldBudgets({ maxCandidatesPerSelection: 4 }))
      .toThrow(/board/i);
  });
});
