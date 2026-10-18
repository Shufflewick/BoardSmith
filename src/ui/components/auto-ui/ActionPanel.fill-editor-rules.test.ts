// @vitest-environment jsdom
/**
 * #1057: THE PANEL AND A CUSTOM UI REFUSE THE SAME TEXT AND NUMBERS.
 *
 * The panel checked a text or number pick's rules before sending;
 * `controller.fill` did not, so a custom UI learned of a bad value only from the server. Each value
 * here goes through both, from the engine's own metadata sent through JSON, and
 * both must give the server's verdict in the server's words.
 */
import { describe, it, expect } from 'vitest';

import { Game, Player, Action, loop, eachPlayer, actionStep, type GameOptions } from '../../../engine/index.js';
import { buildActionMetadata } from '../../../engine/element/action-metadata.js';
import { textRuleErrors } from '../../../engine/action/text-rules.js';
import { numberRuleErrors } from '../../../engine/action/number-rules.js';
import { mountPanelAt, submitNumber, submitText } from './action-panel-editor.test-helper.js';
import type { EnrichedActionMetadata } from '../../composables/useActionControllerTypes.js';

const NUMBER_RULES = { min: 2, max: 9, integer: true };
const RULES = { minLength: 3, maxLength: 6, pattern: { regex: /^[a-z]+$/, message: 'Use lowercase letters only.' } };

class HandleGame extends Game<HandleGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<HandleGame>('handle').enterText('handle', { prompt: 'Handle', ...RULES }).execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<HandleGame>('bid').enterNumber('bid', { prompt: 'Bid', ...NUMBER_RULES }).execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 5, do: eachPlayer({ do: actionStep({ actions: ['handle', 'bid'] }) }) }) });
  }
}

function wireAction(name: 'handle' | 'bid' = 'handle'): EnrichedActionMetadata {
  const game = new HandleGame({ playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'fill-editor-rules' });
  game.startFlow();
  return JSON.parse(JSON.stringify(buildActionMetadata(game, game.getPlayer(1)!, [name])[name])) as EnrichedActionMetadata;
}

describe('a text pick refuses the same values in the panel and through controller.fill (#1057)', () => {
  for (const value of ['abc', 'abcdef', 'ab', 'abcdefg', 'Abc', 'ab1']) {
    const serverRefusal = textRuleErrors('handle', value, RULES)[0];
    const verdict = serverRefusal ? 'refuses' : 'accepts';

    it(`panel ${verdict} ${JSON.stringify(value)}`, async () => {
      const { wrapper, controller } = await mountPanelAt(wireAction());
      await submitText(wrapper, 'input[type="text"]', value);
      const error = wrapper.find('.text-input .selection-error');
      if (serverRefusal) {
        expect(error.text()).toBe(serverRefusal);
        expect(controller.currentArgs.value.handle).toBeUndefined();
      } else {
        expect(error.exists()).toBe(false);
        expect(controller.currentArgs.value.handle).toBe(value);
      }
      wrapper.unmount();
    });

    it(`custom UI ${verdict} ${JSON.stringify(value)}`, async () => {
      const { wrapper, controller } = await mountPanelAt(wireAction());
      const result = await controller.fill('handle', value);
      if (serverRefusal) {
        expect(result).toEqual({ valid: false, error: serverRefusal });
        expect(controller.lastError.value).toBe(serverRefusal);
        expect(controller.currentArgs.value.handle).toBeUndefined();
      } else {
        expect(result.valid).toBe(true);
        expect(controller.currentArgs.value.handle).toBe(value);
      }
      wrapper.unmount();
    });
  }

  it('custom UI: a value that is not a string is refused as the server refuses it', async () => {
    const { wrapper, controller } = await mountPanelAt(wireAction());
    expect(await controller.fill('handle', 42)).toEqual({ valid: false, error: 'handle must be a string' });
    wrapper.unmount();
  });
});

describe('a number pick refuses the same values in the panel and through controller.fill (#1057)', () => {
  for (const value of [2, 9, 1, 10, 4.5]) {
    const serverRefusal = numberRuleErrors('bid', value, NUMBER_RULES)[0];
    const verdict = serverRefusal ? 'refuses' : 'accepts';

    it(`panel ${verdict} ${value}`, async () => {
      const { wrapper, controller } = await mountPanelAt(wireAction('bid'));
      await submitNumber(wrapper, value);
      const error = wrapper.find('.number-input .selection-error');
      if (serverRefusal) {
        expect(error.text()).toBe(serverRefusal);
        expect(controller.currentArgs.value.bid).toBeUndefined();
      } else {
        expect(error.exists()).toBe(false);
        expect(controller.currentArgs.value.bid).toBe(value);
      }
      wrapper.unmount();
    });

    it(`custom UI ${verdict} ${value}`, async () => {
      const { wrapper, controller } = await mountPanelAt(wireAction('bid'));
      const result = await controller.fill('bid', value);
      if (serverRefusal) {
        expect(result).toEqual({ valid: false, error: serverRefusal });
        expect(controller.lastError.value).toBe(serverRefusal);
        expect(controller.currentArgs.value.bid).toBeUndefined();
      } else {
        expect(result.valid).toBe(true);
        expect(controller.currentArgs.value.bid).toBe(value);
      }
      wrapper.unmount();
    });
  }

  it('custom UI: a value that is not a number is refused as the server refuses it', async () => {
    const { wrapper, controller } = await mountPanelAt(wireAction('bid'));
    expect(await controller.fill('bid', '4')).toEqual({ valid: false, error: 'bid must be a number' });
    wrapper.unmount();
  });
});
