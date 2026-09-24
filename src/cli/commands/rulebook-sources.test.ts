import { DESIGN_DIR } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  ingestSliceSourceCommand,
  parseSliceSource,
  readSliceSources,
  recordedSourcePaths,
  sliceDocuments,
  withSliceSource,
} from './rulebook-sources.js';
import { renderIndex } from './ingest-archive.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { rejectionMessage } from '../../testing/rejection.test-helper.js';

const RULES = 'rulebook/source/rules.pdf';
const CARDS = 'rulebook/source/cards.pdf';
const HASH = 'a'.repeat(64);

/** An INDEX.md recording `rules.pdf` as primary and, when asked, `cards.pdf` as additional. */
function index(withCards: boolean): string {
  const base = renderIndex({
    gameName: 'game',
    edition: undefined,
    archivedPath: RULES,
    sourceHash: HASH,
    transcribed: '2026-09-24',
  });
  if (!withCards) return base;
  return base.replace(
    '## Open Rules Gaps',
    '## Additional Sources\n\n<!-- boardsmith:additional-sources:begin -->\n| file | sha256 |\n|------|--------|\n' +
      `| ${CARDS} | ${'b'.repeat(64)} |\n<!-- boardsmith:additional-sources:end -->\n\n## Open Rules Gaps`,
  );
}

describe('parseSliceSource — the per-slice document record (#311)', () => {
  it('reads the Source line directly under the title', () => {
    expect(parseSliceSource(`# Setup\n\nSource: ${CARDS}\n\np.1, Setup:\n"Deal six."\n`)).toBe(CARDS);
  });

  it('reads it as the first line of a slice with no title', () => {
    expect(parseSliceSource(`Source: ${RULES}\n\np.1, Setup:\n`)).toBe(RULES);
  });

  it('is undefined for a slice that records none', () => {
    expect(parseSliceSource('# Setup\n\np.1, Setup:\n"Deal six."\n')).toBeUndefined();
  });

  it('never reads a Source: line further down as the record — that is slice content', () => {
    expect(parseSliceSource(`# Setup\n\np.1, Setup:\nSource: ${CARDS}\n`)).toBeUndefined();
  });
});

describe('withSliceSource', () => {
  it('inserts the line under the title, leaving the body byte-identical', () => {
    const body = 'p.1, Setup:\n"Deal six."\n';
    const updated = withSliceSource(`# Setup\n\n${body}`, RULES);
    expect(updated).toBe(`# Setup\n\nSource: ${RULES}\n\n${body}`);
    expect(parseSliceSource(updated)).toBe(RULES);
  });

  it('replaces an existing line rather than adding a second', () => {
    const updated = withSliceSource(`# Setup\n\nSource: ${RULES}\n\np.1\n`, CARDS);
    expect(updated).toBe(`# Setup\n\nSource: ${CARDS}\n\np.1\n`);
  });

  it('puts the line first in a slice with no title', () => {
    expect(withSliceSource('p.1, Setup:\n', RULES)).toBe(`Source: ${RULES}\n\np.1, Setup:\n`);
  });
});

describe('recordedSourcePaths / sliceDocuments', () => {
  it('lists the primary first, then each additional document', () => {
    expect(recordedSourcePaths(index(true))).toEqual([RULES, CARDS]);
    expect(recordedSourcePaths(index(false))).toEqual([RULES]);
  });

  it('records nothing on the interview path', () => {
    const interview = renderIndex({
      gameName: 'g',
      edition: 'unpublished — designer statement',
      archivedPath: 'not applicable — no source rulebook (interview path)',
      sourceHash: 'not applicable — no source rulebook (interview path)',
      transcribed: '2026-09-24',
    });
    expect(recordedSourcePaths(interview)).toEqual([]);
  });

  it('a slice naming its document came from that one; a slice naming none may have come from any', () => {
    expect(sliceDocuments(CARDS, [RULES, CARDS])).toEqual([CARDS]);
    expect(sliceDocuments(undefined, [RULES, CARDS])).toEqual([RULES, CARDS]);
  });
});

describe('ingest-slice-source', () => {
  let dir: string;
  let project: string;
  const rulebook = () => join(project, DESIGN_DIR, 'rulebook');

  beforeEach(async () => {
    dir = tempTree('bs-rulebook-sources-');
    project = join(dir, 'game');
    await fs.mkdir(rulebook(), { recursive: true });
    await fs.writeFile(join(rulebook(), 'INDEX.md'), index(true));
    await fs.writeFile(join(rulebook(), '01-setup.md'), '# Setup\n\np.1, Setup:\n"Deal six."\n');
    await fs.writeFile(join(rulebook(), '01-cards-anatomy.md'), '# Anatomy\n\np.1, Anatomy:\n"A cost."\n');
    await fs.writeFile(join(rulebook(), '00-visual-survey.md'), '# Visual survey\n');
  });

  it('records the document in each named slice', async () => {
    const result = await ingestSliceSourceCommand(CARDS, ['01-cards-anatomy.md'], { project, json: true });
    expect(result.written).toEqual(['01-cards-anatomy.md']);

    const sources = await readSliceSources(project);
    expect(sources.get('01-cards-anatomy.md')).toBe(CARDS);
    expect(sources.get('01-setup.md')).toBeUndefined();
    // The visual survey covers the whole rulebook, so it is not a slice of one document.
    expect(sources.has('00-visual-survey.md')).toBe(false);
  });

  it('accepts the rulebook/ spelling a chunk citation uses, and is a no-op when already recorded', async () => {
    await ingestSliceSourceCommand(RULES, ['rulebook/01-setup.md'], { project, json: true });
    const again = await ingestSliceSourceCommand(RULES, ['01-setup.md'], { project, json: true });
    expect(again.written).toEqual([]);
    expect(again.unchanged).toEqual(['01-setup.md']);
  });

  it('refuses a document INDEX.md does not record, listing the ones it does', async () => {
    const message = await rejectionMessage(
      ingestSliceSourceCommand('rulebook/source/other.pdf', ['01-setup.md'], { project, json: true }),
    );
    expect(message).toContain('not a document rulebook/INDEX.md records');
    expect(message).toContain(`${RULES}, ${CARDS}`);
  });

  it('refuses a missing slice without writing any of the others', async () => {
    const message = await rejectionMessage(
      ingestSliceSourceCommand(RULES, ['01-setup.md', '09-nope.md'], { project, json: true }),
    );
    expect(message).toContain('rulebook/09-nope.md');
    expect(await fs.readFile(join(rulebook(), '01-setup.md'), 'utf-8')).not.toContain('Source:');
  });

  it('refuses the files that are not slices of one document', async () => {
    const message = await rejectionMessage(
      ingestSliceSourceCommand(RULES, ['00-visual-survey.md'], { project, json: true }),
    );
    expect(message).toContain('is not a slice');
  });
});
