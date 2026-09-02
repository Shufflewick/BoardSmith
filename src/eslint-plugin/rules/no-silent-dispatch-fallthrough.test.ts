import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-silent-dispatch-fallthrough.js';

// Same harness convention as the other rules in this plugin: plain `eslint`
// RuleTester with `@typescript-eslint/parser` for TS syntax.
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-silent-dispatch-fallthrough', rule, {
  valid: [
    // A switch is exhaustive-checkable by TypeScript -- the right shape.
    {
      code: `
        for (const card of cards) {
          switch (card.type) {
            case 'draw': outcomes.push(draw(card)); break;
            default: outcomes.push(unhandled(card));
          }
        }
      `,
    },
    // The chain ends in an else, so nothing falls through unrecorded.
    {
      code: `
        for (const card of cards) {
          if (card.type === 'draw') { draw(card); continue; }
          if (card.type === 'play') { play(card); continue; }
          else { outcomes.push(refuse(card)); }
        }
      `,
    },
    // Guard clauses followed by real work: the work runs for everything that
    // survives the guards, so nothing is silently skipped.
    {
      code: `
        for (const card of cards) {
          if (card.spent) continue;
          if (!card.owner) continue;
          outcomes.push(resolve(card));
        }
      `,
    },
    // A single trailing if/continue is a filter, not a dispatch chain.
    {
      code: `
        for (const card of cards) {
          seen.push(card);
          if (card.spent) { skipped.push(card); continue; }
        }
      `,
    },
    // Work after the chain: every unmatched item still reaches it.
    {
      code: `
        for (const card of cards) {
          if (card.type === 'draw') { draw(card); continue; }
          if (card.type === 'play') { play(card); continue; }
          outcomes.push(unhandled(card));
        }
      `,
    },
  ],

  invalid: [
    // The #161 shape: a for-of dispatch chain over a card type with no final
    // else -- a card matching nothing is announced and then does nothing.
    {
      code: `
        for (const card of cards) {
          log(\`resolving \${card.name}\`);
          if (card.type === 'draw') { draw(card); continue; }
          if (card.type === 'play') { play(card); continue; }
        }
      `,
      errors: [{ messageId: 'silentFallthrough' }],
    },
    // Same shape in a while loop.
    {
      code: `
        while (queue.length) {
          const job = queue.shift();
          if (job.kind === 'a') { runA(job); continue; }
          if (job.kind === 'b') { runB(job); continue; }
        }
      `,
      errors: [{ messageId: 'silentFallthrough' }],
    },
    // Same shape in an indexed for loop, with three branches.
    {
      code: `
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'a') { runA(items[i]); continue; }
          if (items[i].kind === 'b') { runB(items[i]); continue; }
          if (items[i].kind === 'c') { runC(items[i]); continue; }
        }
      `,
      errors: [{ messageId: 'silentFallthrough' }],
    },
    // A bare `continue` as the consequent (no block) is the same shape.
    {
      code: `
        for (const card of cards) {
          if (card.type === 'draw') continue;
          if (card.type === 'play') continue;
        }
      `,
      errors: [{ messageId: 'silentFallthrough' }],
    },
  ],
});
