/**
 * THE ENGINE, COMPILED UNDER A WORKERS HOST'S GLOBALS (BoardSmith #488).
 *
 * ShufflewickPub runs the engine and session on Cloudflare Workers, and its
 * games worker type-checks our SOURCE (we ship `src/**`, not declarations)
 * against Cloudflare's generated types. Those declare the runtime's globals
 * differently from the DOM and Node libs this repo's own typecheck uses:
 * `crypto` and `console` are `declare const`, the timers are
 * `declare function`. A `const` or `function` global is NOT a property of
 * `typeof globalThis`, so `globalThis.crypto` compiles here and fails there.
 * That shipped in r118 and stopped the platform adopting it.
 *
 * So this gate compiles the platform-reachable entry points -- `boardsmith`,
 * `boardsmith/session`, `boardsmith/session-host`, `boardsmith/world`,
 * `boardsmith/persistence` and `boardsmith/runtime` -- from a consumer's
 * install with no DOM lib, no Node types, and only the Workers-shaped
 * declarations below. The declarations copy the SHAPE of Cloudflare's
 * (`declare const` where it says `const`), trimmed to the members the engine
 * uses; a new global the engine starts to use fails here until it is added,
 * which is the moment to check how Workers declares it.
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { consumerInstall } from './consumer-install.test-helper.js';
import { expectCleanCompile } from './vue-tsc-run.test-helper.js';

/**
 * The entry points the platform runs on Workers. The list comes from
 * ShufflewickPub's `boardsmith*` imports in `games/src` and `executor/src`:
 * when the platform starts importing another subpath, add it here.
 */
const PLATFORM_ENTRY_POINTS = [
  'src/engine/index.ts',
  'src/session/index.ts',
  'src/session/snapshot-session-host.ts',
  'src/world/index.ts',
  'src/persistence/index.ts',
  'src/runtime/index.ts',
] as const;

/** Cloudflare's declarations of the globals the engine reads, in their shape. */
const WORKERS_GLOBALS = `
interface Console {
  debug(...data: any[]): void;
  error(...data: any[]): void;
  info(...data: any[]): void;
  log(...data: any[]): void;
  warn(...data: any[]): void;
}
declare const console: Console;

interface Crypto {
  getRandomValues<T extends Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | BigInt64Array | BigUint64Array>(buffer: T): T;
}
declare const crypto: Crypto;

declare function setTimeout(callback: (...args: any[]) => void, msDelay?: number): number;
declare function setTimeout<Args extends any[]>(callback: (...args: Args) => void, msDelay?: number, ...args: Args): number;
declare function clearTimeout(timeoutId: number | null): void;
declare function queueMicrotask(task: Function): void;
declare function structuredClone<T>(value: T, options?: { transfer?: any[] }): T;

declare class TextEncoder {
  constructor();
  encode(input?: string): Uint8Array;
  get encoding(): string;
}
`;

describe('the platform-reachable engine type-checks under Workers globals (#488)', () => {
  it('reports zero errors with only ES2022 and Workers-shaped declarations', () => {
    const root = consumerInstall({ entryPoints: PLATFORM_ENTRY_POINTS });
    writeFileSync(join(root, 'workers-globals.d.ts'), WORKERS_GLOBALS);
    writeFileSync(
      join(root, 'tsconfig.workers.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            lib: ['ES2022'],
            types: [],
            strict: true,
            skipLibCheck: true,
            resolveJsonModule: true,
            noEmit: true,
            preserveSymlinks: true,
          },
          files: [
            'workers-globals.d.ts',
            ...PLATFORM_ENTRY_POINTS.map((entry) => `node_modules/boardsmith/${entry}`),
          ],
        },
        null,
        2,
      ),
    );

    expectCleanCompile(
      root,
      'tsconfig.workers.json',
      'the platform-reachable entry points against Workers-style globals',
      'Read a runtime global by its bare name (`typeof crypto === "undefined"`), not as a property of ' +
        'globalThis: Workers declares several as `const` or `function`, which globalThis does not ' +
        'carry. A "Cannot find name" means the engine uses a global this gate has not declared yet; ' +
        'add it to WORKERS_GLOBALS in the shape Cloudflare\'s types give it.',
    );
  }, 180_000);
});
