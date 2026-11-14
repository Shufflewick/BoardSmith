/**
 * The one thing that removes the Action Panel is the platform's escape hatch: every action a game
 * offers is in the panel (#1643), and a game cannot hide one.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Links the files this test reads by path, so `--changed` runs it when one alone changes; nothing loads (#1418).
import.meta.glob(['./GameShell.vue', './PlayShell.vue']);

const here = path.dirname(fileURLToPath(import.meta.url));

describe('the platform Action Panel escape hatch', () => {
  const gameShellSource = fs.readFileSync(path.join(here, 'GameShell.vue'), 'utf-8');

  it('the platform escape hatch survives the #170 split, relayed and not re-decided', () => {
    // The adapter DECLARES it, defaults it, and RELAYS it; the shared chrome
    // declares it and branches on it ONCE -- the prompt strip it turns on and
    // the panel it turns off are the two arms of one v-if/v-else, which is why
    // neither surface can go missing. What must never appear is a SECOND
    // decision: the shell re-deriving the hatch from something of its own.
    const playShellSource = fs.readFileSync(
      path.join(here, 'PlayShell.vue'),
      'utf-8',
    );
    expect(gameShellSource.split('platformActionPanelEscapeHatch').length - 1)
      .toBeGreaterThanOrEqual(3);
    expect(playShellSource.split('platformActionPanelEscapeHatch').length - 1)
      .toBeGreaterThanOrEqual(2);
    expect(playShellSource).toMatch(/v-if="platformActionPanelEscapeHatch"[\s\S]{0,400}<template v-else>/);
    expect(gameShellSource).not.toContain('suppressActionPanel');
    expect(playShellSource).not.toContain('suppressActionPanel');
  });
});
