/**
 * Structural drift-protection test for the `/bs-verify-game` skill (VERIFY-01/02/07/08).
 *
 * `bs/verify-game.md` (the lean orchestrator) and its two `bs/verify/*.md` reference files are
 * plain markdown consumed by an agent session, NOT parsed by any runtime code in this repo. This
 * test pins the exact strings, citations, and cross-file pointers those files depend on so a
 * future reword/reorg fails loudly here instead of being discovered only when a downstream verify
 * session misbehaves.
 *
 * NOTE (honesty about what this file proves): these assertions prove the instruction EXISTS in
 * skill text; they do NOT prove a live session receives or follows it. Phase 170 found twelve
 * instruction-shaped mechanisms that were skipped on live runs while every automated check
 * (including tests exactly like this one) stayed green. The acceptance bar for VERIFY-01,
 * VERIFY-07, and VERIFY-08 is the live-session proof owed by plans 173-06 and 173-07, recorded in
 * `173-PROOF.md` — not this file. See `ingest.test.ts:352-356` for the identical caveat on the
 * sibling ingest contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

/** Collapse all runs of whitespace to a single space, so a pinned phrase survives hand-wrapping. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Strip HTML/Markdown comment lines before scanning for forbidden vocabulary, so a comment
 * mentioning a forbidden word in passing cannot self-invalidate the absence gate. */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

const ALL_VERIFY_FILES = [
  'verify-game.md',
  'verify/source-resolution.md',
  'verify/staging-dispatch.md',
  'verify/classification-dispatch.md',
  'verify/classification-subagent.md',
];

describe('verify-game.md — entry point shape (VERIFY-01)', () => {
  it('frontmatter names bs-verify-game', () => {
    const skill = read('verify-game.md');
    expect(skill.slice(0, 200)).toContain('name: bs-verify-game');
  });

  it('cites the shared state-machine.md rather than restating it', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md');
  });

  it('cites the Consistency Check by name', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('Consistency Check');
  });

  it('has an Invocation block naming /bs-verify-game with no required arguments', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('## Invocation');
    expect(skill).toContain('/bs-verify-game');
  });

  it('states plainly that it does not rebuild the project', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/does NOT rebuild the project/);
  });

  it('has exactly five numbered steps, each tagged with a VERIFY requirement ID', () => {
    const skill = read('verify-game.md');
    const stepHeadings = skill.match(/^## Step \d+:.*$/gm) ?? [];
    expect(stepHeadings.length).toBe(5);
    for (const heading of stepHeadings) {
      expect(heading).toMatch(/VERIFY-0[12378]/);
    }
  });

  it('has a Reference Files footer', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('## Reference Files');
  });
});

describe('verify-game.md — session lock reuse (decision 12)', () => {
  it('names a verify-shaped lock identity distinct from a chunk slug', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/verify:<run-id>|verify:\d{4}-\d{2}-\d{2}/);
  });

  it('states the timestamp comes from date -u, never fabricated', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
  });

  it('states the 24-hour staleness rule and the resume-refresh path', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/24.hour/);
    expect(skill).toMatch(/refresh/i);
  });

  it('states a clean close releases the lock line to exactly none', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/Session Lock:.*none|to exactly `none`/);
  });

  it('cites the shared Session Lock section rather than restating its full grammar', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/\("Session\s*Lock"\)/);
    // The lock section is cited by name, not reproduced from templates/SKETCH.template.md.
    expect(skill).not.toContain('PARSE CONTRACT (TMPL-02)');
  });
});

describe('verify-game.md — negative case: not a bs-built project', () => {
  it('states it stops and names what was missing, rather than offering to build one', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/STOP and say so, naming what was missing/);
    expect(skill).toMatch(/Do not offer to build one/);
  });
});

