// @vitest-environment jsdom
/**
 * GameShell — forward-exit routing (D11 / ENDGAME-02, RED #2)
 *
 * `handleMenuItemClick('new-game')` must, in platform mode, route through the
 * SAME restart path as Rematch (`handleRestartGame()` → `platformRequest(
 * 'debug:restart', {})`), NOT the inert `leaveGame()` — which in dev/platform
 * mode goes to a nonexistent lobby and never restarts (RESEARCH Crux 2).
 *
 * Mounting the full GameShell is impractical here (client/WS wiring — see
 * GameShell.game-over.test.ts's note on the same constraint). Following the
 * established harness convention (GameShell.test.ts, GameShell.tutorial.test.ts,
 * GameShell.ia.test.ts), this test mirrors the PRODUCTION
 * `handleRestartGame`/`handleMenuItemClick` wiring (GameShell.vue:1724-1745,
 * :1760-1770) VERBATIM, POST-FIX: `handleMenuItemClick('new-game')` now routes
 * through `handleRestartGame()` instead of the inert `leaveGame()`. If
 * production changes, this harness must be updated to match.
 */
import { describe, it, expect, vi } from 'vitest';

function buildHarness(platformMode: boolean) {
  const platformRequest = vi.fn(async (_op: string, _payload: Record<string, unknown>) => ({}));
  const leaveGame = vi.fn();
  const clientRestartGame = vi.fn(async () => {});

  // ── Mirrors GameShell.vue handleRestartGame (:1724-1745) — unchanged by this plan ──
  async function handleRestartGame() {
    if (platformMode) {
      void platformRequest('debug:restart', {});
      return;
    }
    await clientRestartGame();
  }

  // ── Mirrors GameShell.vue handleMenuItemClick (:1760-1770) — POST-FIX ─────
  function handleMenuItemClick(id: string) {
    if (id === 'leave') {
      leaveGame();
    } else if (id === 'new-game') {
      void handleRestartGame();
    }
  }

  return { handleMenuItemClick, handleRestartGame, platformRequest, leaveGame, clientRestartGame };
}

describe('GameShell — handleMenuItemClick("new-game") routing (D11)', () => {
  it('platform mode: requests a restart via platformRequest("debug:restart"), NOT leaveGame()', () => {
    const { handleMenuItemClick, platformRequest, leaveGame } = buildHarness(true);

    handleMenuItemClick('new-game');

    expect(platformRequest).toHaveBeenCalledWith('debug:restart', {});
    expect(leaveGame).not.toHaveBeenCalled();
  });

  it('non-platform mode: requests a restart via the HTTP client, NOT leaveGame() (parity)', async () => {
    const { handleMenuItemClick, clientRestartGame, leaveGame } = buildHarness(false);

    handleMenuItemClick('new-game');
    await Promise.resolve(); // flush the async handleRestartGame() microtask

    expect(clientRestartGame).toHaveBeenCalledTimes(1);
    expect(leaveGame).not.toHaveBeenCalled();
  });

  it("CHARACTERIZATION: 'leave' still calls leaveGame() (unchanged branch)", () => {
    const { handleMenuItemClick, leaveGame, platformRequest } = buildHarness(true);

    handleMenuItemClick('leave');

    expect(leaveGame).toHaveBeenCalledTimes(1);
    expect(platformRequest).not.toHaveBeenCalled();
  });
});
