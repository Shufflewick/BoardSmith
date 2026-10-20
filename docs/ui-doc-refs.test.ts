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

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** Every shipped page that teaches UI code: the docs, the API reference and the skill templates. */
const PAGES = ['docs', 'docs/api', 'src/cli/slash-command']
  .flatMap((dir) =>
    readdirSync(join(REPO, dir), { recursive: dir === 'src/cli/slash-command', encoding: 'utf8' })
      .filter((file) => file.endsWith('.md'))
      .map((file) => `${dir}/${file}`),
  )
  .map((file) => ({ file, text: readFileSync(join(REPO, file), 'utf8') }));

const BLOCKS = PAGES.flatMap(({ file, text }) => [...text.matchAll(/^\s*```[\s\S]*?^\s*```/gm)].map(([code]) => ({ file, code })));

const offending = (pattern: RegExp, blocks = BLOCKS) =>
  blocks.flatMap(({ file, code }) => code.split('\n').filter((line) => pattern.test(line)).map((line) => `${file}: ${line.trim()}`));

describe('UI docs read refs and composables correctly (#1306)', () => {
  it('reads actionController.isExecuting through .value', () => {
    expect(offending(/actionController\.isExecuting(?!\.value)/)).toEqual([]);
  });

  it('calls a useBoardInteraction() result without ?., since it never returns nothing', () => {
    // tryUseBoardInteraction() can return undefined, so a block that uses it may guard.
    const required = BLOCKS.filter(({ code }) => code.includes('useBoardInteraction()') && !code.includes('tryUseBoardInteraction()'));
    expect(offending(/boardInteraction\?\./, required)).toEqual([]);
  });
});
