/**
 * The `boardsmith/eslint-plugin` barrel — what a game's eslint.config.js
 * actually imports. The individual rules are tested in ./rules/*.test.ts; what
 * is tested here is the wiring, because a rule that exists but is not exported
 * or not enabled by the recommended config protects nobody.
 */
import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import plugin, { rules, configs } from './index.js';

/** Every rule the plugin ships, by its public name. */
const RULE_NAMES = [
  'no-network',
  'no-filesystem',
  'no-timers',
  'no-nondeterministic',
  'no-eval',
  'no-element-identity-comparison',
  'no-element-array-state',
];

const recommended = () => configs.recommended as {
  name: string;
  plugins: Record<string, unknown>;
  rules: Record<string, string>;
};

describe('plugin metadata', () => {
  it('identifies itself so ESLint can report which plugin flagged a problem', () => {
    expect(plugin.meta.name).toBe('eslint-plugin-boardsmith');
    expect(plugin.meta.version).toBeTruthy();
  });
});

describe('rules export', () => {
  it('ships exactly the documented rule set', () => {
    expect(Object.keys(rules).sort()).toEqual([...RULE_NAMES].sort());
  });

  it('is the same object the default export carries', () => {
    expect(rules).toBe(plugin.rules);
  });

  it('gives every rule a create function and message catalogue', () => {
    for (const [name, rule] of Object.entries(rules)) {
      expect(rule.create, `${name} has no create()`).toBeTypeOf('function');
      expect(Object.keys(rule.meta!.messages!).length, `${name} has no messages`)
        .toBeGreaterThan(0);
    }
  });

  it('declares every rule a problem, not a stylistic suggestion', () => {
    // These encode hard engine constraints (determinism, sandboxing), so a
    // violation is a defect rather than a preference.
    for (const [name, rule] of Object.entries(rules)) {
      expect(rule.meta!.type, `${name} is not typed 'problem'`).toBe('problem');
    }
  });

  it('gives every rule an empty options schema, so none takes configuration', () => {
    for (const [name, rule] of Object.entries(rules)) {
      expect(rule.meta!.schema, `${name} declares options`).toEqual([]);
    }
  });
});

describe('recommended config', () => {
  it('is a flat config with a name ESLint can report', () => {
    expect(recommended().name).toBe('boardsmith/recommended');
  });

  it('registers the plugin under the boardsmith namespace', () => {
    // Flat config takes an OBJECT here, not the ESLint 8 string array; getting
    // this wrong makes every `boardsmith/*` rule reference unresolvable.
    expect(recommended().plugins.boardsmith).toBe(plugin);
  });

  it('turns on every rule the plugin ships', () => {
    // A rule that exists but is not in `recommended` silently protects nobody.
    expect(Object.keys(recommended().rules).sort())
      .toEqual(RULE_NAMES.map((name) => `boardsmith/${name}`).sort());
  });

  it('sets every rule to error, not warn', () => {
    for (const [name, level] of Object.entries(recommended().rules)) {
      expect(level, `${name} is not an error`).toBe('error');
    }
  });

  it('references only rules that actually exist', () => {
    for (const key of Object.keys(recommended().rules)) {
      expect(rules[key.replace('boardsmith/', '')], `${key} has no implementation`)
        .toBeDefined();
    }
  });
});

describe('end-to-end through ESLint', () => {
  /** Lints source with the recommended config, exactly as a game project would. */
  const lint = (code: string) =>
    new Linter().verify(code, [
      { languageOptions: { parser: tseslintParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } } },
      recommended(),
    ]);

  it('accepts a well-behaved game file with no complaints', () => {
    expect(lint(`
      export class MyGame extends Game {
        setup() {
          const roll = Math.floor(this.random() * 6) + 1;
          this.deck.shuffle();
        }
      }
    `)).toEqual([]);
  });

  it('catches each forbidden capability through the real linter', () => {
    const cases: Array<[string, string]> = [
      ['no-network', `const r = fetch('/api');`],
      ['no-filesystem', `import fs from 'node:fs';`],
      ['no-timers', `setTimeout(() => {}, 10);`],
      ['no-nondeterministic', `const r = Math.random();`],
      ['no-eval', `eval('1+1');`],
    ];
    for (const [ruleName, code] of cases) {
      const messages = lint(code);
      expect(messages.map((m) => m.ruleId), code).toContain(`boardsmith/${ruleName}`);
      expect(messages[0].severity, `${ruleName} did not error`).toBe(2);
    }
  });

  it('reports a real, non-empty message for a violation', () => {
    const [message] = lint(`const r = Math.random();`);
    expect(message.message).toContain('game.random');
  });

  it('reports every violation in a file, not just the first', () => {
    const messages = lint(`
      import fs from 'node:fs';
      const r = Math.random();
      setTimeout(() => {}, 1);
    `);
    expect(new Set(messages.map((m) => m.ruleId))).toEqual(new Set([
      'boardsmith/no-filesystem',
      'boardsmith/no-nondeterministic',
      'boardsmith/no-timers',
    ]));
  });

  it('points at the offending line', () => {
    const [message] = lint(`const a = 1;\nconst r = Math.random();`);
    expect(message.line).toBe(2);
  });
});
