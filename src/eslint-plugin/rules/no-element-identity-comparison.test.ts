import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-element-identity-comparison.js';

// First RuleTester harness in the repo. Uses the plain `eslint` package's
// RuleTester (already a dependency) with the already-present
// `@typescript-eslint/parser` so TS syntax (type annotations) parses.
// Deliberately does NOT add `@typescript-eslint/rule-tester` as a new
// dependency (CLAUDE.md: "Don't add dependencies without discussing").
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-element-identity-comparison', rule, {
  valid: [
    // Already comparing by .id -- the correct pattern.
    {
      code: `
        class Card extends GameElement {}
        function f(card1: Card, card2: Card) {
          return card1.id === card2.id;
        }
      `,
    },
    // Plainly non-element operands.
    {
      code: `function f(count: number) { return count === 3; }`,
    },
    {
      code: `function f(name: string) { return name === 'x'; }`,
    },
    // Documented false-negative: the heuristic is same-file-only. When a
    // comparison involves untyped operands with no same-file evidence
    // (no type annotation, no class declaration, no collection-call
    // initializer) that they are GameElements, the rule cannot tell and
    // does not flag it. This is an accepted bound of the syntactic
    // heuristic (see RESEARCH Pitfall #3) -- true cross-file element
    // identity comparisons of this shape are NOT caught by this rule.
    {
      code: `function f(a, b) { return a === b; }`,
    },
    // Scope-hygiene regression (WR-03): the same identifier name (`card`)
    // is a GameElement-typed variable in one function and a plain string
    // in a different, unrelated function. Before the scope-resolution fix,
    // the rule matched by bare name across the whole file, so the `string`
    // comparison in the second function would have been falsely flagged
    // because `card` was seen with a `Card` type annotation elsewhere.
    {
      code: `
        class Card extends GameElement {}
        function usesElementCard(card: Card, other: Card) {
          return card.id === other.id;
        }
        function usesStringCard(card: string, other: string) {
          return card === other;
        }
      `,
    },
  ],
  invalid: [
    // Simple binary identity comparison between same-file-typed GameElement
    // subclass operands -- auto-fixable to `.id` comparison.
    {
      code: `
        class Card extends GameElement {}
        function f(card1: Card, card2: Card) {
          return card1 === card2;
        }
      `,
      output: `
        class Card extends GameElement {}
        function f(card1: Card, card2: Card) {
          return card1.id === card2.id;
        }
      `,
      errors: [{ messageId: 'identityComparison' }],
    },
    // !== variant, directly typed as GameElement (no subclass needed).
    {
      code: `function f(a: GameElement, b: GameElement) { return a !== b; }`,
      output: `function f(a: GameElement, b: GameElement) { return a.id !== b.id; }`,
      errors: [{ messageId: 'identityComparison' }],
    },
    // GameElement[]-typed array, `.includes(element)` -- no auto-fix.
    {
      code: `
        class Card extends GameElement {}
        function f(hand: Card[], card: Card) {
          return hand.includes(card);
        }
      `,
      errors: [{ messageId: 'identityIncludes' }],
    },
    // Collection built from a known collection-returning call (`.all(...)`)
    // is also GameElement[]-looking, even without a type annotation.
    {
      code: `
        function f(board, card) {
          const hand = board.all(Card);
          return hand.includes(card);
        }
      `,
      errors: [{ messageId: 'identityIncludes' }],
    },
  ],
});
