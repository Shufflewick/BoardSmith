// @vitest-environment jsdom
/**
 * #890: A TEXT PATTERN'S FLAGS REACH THE CLIENT.
 *
 * The wire carried only a pattern's `source`, so the panel compiled `/^\p{L}+$/u`
 * without `u` (where `\p{L}` means the letter "p") and `/^[a-z]+$/i` without `i`:
 * it refused "Zoë" and "ABC" while the server accepted them. Each case here runs
 * the engine's own metadata through JSON, as a host sends it, and holds the panel
 * to the engine's verdict on the declared regex.
 */
import { describe, it, expect } from 'vitest';

import { Game, Player, Action, loop, eachPlayer, actionStep, type GameOptions } from '../../../engine/index.js';
import { buildActionMetadata } from '../../../engine/element/action-metadata.js';
import { textRuleErrors } from '../../../engine/action/text-rules.js';
import { mountPanelAt, submitText } from './action-panel-editor.test-helper.js';
import type { EnrichedActionMetadata } from '../../composables/useActionControllerTypes.js';

const LETTERS = { regex: /^\p{L}+$/u, message: 'Use letters only.' };
const CASELESS = { regex: /^[a-z]+$/i, message: 'Use letters a to z only.' };

class PatternGame extends Game<PatternGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<PatternGame>('name').enterText('name', { prompt: 'Name', pattern: LETTERS }).execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<PatternGame>('code').enterText('code', { prompt: 'Code', pattern: CASELESS }).execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 5, do: eachPlayer({ do: actionStep({ actions: ['name', 'code'] }) }) }) });
  }
}

function wireAction(name: 'name' | 'code'): EnrichedActionMetadata {
  const game = new PatternGame({ playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'pattern-flags' });
  game.startFlow();
  const metadata = buildActionMetadata(game, game.getPlayer(1)!, [name]);
  return JSON.parse(JSON.stringify(metadata[name])) as EnrichedActionMetadata;
}

const cases = [
  { action: 'name', pattern: LETTERS, values: ['abc', 'Zoë', 'Zoë1', 'a b'] },
  { action: 'code', pattern: CASELESS, values: ['ABC', 'abc', 'AB1'] },
] as const;

describe('a pattern with flags is checked with them (#890)', () => {
  for (const { action, pattern, values } of cases) {
    for (const value of values) {
      const serverRefusal = textRuleErrors(action, value, { pattern })[0];

      it(`panel: /${pattern.regex.source}/${pattern.regex.flags} ${serverRefusal ? 'refuses' : 'accepts'} ${JSON.stringify(value)}, as the server does`, async () => {
        const { wrapper, controller } = await mountPanelAt(wireAction(action));
        await submitText(wrapper, 'input[type="text"]', value);
        const error = wrapper.find('.text-input .selection-error');
        if (serverRefusal) {
          expect(error.text()).toBe(serverRefusal);
          expect(controller.currentArgs.value[action]).toBeUndefined();
        } else {
          expect(error.exists()).toBe(false);
          expect(controller.currentArgs.value[action]).toBe(value);
        }
        wrapper.unmount();
      });
    }
  }

  it("leaves the browser's own pattern check off, since it compiles the source under other flags", async () => {
    const { wrapper } = await mountPanelAt(wireAction('name'));
    expect(wrapper.find('.text-input input[type="text"]').attributes('pattern')).toBeUndefined();
    wrapper.unmount();
  });

  it('custom UI: the pick read from the controller carries the flags, and the value it fills is sent', async () => {
    const { wrapper, controller, sendAction } = await mountPanelAt(wireAction('name'));
    expect(controller.currentPick.value?.pattern).toEqual({ source: '^\\p{L}+$', flags: 'u', message: 'Use letters only.' });
    expect((await controller.fill('name', 'Zoë')).valid).toBe(true);
    await controller.execute('name', { name: 'Zoë' });
    expect(sendAction).toHaveBeenCalledWith('name', { name: 'Zoë' });
    wrapper.unmount();
  });
});
