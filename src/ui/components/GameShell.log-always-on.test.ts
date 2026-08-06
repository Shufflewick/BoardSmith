// @vitest-environment jsdom
/**
 * The game log is always on — a game cannot suppress it.
 *
 * GameShell used to expose `showHistory`, and a game passing
 * `:show-history="false"` lost the log entirely: GameHistory never mounted, and
 * because `historyPanel` was then null the ⋯ menu's copy-history and
 * clear-history went dead too, leaving no path to the transcript at all.
 *
 * The log is the shell's record of what happened and part of what makes a game
 * reviewable, so it is not a game's to remove — the same rule as the Action
 * Panel (see docs/action-panel-parity.test.ts). The ONE gate that remains is
 * the player's own sidebar-rail collapse, which the player chose and can undo.
 *
 * A game that needs a seat to see less does it by controlling what goes INTO
 * the log — `game.messageTo()`, enforced server-side — never by removing the
 * surface. See src/engine/element/message-audience.test.ts.
 *
 * Asserted on GameShell.vue's source, in the same style as the other
 * GameShell.*.test.ts files, because mounting the real shell needs client
 * wiring, a WS connection and the platform postMessage bridge.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'GameShell.vue'), 'utf8');

describe('game log cannot be suppressed by a game', () => {
  it('exposes no showHistory prop', () => {
    expect(
      source,
      'GameShell must not offer a way to hide the game log. A game that needs a seat ' +
        'to see less uses game.messageTo() to control what enters the log.',
    ).not.toMatch(/showHistory/);
  });

  it('gates GameHistory only on the player\'s own rail collapse', () => {
    const match = source.match(/<GameHistory\s+v-if="([^"]+)"/);
    expect(match, 'GameHistory must still render conditionally on layout only').not.toBeNull();
    expect(
      match![1],
      'the only gate on the log is the viewport / the player\'s own sidebar collapse',
    ).toBe('isCompact || !sidebarRail');
  });

  it('still mounts the history ref the copy/clear controls depend on', () => {
    // These menu items read `historyPanel`, so a log that never mounts silently
    // disables them too — that coupling is why suppression was so total.
    expect(source).toMatch(/ref="historyPanel"/);
    expect(source).toMatch(/@copy-history/);
    expect(source).toMatch(/@clear-history/);
  });
});