describe('verify/source-resolution.md — gated adoption flow (decision 1)', () => {
  it('exists and covers all four resolution cases plus the negative case', () => {
    const doc = read('verify/source-resolution.md');
    expect(doc).toContain('Case 1');
    expect(doc).toContain('Case 2');
    expect(doc).toContain('Case 3');
    expect(doc).toContain('Case 4');
    expect(flat(doc)).toMatch(/no candidate|Negative case/i);
  });

  it('requires designer confirmation before ingest-archive runs', () => {
    const doc = flat(read('verify/source-resolution.md'));
    const stopIdx = doc.indexOf('STOP AND ASK the designer once');
    const archiveIdx = doc.indexOf('boardsmith ingest-archive');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(archiveIdx).toBeGreaterThan(stopIdx);
  });

  it('runs ingest-archive with no --edition flag', () => {
    const doc = read('verify/source-resolution.md');
    expect(doc).toMatch(/no `--edition` flag/);
  });

  it('requires an independent Source hash: re-check after adoption, not trusting exit code', () => {
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/independently re-check `rulebook\/INDEX\.md`/);
    expect(doc).toMatch(/Do not infer that\s*adoption succeeded from `ingest-archive`'s exit code alone|Do not infer/);
  });

  it('forbids using chunk-provenance-status projectProvenanceState for the post-adoption re-check (173-06 live finding)', () => {
    // Live proof 173-06 found `projectProvenanceState` never flips away from "pre-provenance" from
    // ingest-archive alone (only a later chunk-check does) — using it here produces a false STOP
    // on every successful Case-2 adoption. See 173-PROOF.md section 3.
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/Do NOT use `chunk-provenance-status --json`'s `projectProvenanceState` field/);
  });

  it('treats a hash mismatch as a signal to record and proceed, never to overwrite the archive', () => {
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/source-changed/);
    expect(doc).toMatch(/Never overwrite the archived file/);
  });

  it('forbids mtime/size heuristics for multiple candidates', () => {
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/Newest-mtime and largest-file are\s*guesses wearing results' clothing/);
  });

  it('cites the Cold-Resume Parse Contract rather than restating it', () => {
    const doc = read('verify/source-resolution.md');
    expect(doc).toContain('Cold-Resume Parse Contract');
  });
});

describe('verify/staging-dispatch.md — run allocation, resume, dispatch, recording (decisions 9-11)', () => {
  it('invokes all three verify-run-* commands', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('verify-run-init');
    expect(doc).toContain('verify-run-status');
    expect(doc).toContain('verify-run-record');
  });

  it('carries the BS-DISPATCH-V2 token', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('BS-DISPATCH-V2');
  });

  it('fills Write slices to: with the staging directory, not a hardcoded rulebook/', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('Write slices to: {stagingDir}');
    expect(doc).not.toMatch(/Write slices to: rulebook\//);
  });

  it('states the run-id is minted by the command, never composed by the session', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/run-id is minted BY THE COMMAND/);
  });

  it('forbids inferring resume state from which files exist on disk', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/Do not decide what is done by looking at which files exist/);
  });

  it('cites the same slice-unit granularity ingest/transcription.md dispatches, without redefining it', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('Unit Granularity');
    expect(doc).toMatch(/ingest\/[\s\S]{0,20}transcription\.md/);
  });

  it('does not compose, restate, or summarize the transcription contract in the dispatch prompt', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain(
      'Do not compose, restate, or\nsummarize the transcription contract in the dispatch prompt.',
    );
  });

  it('records from the subagent-returned slicePath, never by opening the file', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/it does not open the file to check/);
  });

  it('an Orchestrator Records section states slices are never written or re-read by the orchestrator', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('Orchestrator Records (never writes slices, never re-reads them)');
  });

  it('states staging is kept and nothing is compared, classified, or promoted at close', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/Staging is KEPT/);
    expect(doc).toMatch(/no comparison, no\s*classification, and no promotion/);
  });
});

