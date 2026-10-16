import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-eval.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

ruleTester.run('no-eval', rule, {
  valid: [
    // Ordinary function values and calls.
    { code: `const add = (a, b) => a + b; const sum = add(1, 2);` },
    // JSON parsing is the sanctioned way to turn text into data.
    { code: `const data = JSON.parse(text);` },
    // A property merely named eval on a game object is not the global eval.
    { code: `const result = calculator.evaluate('1+1');` },
    // Declaring a function is not constructing one from a string.
    { code: `function Function2() {}` },
    // A game's own eval, and checking whether something is a function (#737).
    { code: `const calc = { eval: (s) => s }; calc.eval('1');` },
    { code: `const isFn = value instanceof Function;` },
  ],
  invalid: [
    // Every other spelling of the same call (#737).
    { code: `globalThis.eval('1');`, errors: [{ messageId: 'noEval' }] },
    { code: `const run = eval; run('1');`, errors: [{ messageId: 'noEval' }] },
    { code: `new globalThis.Function('a');`, errors: [{ messageId: 'noFunction' }] },
    { code: `eval('1 + 1');`, errors: [{ messageId: 'noEval' }] },
    { code: `const fn = new Function('a', 'return a');`, errors: [{ messageId: 'noFunction' }] },
    { code: `const fn = Function('a', 'return a');`, errors: [{ messageId: 'noFunction' }] },
    {
      code: `
        class MyGame extends Game {
          applyRule(source) {
            return eval(source);
          }
        }
      `,
      errors: [{ messageId: 'noEval' }],
    },
    {
      code: `eval('a'); new Function('b');`,
      errors: [{ messageId: 'noEval' }, { messageId: 'noFunction' }],
    },
    // The message says WHY, so the author is not left guessing.
    { code: `eval('x');`, errors: [{ message: /security risk/ }] },
  ],
});
