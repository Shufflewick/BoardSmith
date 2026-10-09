import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-engine-field-shadow.js';
import { describeEngineFieldShadow } from '../../engine/element/engine-owned-fields.js';

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

const shadow = (owner: string, field: string) => ({
  message: describeEngineFieldShadow(owner, field),
});

ruleTester.run('no-engine-field-shadow', rule, {
  valid: [
    // A zone with a name of its own.
    {
      code: `
        class MyGame extends Game<MyGame, MyPlayer> {
          discardPile!: Pile;
          constructor(options) {
            super(options);
            this.discardPile = this.create(Pile, 'discardPile');
          }
        }
      `,
    },
    // Reading and mutating engine fields is the engine's API, not a shadow.
    {
      code: `
        class MyGame extends Game {
          setup() {
            this.settings.variant = 'short';
            this.messages.length;
            const roll = this.random();
            this.pile.all();
          }
        }
      `,
    },
    // A class that is not a Game may use any names it likes.
    {
      code: `
        class Tableau extends Space {
          pile!: Pile;
          phase = 'draw';
          constructor() { super(); this.random = 3; }
        }
      `,
    },
    // `this` inside a plain nested function is not the game.
    {
      code: `
        class MyGame extends Game {
          setup() {
            const helper = { run: function () { this.pile = 1; } };
          }
        }
      `,
    },
    // Layout fields the engine expects a game to set are not engine-owned.
    {
      code: `
        class MyGame extends Game {
          constructor(options) { super(options); this.$direction = 'row'; }
        }
      `,
    },
  ],

  invalid: [
    // The issue's exact shape: declaration and assignment are both reported.
    {
      code: `
        class MyGame extends Game<MyGame, MyPlayer> {
          pile!: Pile;
          constructor(options) {
            super(options);
            this.pile = this.create(Pile, 'pile');
          }
        }
      `,
      errors: [shadow('MyGame', 'pile'), shadow('MyGame', 'pile')],
    },
    // A field initializer.
    {
      code: `class MyGame extends Game { phase = 'draw'; }`,
      errors: [shadow('MyGame', 'phase')],
    },
    // A type-only redeclaration still claims the engine's name.
    {
      code: `class MyGame extends Game { declare settings: MySettings; }`,
      errors: [shadow('MyGame', 'settings')],
    },
    // Methods and accessors collide with the field just the same.
    {
      code: `class MyGame extends Game { get messages() { return []; } random() { return 4; } }`,
      errors: [shadow('MyGame', 'messages'), shadow('MyGame', 'random')],
    },
    // An assignment inside an arrow function still targets the game.
    {
      code: `
        class MyGame extends Game {
          setup() { this.registerActions(() => { this.messages = []; }); }
        }
      `,
      errors: [shadow('MyGame', 'messages')],
    },
    // A subclass of a same-file Game subclass is a Game too.
    {
      code: `
        class BaseGame extends Game {}
        class MyGame extends BaseGame { tutorialProgress = new Map(); }
      `,
      errors: [shadow('MyGame', 'tutorialProgress')],
    },
    // ...even when the subclass is written above its base.
    {
      code: `
        class MyGame extends BaseGame { random = () => 4; }
        class BaseGame extends Game {}
      `,
      errors: [shadow('MyGame', 'random')],
    },
    // A class expression, and a quoted key.
    {
      code: `const MyGame = class extends Game { 'pile' = null; };`,
      errors: [shadow('MyGame', 'pile')],
    },
  ],
});