describe('VERIFY-07 structural enforcement — the dispatch is a pointer, not a restatement', () => {
  it('reuses ingest/transcription-subagent.md unchanged, parameterized by output directory', () => {
    const dispatch = read('verify/staging-dispatch.md');
    expect(dispatch).toContain(
      '${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md',
    );
  });

  it('no file under bs/verify/ restates the transcription contract body verbatim', () => {
    // Structural guard mirroring the no-fork check plan 173-03 added to ingest.test.ts. If this
    // file ever pastes in the contract body instead of pointing at
    // ingest/transcription-subagent.md, it must fail loudly — a fork here silently reintroduces
    // the copy-drift trap (f73153a3 and its Phase 172 recurrence) at exactly the point decision
    // 15 forbids it.
    const CONTRACT_BODY_MARKERS = [
      'legality, scoring, or sequencing',
      'Do not accept a paraphrase of this file in place of the file',
    ];
    const verifyDir = join(__dirname, 'verify');
    const files = readdirSync(verifyDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => join(verifyDir, e.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const marker of CONTRACT_BODY_MARKERS) {
        expect(text).not.toContain(marker);
      }
    }
  });

  it('verify-game.md names the transcript-absence observable a reviewer can check', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/quoted-rule line/);
    expect(skill).toMatch(/Derived \(p\./);
    expect(skill).toMatch(/Visual \(p\./);
  });
});

describe('Decision 16 — this phase never promotes a staged slice over a live one (structural absence)', () => {
  it('no verify file contains --apply, promote, or cutover (decision 8)', () => {
    const FORBIDDEN = ['--apply', 'promote', 'cutover'];
    for (const relPath of ALL_VERIFY_FILES) {
      const text = stripComments(read(relPath)).toLowerCase();
      for (const word of FORBIDDEN) {
        expect(text).not.toContain(word.toLowerCase());
      }
    }
  });
});

describe('verify-game.md — Step 3 classification routing (VERIFY-03)', () => {
  it('has a Step naming classification, pointing at classification-dispatch.md', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/^## Step \d+: Classification/m);
    expect(skill).toContain(
      '${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md',
    );
  });

  it('deletes the Phase 173 no-classification/no-comparison boundary statements', () => {
    const skill = read('verify-game.md');
    expect(skill).not.toContain('The pass ends here');
    expect(skill).not.toContain('never compares the staged output');
    expect(skill).not.toMatch(/no classification/);
  });

  it('states Close formats, never computes, the verdict report', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/formatting\s*`verify-classify-status --json`|formatted, never computed/);
  });
});

describe('classification-subagent.md — the one judgment contract', () => {
  it('carries the BS-CLASSIFY-V1 token and a DISPATCH REJECTED block', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toContain('BS-CLASSIFY-V1');
    expect(doc).toContain('DISPATCH REJECTED');
    expect(doc).toMatch(/Read no slice|Do not read either slice|read either slice/i);
  });

  it('contains all three labels', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toMatch(/\bcosmetic\b/);
    expect(doc).toMatch(/\bsharper\b/);
    expect(doc).toMatch(/\bcontradictory\b/);
  });

  it('states the consequence-vs-wording decision test', () => {
    const doc = flat(read('verify/classification-subagent.md'));
    expect(doc).toMatch(/equivalence of CONSEQUENCE, not similarity of\s*WORDING/);
  });

  it('carries the RETURN field names', () => {
    const doc = read('verify/classification-subagent.md');
    for (const field of ['pairId', 'label', 'evidence', 'quotedPass1', 'quotedPass2', 'lineFindings']) {
      expect(doc).toContain(field);
    }
  });

  it('carries the dual-schema exclusion worked example, quoted from the real fixture', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toContain('Visual (p.N):');
    expect(doc).toContain('Derived (p.N) — diagram description:');
    expect(doc).toContain('Derived (p.N) — art:');
    expect(doc).toContain(
      'Derived (p.1) — diagram description: A layout diagram of the ring showing three dashed-outline areas in a row',
    );
  });

  it('states the scope-limit sentence that it never computes staleness, with no other staleness vocabulary', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toContain('never computes staleness');
    const staleOccurrences = (doc.match(/stale/gi) ?? []).length;
    expect(staleOccurrences).toBe(1);
  });
});

