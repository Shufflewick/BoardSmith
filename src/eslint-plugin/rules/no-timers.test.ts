import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-timers.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

ruleTester.run('no-timers', rule, {
  valid: [
    // Game logic completes synchronously; a plain call is fine.
    { code: `game.finish([winner]);` },
    // A timer NAME used as a value, not called, is not a timer call.
    { code: `const handler = () => {}; const name = 'setTimeout';` },
    // A promise is not a timer.
    { code: `const result = await Promise.resolve(1);` },
    // Clearing is not scheduling; the rule targets the scheduling calls.
    { code: `clearTimeout(handle);` },
    // A domain method that happens to share a timer's name on some other
    // receiver is not a timer (#38) — only a known global receiver is.
    { code: `scheduler.setTimeout(turnOrder);` },
    { code: `this.clock.setInterval(4);` },
  ],
  invalid: [
    { code: `setTimeout(() => {}, 100);`, errors: [{ messageId: 'noSetTimeout' }] },
    { code: `setInterval(() => {}, 100);`, errors: [{ messageId: 'noSetInterval' }] },
    { code: `setImmediate(() => {});`, errors: [{ messageId: 'noSetImmediate' }] },
    { code: `requestAnimationFrame(() => {});`, errors: [{ messageId: 'noRAF' }] },

    // Reached through a global object rather than bare.
    { code: `window.setTimeout(() => {}, 0);`, errors: [{ messageId: 'noSetTimeout' }] },
    { code: `globalThis.setInterval(() => {}, 0);`, errors: [{ messageId: 'noSetInterval' }] },
    { code: `global.setImmediate(() => {});`, errors: [{ messageId: 'noSetImmediate' }] },
    { code: `window.requestAnimationFrame(() => {});`, errors: [{ messageId: 'noRAF' }] },

    // Inside the place a game author would actually write it.
    {
      code: `
        class MyGame extends Game {
          endTurn() {
            setTimeout(() => this.advance(), 500);
          }
        }
      `,
      errors: [{ messageId: 'noSetTimeout' }],
    },

    // Each scheduling call is reported, not just the first.
    {
      code: `setTimeout(a, 1); setInterval(b, 2);`,
      errors: [{ messageId: 'noSetTimeout' }, { messageId: 'noSetInterval' }],
    },
  ],
});
