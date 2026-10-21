/**
 * #1356: the "Testing your sampler" recipe in `docs/bot-system.md` must build
 * the copy the bot searches. Since #1352 `loadSerializedState` runs no
 * `afterRestore` hook; the bot's `restoreGame` runs them itself, after the
 * sampler, so the recipe has to as well.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game, Player, Space, type GameOptions } from '../src/engine/index.js';
import { adoptSeatView, applyDeterminization } from '../src/bot/index.js';

const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bot-system.md'), 'utf-8');

class HiddenPage extends Space<HiddenGame> {
  static override visibleAttributes = ['name'];
  data: { kind: string } | null = null;
  protected override afterRestore(): void {
    if (!this.isAttributeRedacted('data') && this.data) Object.freeze(this.data);
  }
}

class HiddenGame extends Game<HiddenGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HiddenPage]);
  }
}

describe('the sampler-testing recipe in docs/bot-system.md (#1356)', () => {
  it('runs the afterRestore hooks after applyDeterminization, as the bot does', () => {
    const section = doc.slice(doc.indexOf('### Testing your sampler'), doc.indexOf('### What the check costs'));
    const sampled = section.indexOf('applyDeterminization(sandbox');
    const hooks = section.indexOf('sandbox._afterRestoreSubtree()');

    expect(sampled, 'the recipe should run the sampler on the sandbox').toBeGreaterThan(-1);
    expect(hooks, 'the recipe should run the afterRestore hooks after the sampler, as restoreGame does').toBeGreaterThan(sampled);
  });

  it('gives the hooks the world the sampler drew when its steps are followed', () => {
    const options = { playerCount: 2, elementIdKey: '0123456789abcdef' };
    const truth = new HiddenGame(options);
    truth.create(HiddenPage, 'page').data = { kind: 'real' };

    const sandbox = new HiddenGame(options);
    sandbox.loadSerializedState(truth.toJSONForPlayer(1));
    adoptSeatView(sandbox, 1);
    applyDeterminization(sandbox, 1, (game) => {
      game.first(HiddenPage)!.data = { kind: 'sampled' };
    }, () => 0.5);
    sandbox._afterRestoreSubtree();

    const page = sandbox.first(HiddenPage)!;
    expect(page.data).toEqual({ kind: 'sampled' });
    expect(Object.isFrozen(page.data)).toBe(true);
  });
});
