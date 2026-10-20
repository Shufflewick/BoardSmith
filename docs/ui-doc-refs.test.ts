/**
 * THE UI DOCS READ REFS AND COMPOSABLES THE WAY A COMPONENT HAS TO (#1306).
 *
 * `actionController` is a prop object, so a template does not unwrap the refs
 * inside it: `actionController.isExecuting` there is the ref itself, always
 * truthy. And `useBoardInteraction()` throws outside GameShell rather than
 * returning nothing, so `boardInteraction?.` guards a case that cannot happen
 * and tells the reader it can.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DOCS = dirname(fileURLToPath(import.meta.url));
const PAGES = readdirSync(DOCS)
  .filter((file) => file.endsWith('.md'))
  .map((file) => ({ file, lines: readFileSync(join(DOCS, file), 'utf8').split('\n') }));

const offending = (pattern: RegExp) =>
  PAGES.flatMap(({ file, lines }) => lines.flatMap((line, i) => (pattern.test(line) ? [`docs/${file}:${i + 1}: ${line.trim()}`] : [])));

describe('UI docs read refs and composables correctly (#1306)', () => {
  it('reads actionController.isExecuting through .value', () => {
    expect(offending(/actionController\.isExecuting(?!\.value)/)).toEqual([]);
  });

  it('calls boardInteraction without ?., since useBoardInteraction() never returns nothing', () => {
    expect(offending(/boardInteraction\?\./)).toEqual([]);
  });
});
