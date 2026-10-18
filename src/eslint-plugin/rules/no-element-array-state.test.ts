import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-element-array-state.js';

// Reuses the RuleTester harness convention established in plan 120-04
// (no-element-identity-comparison.test.ts): plain `eslint` package's
// RuleTester with `@typescript-eslint/parser` for TS syntax. Deliberately
// does NOT add `@typescript-eslint/rule-tester` as a new dependency
// (CLAUDE.md: "Don't add dependencies without discussing").
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-element-array-state', rule, {
  valid: [
    // Element-tree owner: a GameElement subclass storing a child array is
    // the correct, intended pattern -- not flagged.
    {
      code: `
        class Piece extends GameElement {}
        class Board extends GameElement {
          children: Piece[] = [];
        }
      `,
    },
    // Point-of-use local: a collection-returning call assigned to a local
    // variable and used/discarded within a method, never persisted onto a
    // class property, is the correct pattern -- not flagged.
    {
      code: `
        class Scorer {
          computeNearby(game) {
            const nearby = game.all(Tile);
            return nearby.filter((t) => t.active);
          }
        }
      `,
    },
    // Documented false-negative (heuristic bound, see RESEARCH Pitfall #3):
    // a persisted element array with no same-file type evidence (the field
    // has no type annotation and the assignment's receiver/argument are not
    // recognizable in this file) is not flagged. This is an accepted scope
    // limit of a syntactic-only rule.
    {
      code: `
        class GameState {
          hand;
          setup(source) {
            this.hand = source.getSomething();
          }
        }
      `,
    },
    // Scope-hygiene regression (WR-03): a same-named field (`items`)
    // appears in two different classes -- one an element-tree owner
    // (correctly storing a Piece[] child array), one a plain string field
    // in an unrelated class. Since this rule checks each PropertyDefinition
    // by its own type annotation (not a file-wide bare-name set), the
    // unrelated `items: string[]` field must not be flagged just because
    // another class in the file has a same-named GameElement[] field.
    {
      code: `
        class Piece extends GameElement {}
        class Board extends GameElement {
          items: Piece[] = [];
        }
        class Inventory {
          items: string[] = [];
        }
      `,
    },
    // A GameElement imported under another name still owns its children (#1036).
    {
      code: `
        import { GameElement as BaseElement } from 'boardsmith';
        class Board extends BaseElement { pieces: Piece[] = []; }
      `,
    },
    // A renamed import from anywhere but boardsmith is not an engine class (#1036).
    {
      code: `
        import { Card as BaseCard } from './cards';
        class Equipment extends BaseCard {}
        class Tracker { gear: Equipment[] = []; }
      `,
    },
  ],
  invalid: [
    // GameElement[]-typed class field in a non-GameElement class.
    {
      code: `
        class Card extends GameElement {}
        class GameState {
          hand: Card[] = [];
        }
      `,
      errors: [{ messageId: 'elementArrayField' }],
    },
    // Assignment of game.all() result to a persistent class property.
    {
      code: `
        class GameState {
          setup(game) {
            this.captured = game.all(Piece);
          }
        }
      `,
      errors: [{ messageId: 'elementArrayAssignment' }],
    },
    // Assignment of deck.first() result persisted to a property.
    {
      code: `
        class GameState {
          draw(deck) {
            this.top = deck.first(Card);
          }
        }
      `,
      errors: [{ messageId: 'elementArrayAssignment' }],
    },
    // Games extend the engine's element classes, not GameElement directly (#872).
    ...['Piece', 'Space', 'Card'].map((base) => ({
      code: `
        class Token extends ${base}<MyGame> {}
        class Tracker { discard: Token[] = []; }
      `,
      errors: [{ messageId: 'elementArrayField' as const }],
    })),
    // A two-level chain through an engine class (#872).
    {
      code: `
        class Pawn extends Card {}
        class Card extends Piece<MyGame> {}
        class Tracker { discard: Pawn[] = []; }
      `,
      errors: [{ messageId: 'elementArrayField' as const }],
    },
    // Game and Player are engine element classes (#872): an array of them on a plain class is
    // element state, and an element class still may not persist a collection query.
    ...['Game', 'Player'].flatMap((base) => [
      {
        code: `
          class Mine extends ${base} {}
          class Tracker { seen: Mine[] = []; }
        `,
        errors: [{ messageId: 'elementArrayField' as const }],
      },
      {
        code: `
          class Mine extends ${base} {
            captured = this.all(Card);
          }
        `,
        errors: [{ messageId: 'elementArrayAssignment' as const }],
      },
    ]),
    // Game and Player subclasses are where games keep state, so they get no child-array exemption.
    {
      code: `
        class Card extends Piece<MyGame> {}
        class MyGame extends Game { discard: Card[] = []; }
      `,
      errors: [{ messageId: 'elementArrayField' as const }],
    },
    {
      code: `class MyGame extends Game { pool: GameElement[] = []; }`,
      errors: [{ messageId: 'elementArrayField' as const }],
    },
    // The docs/common-pitfalls.md "Player Data Serialization" example.
    ...['GameElement', 'Piece'].map((base) => ({
      code: `
        class Squad extends ${base} {}
        class MyPlayer extends Player { squadRefs: Squad[] = []; }
      `,
      errors: [{ messageId: 'elementArrayField' as const }],
    })),
    {
      code: `
        class BaseGame extends Game {}
        class MyGame extends BaseGame { discard: Card[] = []; }
        class Card extends Piece {}
      `,
      errors: [{ messageId: 'elementArrayField' as const }],
    },
    // An engine class imported under another name is still an element class (#1036).
    ...['boardsmith', 'boardsmith/world'].map((source) => ({
      code: `
        import { Card as BaseCard } from '${source}';
        class Equipment extends BaseCard {}
        class Tracker { gear: Equipment[] = []; }
      `,
      errors: [{ messageId: 'elementArrayField' as const }],
    })),
    {
      code: `
        import { Piece as BasePiece } from 'boardsmith';
        class Tracker { militia: BasePiece[] = []; }
      `,
      errors: [{ messageId: 'elementArrayField' as const }],
    },
    // Check (c) applies in a direct GameElement subclass too (#1036).
    {
      code: `class Board extends GameElement { captured = this.all(Card); }`,
      errors: [{ messageId: 'elementArrayAssignment' as const }],
    },
  ],
});
