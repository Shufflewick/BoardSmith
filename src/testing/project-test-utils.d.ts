/**
 * WHAT A GAME'S COMPILER SEES OF `project-test-utils.node.ts` (#411).
 *
 * The loader resolves `@vue/test-utils` from the project the tests run in, and
 * doing that takes Node: `node:module`, `node:url`, `node:path` and
 * `process.cwd()`. A game compiles `boardsmith/testing` from source under its
 * own tsconfig, which has no Node types, so the loader's source cannot be on
 * the path its compiler follows.
 *
 * `dom-leak.ts` imports it as `#testing/project-test-utils`. package.json
 * `imports` answers that specifier with this declaration under the `types`
 * condition every TypeScript compiler matches, and with the `.node.ts` source
 * under `default`, which is what Vite and vitest load. The source declares its
 * export as this one's type, so the two cannot drift apart.
 *
 * `src/contract/testing-typecheck.test.ts` compiles a game test importing
 * `boardsmith/testing` under the tsconfig `boardsmith init` writes and fails if
 * any Node-only code is reachable from it.
 */

/**
 * The `@vue/test-utils` module the project running the tests has installed,
 * resolved from vitest's working directory as the project's own test files
 * resolve it.
 *
 * @throws When the project has no `@vue/test-utils`, saying how to install it.
 */
export function importProjectTestUtils(): Promise<typeof import('@vue/test-utils')>;
