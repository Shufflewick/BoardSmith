import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { StatePushGate } from './state-push-gate.js';
import { applyViewPatch, diffView, patchView, stampRev } from './view-patch.js';

/**
 * #1616 against whole recorded games: every view of record `SnapshotSessionHost`
 * handed `record`, for every seat and the spectators, after every change of a
 * game played to its end by easy bots on every seat (seed `bs1616`), one entry
 * per change: `{ players, spectator }`. Brotli-compressed JSON.
 *
 * - `cribbage`: ~/BoardSmithGames/cribbage at 894f17ea, 2 players, `targetScore` 61.
 * - `polyhedral-potions`: ~/BoardSmithGames/polyhedral-potions at 9017312d, 2 players.
 *
 * The ticket named MERC as the second game; that game was retired and its
 * state may not appear in this repo (#1603), so the catalogue game with the
 * most elements on its board stands in.
 */
type Recorded = Array<{ players: unknown[]; spectator: unknown }>;

// Links the recordings to this test, so a change to one runs it (vitest --changed).
import.meta.glob(['./testing/fixtures/recorded-views/*.json.br']);

function recorded(game: string): Recorded {
  return JSON.parse(brotliDecompressSync(readFileSync(new URL(`./testing/fixtures/recorded-views/${game}.json.br`, import.meta.url))).toString());
}

const games = { cribbage: recorded('cribbage'), 'polyhedral-potions': recorded('polyhedral-potions') };

/** Each seat's views in order: seat 0 is the spectators. */
function seatSequences(game: Recorded): Map<number, unknown[]> {
  const seats = new Map<number, unknown[]>([[0, game.map((views) => views.spectator)]]);
  game[0]!.players.forEach((_, i) => seats.set(i + 1, game.map((views) => views.players[i])));
  return seats;
}

describe.each(Object.entries(games))('recorded %s game', (_name, game) => {
  it('records a whole game', () => {
    expect(game.length).toBeGreaterThan(50);
    expect((game.at(-1)!.players[0] as { flowState: { complete?: boolean } }).flowState.complete).toBe(true);
  });

  it('applying each diff to the first view reproduces every later view exactly, for every seat', () => {
    for (const views of seatSequences(game).values()) {
      let held = views[0];
      for (const view of views.slice(1)) {
        held = patchView(held, diffView(held, view));
        expect(held).toStrictEqual(view);
      }
    }
  });

  it('a page that applies every push the gate makes holds every view of record exactly, for every seat', () => {
    for (const [seat, views] of seatSequences(game)) {
      const gate = new StatePushGate<number>();
      let held: unknown;
      for (const view of views.map(stampRev)) {
        const push = gate.toPush(seat, { view });
        if (push === undefined) continue;
        held = 'view' in push ? push.view : applyViewPatch(held, push.patch);
        expect(held).toStrictEqual(view);
      }
    }
  });
});
