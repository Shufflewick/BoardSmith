import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RULING_VERDICTS,
  createRulingVerdictRecord,
  enumerateRulingsForRecheck,
  resolveFreshTranscription,
  recordRulingVerdicts,
  verifyRulingRecheckCommand,
} from './verify-ruling-recheck.js';

/**
 * `verify-ruling-recheck.ts` is CHECK-01's mechanical half (176-CONTEXT.md decision 2). Every
 * fixture here is a real filesystem temp dir (no mocks), mirroring `verify-run.test.ts`.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-ruling-recheck-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// A live-shaped, no-dot path segment right after "rulebook/" — the exact convention
// `stagingSlicesDir`'s own doc comment names ("dot-prefixed so no walker mistakes a staged slice
// for a live one"). Any returned path matching this is a live rulebook/ slice reference, which
// decision 9/10 forbid resolveFreshTranscription from ever producing.
const LIVE_RULEBOOK_SLICE_PATTERN = /(^|\/)rulebook\/[^.]/;

describe('RULING_VERDICTS', () => {
  it('is the locked four-member enum, frozen, in order', () => {
    expect(RULING_VERDICTS).toEqual([
      'still-needed',
      'resolved-by-source',
      'contradicted',
      'undetermined',
    ]);
    expect(Object.isFrozen(RULING_VERDICTS)).toBe(true);
  });

  it('undetermined is producible via createRulingVerdictRecord and never rewritten', () => {
    const record = createRulingVerdictRecord({
      number: 1,
      verdict: 'undetermined',
      reasoning: 'The fresh transcription is scope-limited; no comparison is possible.',
    });
    expect(record.verdict).toBe('undetermined');
  });
});

describe('createRulingVerdictRecord', () => {
  it('throws for a verdict outside RULING_VERDICTS', () => {
    expect(() =>
      createRulingVerdictRecord({ number: 1, verdict: 'resolved', reasoning: 'x' }),
    ).toThrow(/Invalid verdict/);
  });

  it('throws for an empty reasoning string', () => {
    expect(() =>
      createRulingVerdictRecord({ number: 1, verdict: 'still-needed', reasoning: '   ' }),
    ).toThrow(/no recorded reasoning/);
  });

  it('constructs a valid record carrying supersededBy when supplied', () => {
    const record = createRulingVerdictRecord({
      number: 3,
      verdict: 'contradicted',
      reasoning: 'The fresh transcription now states the opposite of this ruling.',
      supersededBy: 9,
    });
    expect(record).toEqual({
      number: 3,
      verdict: 'contradicted',
      reasoning: 'The fresh transcription now states the opposite of this ruling.',
      supersededBy: 9,
    });
  });
});

describe('enumerateRulingsForRecheck', () => {
  // seven's Ruling 3, quoted verbatim from 176-PATTERNS.md — the direction-reversed marker.
  function sevenRuling3And9(): string {
    return [
      '### Ruling 3',
      '',
      '- Decision: Mess exhaustion is treated as unreachable — no reshuffle rule is implemented, ' +
        'and no code path may handle an empty mess by silently degrading.',
      '- Citation interpreted or overridden: n/a — the rulebook is entirely silent on the mess ' +
        'running out.',
      '- Rationale: Designer ruling at ingest, grounded in arithmetic.',
      '- **⚠ RATIONALE SUPERSEDED BY RULING 9 (the DECISION stands; the ARITHMETIC behind it was ' +
        'false).**',
      '',
      '### Ruling 9',
      '',
      '- Decision: the corrected arithmetic stands.',
      '',
    ].join('\n');
  }

  it('a ruling superseded (either direction) is excluded from enumerated and present in skipped', () => {
    const result = enumerateRulingsForRecheck(sevenRuling3And9());
    expect(result.enumerated.map((r) => r.number)).toEqual([9]);
    expect(result.skipped).toEqual([{ number: 3, supersededBy: 9 }]);
  });

  it('enumerated entries carry the ruling body text', () => {
    const result = enumerateRulingsForRecheck(sevenRuling3And9());
    const ruling9 = result.enumerated.find((r) => r.number === 9)!;
    expect(ruling9.body).toContain('the corrected arithmetic stands');
  });

  it('an unparseable supersede sentence is reported AND the ruling still enumerates', () => {
    const text = [
      '### Ruling 22',
      '',
      'Decision: Supersedes the RATIONALE of Ruling 3, not its outcome.',
      '',
    ].join('\n');
    const result = enumerateRulingsForRecheck(text);
    expect(result.enumerated.map((r) => r.number)).toEqual([22]);
    expect(result.skipped).toEqual([]);
    expect(result.unparsedSupersession).toEqual([
      {
        number: 22,
        sentences: ['Decision: Supersedes the RATIONALE of Ruling 3, not its outcome.'],
      },
    ]);
  });

  it('a ruling with no supersession language enumerates normally', () => {
    const text = ['### Ruling 1', '', 'Decision: the card is face down.', ''].join('\n');
    const result = enumerateRulingsForRecheck(text);
    expect(result.enumerated).toEqual([{ number: 1, body: expect.stringContaining('face down') }]);
    expect(result.skipped).toEqual([]);
    expect(result.unparsedSupersession).toEqual([]);
  });
});

describe('resolveFreshTranscription', () => {
  it('returns scopeLimited when no verify run has ever been staged, naming the missing path', async () => {
    const project = join(dir, 'game');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    const result = await resolveFreshTranscription(project);
    expect(result.scopeLimited).toBe(true);
    if (result.scopeLimited) {
      expect(result.missingPath).toBeTruthy();
      expect(result.missingPath).not.toMatch(LIVE_RULEBOOK_SLICE_PATTERN);
      expect(result.reason).toMatch(/never been produced|No verify run/);
    }
  });

  it('returns scopeLimited when the staged slices directory exists but is empty', async () => {
    const project = join(dir, 'game');
    const runId = '2026-07-30T10-00-00Z';
    await fs.mkdir(join(project, 'rulebook', '.verify', runId, 'slices'), { recursive: true });
    const result = await resolveFreshTranscription(project, runId);
    expect(result.scopeLimited).toBe(true);
    if (result.scopeLimited) {
      expect(result.missingPath).not.toMatch(LIVE_RULEBOOK_SLICE_PATTERN);
    }
  });

  it('returns scopeLimited for a malformed --run-id, never throwing', async () => {
    const project = join(dir, 'game');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    const result = await resolveFreshTranscription(project, 'not-a-real-run-id');
    expect(result.scopeLimited).toBe(true);
    if (result.scopeLimited) {
      expect(result.missingPath).not.toMatch(LIVE_RULEBOOK_SLICE_PATTERN);
    }
  });

  it('resolves the staged slice paths when a fresh transcription is present, never a live path', async () => {
    const project = join(dir, 'game');
    const runId = '2026-07-30T10-00-00Z';
    const stagingDir = join(project, 'rulebook', '.verify', runId, 'slices');
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(join(stagingDir, '01-setup.md'), '## Setup\n\nFresh transcription text.\n');
    const result = await resolveFreshTranscription(project, runId);
    expect(result.scopeLimited).toBe(false);
    if (!result.scopeLimited) {
      expect(result.runId).toBe(runId);
      expect(result.slicePaths).toEqual(['01-setup.md']);
      expect(result.stagingDir).not.toMatch(LIVE_RULEBOOK_SLICE_PATTERN);
      for (const p of result.slicePaths) expect(p).not.toMatch(LIVE_RULEBOOK_SLICE_PATTERN);
    }
  });

  it('with no --run-id, resolves the most recently minted run (lexicographic sort)', async () => {
    const project = join(dir, 'game');
    const older = '2026-07-29T10-00-00Z';
    const newer = '2026-07-30T10-00-00Z';
    for (const runId of [older, newer]) {
      const stagingDir = join(project, 'rulebook', '.verify', runId, 'slices');
      await fs.mkdir(stagingDir, { recursive: true });
      await fs.writeFile(join(stagingDir, '01-setup.md'), '## Setup\n\ntext\n');
    }
    const result = await resolveFreshTranscription(project);
    expect(result.scopeLimited).toBe(false);
    if (!result.scopeLimited) {
      expect(result.runId).toBe(newer);
    }
  });
});

describe('No absence-phrase list in this module (176-RESEARCH.md Pitfall 4)', () => {
  it('verify-ruling-recheck.ts contains no absence-detection keyword literal', () => {
    const src = readFileSync(join(__dirname, 'verify-ruling-recheck.ts'), 'utf-8');
    const ABSENCE_PHRASES = [
      'never reproduces',
      'entirely silent',
      'absent from',
      'not defined',
      'no mention of',
    ];
    for (const phrase of ABSENCE_PHRASES) {
      expect(src.toLowerCase()).not.toContain(phrase);
    }
  });
});

describe('recordRulingVerdicts — the one atomic write path (176-CONTEXT.md decision, CR-01)', () => {
  it('never calls a hand-rolled fs.writeFile/writeFileSync — routes through atomicWriteFile only', () => {
    const src = readFileSync(join(__dirname, 'verify-ruling-recheck.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfs\.writeFile\(/);
    expect(src).not.toMatch(/\bwriteFileSync\(/);
    expect(src).not.toMatch(/\bfsPromises\.writeFile\(/);
    expect(src).toMatch(/\batomicWriteFile\(/);
  });

  it('persists verdict records to the run-scoped ledger, never touching RULINGS.md', async () => {
    const project = join(dir, 'game');
    const runId = '2026-07-30T10-00-00Z';
    await fs.mkdir(join(project, 'rulebook', '.verify', runId, 'slices'), { recursive: true });
    await fs.writeFile(join(project, 'RULINGS.md'), '### Ruling 1\n\nDecision: x.\n');
    const before = await fs.readFile(join(project, 'RULINGS.md'), 'utf-8');

    const record = createRulingVerdictRecord({
      number: 1,
      verdict: 'still-needed',
      reasoning: 'The fresh transcription still does not contain this content.',
    });
    const { ledgerPath } = await recordRulingVerdicts(project, runId, [record]);

    const after = await fs.readFile(join(project, 'RULINGS.md'), 'utf-8');
    expect(after).toBe(before);

    const ledgerText = await fs.readFile(join(project, ledgerPath), 'utf-8');
    expect(ledgerText).toContain('"verdict":"still-needed"');
  });
});

describe('verifyRulingRecheckCommand', () => {
  /** A fixture RULINGS.md with `count` simple, non-superseded entries. */
  function manyRulingsText(count: number): string {
    const parts: string[] = [];
    for (let i = 1; i <= count; i++) {
      parts.push(`### Ruling ${i}`, '', `Decision: ruling number ${i} stands.`, '');
    }
    return parts.join('\n');
  }

  async function sha256OfDir(root: string): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    async function walk(d: string): Promise<void> {
      for (const entry of await fs.readdir(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const buf = await fs.readFile(full);
          map[full] = createHash('sha256').update(buf).digest('hex');
        }
      }
    }
    await walk(root);
    return map;
  }

  it('is read-only against RULINGS.md — whole-directory sha256 map is byte-identical before/after', async () => {
    const project = join(dir, 'game');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, 'RULINGS.md'), manyRulingsText(5));

    const before = await sha256OfDir(project);
    await verifyRulingRecheckCommand({ project, json: true });
    const after = await sha256OfDir(project);

    expect(after).toEqual(before);
  });

  it('--json output carries verdictCounts summing to the enumerated (non-skipped) ruling count', async () => {
    const project = join(dir, 'game');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, 'RULINGS.md'), manyRulingsText(4));

    const verdicts = new Map<number, { verdict: 'still-needed' | 'contradicted'; reasoning: string }>([
      [1, { verdict: 'still-needed', reasoning: 'still needed' }],
      [2, { verdict: 'still-needed', reasoning: 'still needed' }],
      [3, { verdict: 'contradicted', reasoning: 'contradicted' }],
      [4, { verdict: 'contradicted', reasoning: 'contradicted' }],
    ]);
    const result = await verifyRulingRecheckCommand({ project, verdicts, json: true });

    const total = Object.values(result.verdictCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
    expect(result.verdictCounts['still-needed']).toBe(2);
    expect(result.verdictCounts['contradicted']).toBe(2);
  });

  it('emits one row per ruling with no cap — 30+ rulings emits 30+ rows', async () => {
    const project = join(dir, 'game');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, 'RULINGS.md'), manyRulingsText(35));

    const result = await verifyRulingRecheckCommand({ project, json: true });
    expect(result.rows.length).toBe(35);
  });

  it('a non-bs-project (no RULINGS.md) throws an actionable message naming --project, no stack/path leak', async () => {
    const project = join(dir, 'not-a-project');
    await fs.mkdir(project, { recursive: true });

    await expect(verifyRulingRecheckCommand({ project })).rejects.toThrow(/--project/);
    try {
      await verifyRulingRecheckCommand({ project });
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toMatch(/\.ts:\d/);
      expect(message).not.toMatch(/\bsrc\//);
    }
  });
});
