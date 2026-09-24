/**
 * The worked-example contracts and the commands their returns go to, held together (#319).
 *
 * `verify/extract-example.md` and `verify/translate-example.md` each document an example of
 * what their subagent returns. This suite takes those documented examples straight out of the
 * two markdown files and feeds them, unchanged, through the whole pipeline the build and verify
 * skills describe:
 *
 *   extractor return -> verify-example-translate -> translator returns (filed under the
 *   exampleId each was dispatched for) -> verify-example-record -> verify-example-emit ->
 *   verify-example-run
 *
 * Before #319 the extractor was told to return `{ "examples": [...] }` while both commands
 * demanded a bare array, and the translator was told to return `{ testCode, imports,
 * verdictHint }` while the record command demanded verdict records nobody produced. Each side
 * was tested against its own idea of the shape. A contract whose example stops matching what
 * the commands accept now fails here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_DIR } from '../lib/project-paths.js';
import { buildExampleExtractionPayload } from './example-derivation.js';
import {
  readExampleReplayVerdicts,
  verifyExampleRecordCommand,
  verifyExampleTranslateCommand,
} from './verify-example-replay.js';
import { verifyExampleEmitCommand } from './example-test-emit.js';
import { verifyExampleRunCommand } from './example-test-run.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

const CONTRACT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'slash-command',
  'bs',
  'verify',
);

/** The slice both contracts' examples are written against. */
const SLICE_PATH = 'rulebook/02-guards.md';
const SLICE_TEXT = [
  'p.2, Punch Examples:',
  '"Example: your Guards are READY, EXHAUSTED, EXHAUSTED and you are punched."',
  '"After the punch your Guards are EXHAUSTED, EXHAUSTED, EXHAUSTED."',
  '',
  'p.3, Sets and Runs:',
  '"Set: 3+ cards of the same number. example: 5, 5, 5"',
  '"Run: 3+ cards in numeric order. example: 5, 6, 7"',
  'Visual (p.3): The Run example is illustrated by three cards: a red 1, a blue 2, and a red 3.',
  '',
].join('\n');

/** The game code the translator's documented example imports and exercises. */
const GUARDS_SOURCE = [
  "export type GuardState = 'READY' | 'EXHAUSTED';",
  '',
  '/** Being punched exhausts your first READY Guard. */',
  'export function punch(guards: readonly GuardState[]): GuardState[] {',
  "  const first = guards.indexOf('READY');",
  "  return guards.map((g, i) => (i === first ? 'EXHAUSTED' : g));",
  '}',
  '',
].join('\n');

/**
 * Every fenced block of `language` inside the `## <heading>` section of a contract, in order.
 * Throws when the section or its blocks are missing, so deleting the documented example fails
 * this suite rather than quietly skipping it.
 */
function fencedBlocks(contract: string, heading: string, language: string): string[] {
  const text = readFileSync(join(CONTRACT_DIR, contract), 'utf-8');
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`${contract} has no "## ${heading}" section.`);
  const rest = text.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);
  const blocks = [...section.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```', 'g'))].map(
    (m) => m[1],
  );
  if (blocks.length === 0) {
    throw new Error(`${contract}'s "## ${heading}" section has no \`\`\`${language} block.`);
  }
  return blocks;
}

describe('the worked-example contracts feed the commands they go to (#319)', () => {
  let dir: string;
  let project: string;

  beforeEach(async () => {
    dir = tempTree('bs-example-contracts-');
    project = join(dir, 'project');
    await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, DESIGN_DIR, SLICE_PATH), SLICE_TEXT);
    await fs.mkdir(join(project, DESIGN_DIR, 'chunks', 'guards'), { recursive: true });
    await fs.writeFile(
      join(project, DESIGN_DIR, 'chunks', 'guards', 'CHUNK.md'),
      `# guards\n\n## Verified Against\n\nCites ${SLICE_PATH}.\n`,
    );
    await fs.mkdir(join(project, 'src', 'rules'), { recursive: true });
    await fs.writeFile(join(project, 'src', 'rules', 'guards.ts'), GUARDS_SOURCE);
    await fs.writeFile(join(project, 'src', 'rules', 'index.ts'), "export * from './guards.js';\n");
    // The live-symlink layout every BoardSmithGames project uses, so the emitted test resolves
    // 'vitest' exactly as a generated game does.
    await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
  });

  it("extract-example.md's example payload is what verify-example-replay dispatches for the example slice", () => {
    const [documented] = fencedBlocks('extract-example.md', 'Example', 'text');
    expect(documented).toBe(buildExampleExtractionPayload({ path: SLICE_PATH, text: SLICE_TEXT }).payload);
  });

  it('carries both contracts\' documented returns through translate, record, emit and run', async () => {
    const [extractorReturn] = fencedBlocks('extract-example.md', 'Example', 'json');
    const extractionPath = join(dir, 'extraction.json');
    await fs.writeFile(extractionPath, extractorReturn);

    const translate = await verifyExampleTranslateCommand({
      project,
      slicePath: SLICE_PATH,
      extraction: extractionPath,
    });
    expect(translate.payloads.map((p) => [p.lineNumber, p.kind])).toEqual([
      [2, 'transition'],
      [6, 'predicate'],
    ]);
    expect(translate.notTranslated.map((n) => n.lineNumber)).toEqual([7]);

    // The skills file each translator return, unchanged, under the exampleId its payload
    // was dispatched with. The contract's returns are documented in payload order.
    const translatorReturns = fencedBlocks('translate-example.md', 'Example', 'json');
    expect(translatorReturns).toHaveLength(translate.payloads.length);
    const translations: Record<string, unknown> = {};
    translate.payloads.forEach((p, i) => {
      translations[p.exampleId] = JSON.parse(translatorReturns[i]);
    });
    const translationsPath = join(dir, 'translations.json');
    await fs.writeFile(translationsPath, JSON.stringify(translations, null, 2));

    const recorded = await verifyExampleRecordCommand({
      project,
      slicePath: SLICE_PATH,
      extraction: extractionPath,
      translations: translationsPath,
    });
    expect(recorded.records.map((r) => [r.lineNumber, r.verdict])).toEqual([
      [2, 'not-run'],
      [6, 'unexecutable'],
      [7, 'example-inconsistent'],
    ]);

    const emitted = await verifyExampleEmitCommand({ project, chunk: 'guards' });
    expect(emitted.testBlockCount).toBe(1);

    const run = await verifyExampleRunCommand({ project, chunk: 'guards' });
    expect(run.records.map((r) => [r.lineNumber, r.verdict])).toEqual([[2, 'agrees']]);

    const ledger = await readExampleReplayVerdicts(project);
    const byLine = [...ledger].sort((a, b) => a.lineNumber - b.lineNumber);
    expect(byLine.map((r) => [r.lineNumber, r.verdict])).toEqual([
      [2, 'agrees'],
      [6, 'unexecutable'],
      [7, 'example-inconsistent'],
    ]);
  }, 60_000);
});