describe('classification-dispatch.md — pointer, not restatement (VERIFY-07)', () => {
  it('points at classification-subagent.md rather than restating its contract', () => {
    const doc = read('verify/classification-dispatch.md');
    expect(doc).toContain(
      '${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md',
    );
  });

  it('carries the BS-CLASSIFY-V1 token in the dispatch block', () => {
    const doc = read('verify/classification-dispatch.md');
    expect(doc).toContain('BS-CLASSIFY-V1');
  });

  it('invokes all three verify-classify-* commands', () => {
    const doc = read('verify/classification-dispatch.md');
    expect(doc).toContain('verify-classify-pairs');
    expect(doc).toContain('verify-classify-status');
    expect(doc).toContain('verify-classify-record');
  });

  it('no file under bs/verify/ other than classification-subagent.md carries its decision-procedure marker', () => {
    // Mirrors the no-fork guard VERIFY-07's earlier test applies to the transcription contract —
    // a fork of the classification contract's own body is exactly the copy-drift trap decision 15
    // (of this phase) forbids.
    const CONTRACT_BODY_MARKER = 'equivalence of CONSEQUENCE, not similarity of';
    const verifyDir = join(__dirname, 'verify');
    const files = readdirSync(verifyDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => join(verifyDir, e.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file.endsWith('classification-subagent.md')) continue;
      const text = flat(readFileSync(file, 'utf-8'));
      expect(text).not.toContain(CONTRACT_BODY_MARKER);
    }
  });
});

describe('SC-4 — no skill file derives staleness in prose', () => {
  it('no verify file states a staleness derivation rule', () => {
    const FORBIDDEN = [/marks stale/i, /→\s*stale/i, /\bis stale\b/i, /\bnot stale\b/i];
    for (const relPath of ALL_VERIFY_FILES) {
      const text = stripComments(read(relPath));
      for (const pattern of FORBIDDEN) {
        expect(text).not.toMatch(pattern);
      }
    }
  });
});

describe('PRESENTATION_EXCLUSION_MARKERS — cross-file lexicon pin (decision 12b)', () => {
  it('every marker declared in verify-classify.ts appears verbatim in classification-subagent.md', () => {
    // Two representations exist for the same lexicon: a regex-source array in code, and its
    // literal prefix forms quoted in skill prose. A divergence here would mean the classifier's
    // code excludes a presentation form the prose never tells the subagent about, or vice versa.
    const src = readFileSync(
      join(__dirname, '../../commands/verify-classify.ts'),
      'utf-8',
    );
    const decl = /(?:export\s+)?const\s+PRESENTATION_EXCLUSION_MARKERS\s*=\s*(?:Object\.freeze\(\s*)?\[/.exec(
      src,
    );
    if (!decl) throw new Error('PRESENTATION_EXCLUSION_MARKERS declaration not found');
    const open = decl.index + decl[0].length - 1;
    const close = src.indexOf(']', open);
    const arrayBody = src.slice(open + 1, close);
    const markers = [...arrayBody.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(markers.length).toBeGreaterThan(0);

    // Each regex-source marker names a literal prefix once its regex escaping is undone — assert
    // that literal prefix appears verbatim in the contract's prose. The source string itself
    // carries doubled backslashes (a regex-source string embedded in a TS string literal), so
    // every backslash is stripped outright before re-inserting the one non-literal token (`\d+`,
    // which collapses to `N` after backslash-stripping becomes `d+`).
    const literalPrefixes = markers.map((source) =>
      source
        .replace(/\\/g, '')
        .replace(/^\^/, '')
        .replace(/d\+/g, 'N'),
    );
    const doc = read('verify/classification-subagent.md');
    for (const literal of literalPrefixes) {
      expect(doc).toContain(literal);
    }
  });
});
