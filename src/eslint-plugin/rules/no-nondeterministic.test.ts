import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-nondeterministic.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

ruleTester.run('no-nondeterministic', rule, {
  valid: [
    // The sanctioned replacement: the game's own seeded generator.
    { code: `const roll = Math.floor(game.random() * 6) + 1;` },
    // Deterministic Math is untouched — only `random` is forbidden.
    { code: `const total = Math.max(a, b) + Math.floor(c);` },
    // A Date built from a FIXED value is reproducible, so it is allowed.
    { code: `const start = new Date(0);` },
    { code: `const parsed = new Date('2020-01-01T00:00:00Z');` },
    // Reading a stored timestamp is not generating one.
    { code: `const when = game.settings.startedAt;` },
    // A method named random on something that is not Math.
    { code: `const value = rng.random();` },
  ],
  invalid: [
    {
      code: `const roll = Math.random();`,
      errors: [{ messageId: 'noMathRandom' }],
    },
    {
      code: `const now = Date.now();`,
      errors: [{ messageId: 'noDateNow' }],
    },
    {
      code: `const now = new Date();`,
      errors: [{ messageId: 'noNewDate' }],
    },
    {
      code: `const id = crypto.randomUUID();`,
      errors: [{ messageId: 'noCryptoRandom' }],
    },
    {
      code: `crypto.getRandomValues(new Uint8Array(8));`,
      errors: [{ messageId: 'noCryptoRandom' }],
    },
    {
      code: `const t = performance.now();`,
      errors: [{ messageId: 'noPerformanceNow' }],
    },
    // The message has to point at the fix, not just the ban — this is the
    // difference between a rule a game author can act on and one they cannot.
    {
      code: `const roll = Math.random();`,
      errors: [{ message: /game\.random/ }],
    },
    // Realistic shuffle written the wrong way.
    {
      code: `
        class MyGame extends Game {
          setup() {
            this.deck.sort(() => Math.random() - 0.5);
          }
        }
      `,
      errors: [{ messageId: 'noMathRandom' }],
    },
    // Several distinct sources of nondeterminism in one file.
    {
      code: `const a = Math.random(); const b = Date.now(); const c = new Date();`,
      errors: [
        { messageId: 'noMathRandom' },
        { messageId: 'noDateNow' },
        { messageId: 'noNewDate' },
      ],
    },
  ],
});
