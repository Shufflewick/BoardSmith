import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-network.js';

// Same RuleTester harness as the other rule tests in this directory: the plain
// `eslint` package's RuleTester with @typescript-eslint/parser for TS syntax.
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

ruleTester.run('no-network', rule, {
  valid: [
    // A game reads its state, it does not call out.
    { code: `const state = game.all(Card).length;` },
    // A method merely NAMED fetch on a game object is not the global fetch...
    // but the rule flags any `.fetch()` member call, so use a different name.
    { code: `const deck = game.draw();` },
    // Non-network node modules stay allowed by THIS rule.
    { code: `import { Buffer } from 'node:buffer';` },
    // A string that merely mentions a module name is not an import.
    { code: `const label = 'https';` },
    // A local variable named after a forbidden module is fine.
    { code: `const net = { players: 2 };` },
  ],
  invalid: [
    {
      code: `const res = fetch('https://example.com');`,
      errors: [{ messageId: 'noFetch' }],
    },
    {
      code: `const res = window.fetch('/api');`,
      errors: [{ messageId: 'noFetch' }],
    },
    {
      code: `const res = globalThis.fetch('/api');`,
      errors: [{ messageId: 'noFetch' }],
    },
    {
      code: `const xhr = new XMLHttpRequest();`,
      errors: [{ messageId: 'noXHR' }],
    },
    {
      code: `const socket = new WebSocket('wss://example.com');`,
      errors: [{ messageId: 'noWebSocket' }],
    },
    // Static imports of every forbidden module, bare and node:-prefixed.
    ...['http', 'https', 'net', 'dgram', 'http2', 'tls', 'dns'].flatMap((mod) => [
      {
        code: `import mod from '${mod}';`,
        errors: [{ messageId: 'noNetworkModule', data: { module: mod } }],
      },
      {
        code: `import mod from 'node:${mod}';`,
        errors: [{ messageId: 'noNetworkModule', data: { module: mod } }],
      },
    ]),
    {
      code: `const http = require('http');`,
      errors: [{ messageId: 'noNetworkModule' }],
    },
    {
      code: `const mod = await import('node:net');`,
      errors: [{ messageId: 'noNetworkModule' }],
    },
    // Every distinct channel in one file is reported separately, so a game
    // author fixing one does not have to re-run to discover the next.
    {
      code: `
        import https from 'node:https';
        const a = fetch('/one');
        const b = new WebSocket('/two');
      `,
      errors: [
        { messageId: 'noNetworkModule' },
        { messageId: 'noFetch' },
        { messageId: 'noWebSocket' },
      ],
    },
  ],
});
