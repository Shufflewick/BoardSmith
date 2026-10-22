/**
 * scripts/ingest-harness/conforming-fixture.test-helper.mjs
 *
 * The hand-built project tree that passes every produced-artifact check, shared by the checker and driver tests.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The checker reads the fixture from disk; importing it links the tests that use it to it (#1370).
import.meta.glob('./__fixtures__/conforming/**/*.md', { eager: true });

export const CONFORMING_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'conforming');
export const CONFORMING_SOURCE_HASH = '94b836814e8d4849fdff5f5e782a78a7c0a5b8f008808384096cb95359106a89';
