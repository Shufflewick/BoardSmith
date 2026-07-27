/**
 * Structural drift-protection test for the `/bs-ingest-rules` skill (INGEST-01..07).
 *
 * `bs/ingest-rules.md` (the lean orchestrator) and its four `bs/ingest/*.md` reference
 * files are plain markdown consumed by an agent session, NOT parsed by any runtime code
 * in this repo. This test pins the exact strings, citations, and cross-file pointers those
 * files depend on so a future reword/reorg fails loudly here instead of being discovered
 * only when a downstream ingest session misbehaves.
 *
 * Authored FIRST (Wave 0 gap in 142-VALIDATION.md), before Plans 02/03 author the four
 * `bs/ingest/*.md` reference files. Most tests below are RED (or ERROR, since the files
 * don't exist yet) until those files land — this is the intended Wave-0-first state.
 * INGEST-02, INGEST-06, and INGEST-07 assert only against `ingest-rules.md` itself and
 * turn (or stay) GREEN once Task 2 of this plan authors that file.
 *
 * Every `read()` call is made INSIDE its `it()` body (never at describe-level) so a
 * missing file fails only that one assertion instead of aborting the whole suite's
 * collection phase — required because several referenced files genuinely don't exist
 * yet in this Wave-0-first state.
 *
 * Mirrors `src/cli/slash-command/bs/templates.test.ts` (Phase 141): same `__dirname`/
 * `read()` helper, same named byte-identical-marker-constant technique, one `describe`
 * per requirement ID.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

/**
 * Sketch-level tail-entry marker (em-dash, not hyphen). Byte-identical across
 * state-machine.md, SKETCH.template.md, and any ingest reference file that
 * quotes it (e.g. sketch-derivation.md's 2-3-chunk detail cap explanation).
 */
const SKETCH_LEVEL_MARKER = 'Status: proposed (sketch-level — no CHUNK.md yet)';

/** The `ui:` tag values, exactly as SKETCH.template.md and templates.test.ts pin them. */
const UI_TAG_REGEX = /none *\| *touches *\| *major/;

/** Every path `ingest-rules.md` must cite by exact path (cross-file consistency, INGEST-*). */
const REFERENCED_PATHS = [
  'ingest/transcription.md',
  'ingest/interview-fallback.md',
  'ingest/sketch-derivation.md',
  'ingest/scaffold.md',
  'state-machine.md',
  'templates/SKETCH.template.md',
  'templates/ASSETS.template.md',
] as const;

describe('INGEST-01 — transcription per-section confirmation', () => {
  it('ingest-rules.md references ingest/transcription.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/transcription.md');
  });

  it('transcription.md documents a per-section (not per-page, not bulk) confirmation protocol', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toMatch(/per[- ]section/i);
    expect(transcription).not.toMatch(/per[- ]page confirmation/i);
  });
});

describe('INGEST-02 — synthesis artifact list', () => {
  it('names INDEX.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('INDEX.md');
  });

  it('names variant/edition tagging', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/variant/i);
  });

  it('names component inventory + aspect ratio(s)', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/component inventory/i);
    expect(ingestRules).toMatch(/aspect ratio/i);
  });

  it('names ASSETS.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ASSETS.md');
  });

  it('names the visual identity survey', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/visual identity survey/i);
  });

  it('gives the survey a durable write target consumed by the first UI chunk ask (CR-01)', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('rulebook/00-visual-survey.md');
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('rulebook/00-visual-survey.md');
  });

  it('names player-count / min-max', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/min(?:imum)?\s*\/?\s*max(?:imum)?\s*player/i);
  });
});

describe('INGEST-03 — interview fallback', () => {
  it('ingest-rules.md references ingest/interview-fallback.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/interview-fallback.md');
  });

  it('interview-fallback.md outputs rulebook/ files, not PROJECT.md prose', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('rulebook/');
    expect(interviewFallback).not.toMatch(/Outputs?:?\s*PROJECT\.md/);
  });
});

describe('INGEST-04 — scaffold with compile+serve verification', () => {
  it('ingest-rules.md references ingest/scaffold.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/scaffold.md');
  });

  it('scaffold.md names boardsmith init, tsc --noEmit, and an explicit kill instruction', () => {
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain('boardsmith init');
    expect(scaffold).toContain('tsc --noEmit');
    expect(scaffold).toMatch(/kill/i);
  });
});

describe('INGEST-05 — sketch derivation heuristic', () => {
  it('ingest-rules.md references ingest/sketch-derivation.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/sketch-derivation.md');
  });

  it('sketch-derivation.md contains the byte-identical sketch-level marker', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain(SKETCH_LEVEL_MARKER);
  });

  it('sketch-derivation.md contains the ui: none|touches|major tag values', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(UI_TAG_REGEX);
  });

  it('sketch-derivation.md mandates core-event-loop-first, game-end, and final-acceptance chunks', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(/core event loop/i);
    expect(sketchDerivation).toMatch(/game-end/i);
    expect(sketchDerivation).toMatch(/final-acceptance/i);
  });
});

describe('INGEST-06 — UI strategy step', () => {
  it('references SKETCH.template.md\'s "## UI Strategy" section by name', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('## UI Strategy');
  });

  it('names both strategy values: custom-from-chunk-1 and autoui-with-cutover', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('custom-from-chunk-1');
    expect(ingestRules).toContain('autoui-with-cutover');
  });
});

describe('INGEST-07 — state detection', () => {
  it('names the re-run guard (existing SKETCH.md)', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('SKETCH.md');
    expect(ingestRules).toMatch(/re-run/i);
  });

  it('names the old-project migration trio: PROJECT.md, STATE.md, HISTORY.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('PROJECT.md');
    expect(ingestRules).toContain('STATE.md');
    expect(ingestRules).toContain('HISTORY.md');
  });
});

/**
 * The subagent structured-summary field names. ingest-rules.md and interview-fallback.md
 * depend on these by name; transcription.md defines them. Pinned here so a rename in one
 * file fails loudly instead of silently desynchronizing the three.
 */
const RETURN_SHAPE_FIELDS = [
  'slicePath',
  'sectionSummary',
  'citedTerms[]',
  'componentMentions[]',
  'visualEvidence[]',
  'variants[]',
  'openGaps[]',
] as const;

describe('SKILLAUTO-01 — milestone-chunk mandates', () => {
  it('sketch-derivation.md instructs setting the milestone flag on the core-loop chunk at sketch time', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(/milestone/i);
    expect(sketchDerivation).toMatch(/set the milestone flag/i);
  });

  it('sketch-derivation.md instructs setting the milestone flag on the scoring/endgame and final-acceptance anchor chunks', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain('Milestone: scoring');
    expect(sketchDerivation).toContain('Milestone: final-acceptance');
    expect(sketchDerivation).toContain('sketch-derivation time');
  });

  it('sketch-derivation.md cites SKETCH.template.md\'s Milestone field by name', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain('Milestone');
  });

  it('sketch-derivation.md assigns `none` as the milestone value for non-milestone chunks', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(/`none`/);
  });
});

describe('v4.9 INGEST-02 — Derived/Visual line-prefix split', () => {
  it('transcription.md defines the Visual (p. prefix', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('Visual (p.');
  });

  it('transcription.md defines the Derived (p. prefix', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('Derived (p.');
  });

  it('transcription.md states the rule-bearing decision test verbatim', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('legality, scoring, or sequencing');
  });

  it('transcription.md still cites rulebook/00-visual-survey.md (split does not retire the survey slice)', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('rulebook/00-visual-survey.md');
  });

  // Regression: the 170-03 proof run produced ZERO `Visual (p.` lines and misfiled 5 of 10
  // `Derived (p.` lines as pure layout/art/typography descriptions. Root cause was two
  // compounding defects in transcription.md, pinned by the two tests below. A green
  // "the prefix is defined" assertion did not catch either — the prefix WAS defined.

  it('the DERIVED bullet is self-limiting: its own definition carries the rule-bearing qualifier', () => {
    const transcription = read('ingest/transcription.md');
    // Defect 1: DERIVED was defined by provenance alone ("anything you condensed or
    // inferred"), so a layout inference matched it exactly and never reached the VISUAL
    // bullet's decision test. The qualifier must live AT the DERIVED site, not only below it.
    const derivedBullet = transcription.slice(
      transcription.indexOf('- DERIVED lines:'),
      transcription.indexOf('- VISUAL lines:'),
    );
    expect(derivedBullet).not.toBe('');
    expect(derivedBullet).toContain('rule-bearing');
    expect(derivedBullet).toContain('legality, scoring, or sequencing');
    // The exclusion must be explicit: inferred-ness alone does not earn the Derived prefix.
    expect(derivedBullet).toMatch(/NOT by itself|not by itself/);
  });

  it('the visualEvidence[] weave instruction names the Visual (p.N): prefix at its own site', () => {
    const transcription = read('ingest/transcription.md');
    // Defect 2: visualEvidence[] told the subagent to "weave those diagram/image
    // descriptions into the slice text" without naming a prefix, so it reached for the
    // prefix whose definition fit — Derived. The weave site must name Visual itself.
    const weaveIdx = transcription.indexOf('Weave those diagram/image descriptions');
    expect(weaveIdx).toBeGreaterThan(-1);
    const weaveInstruction = transcription.slice(weaveIdx, weaveIdx + 400);
    expect(weaveInstruction).toContain('Visual (p.N):');
    expect(weaveInstruction).toContain('never under `Derived (p.N):`');
  });
});

describe('v4.9 INGEST-03 — openGaps[] return-field transport', () => {
  it('transcription.md defines openGaps[]', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('openGaps[]');
  });

  it('transcription.md still contains the Named-but-undefined marker', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('Named-but-undefined');
  });

  it('the Return exactly: enumeration line names openGaps[] in the same statement', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toMatch(/Return exactly:[\s\S]*?openGaps\[\][\s\S]*?\}/);
  });

  it('does not instruct re-reading the slice to collect gaps', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).not.toMatch(/re-read(ing)? the slice[^.]*gap/i);
  });
});

describe('v4.9 INGEST-01 — source archive + SHA-256', () => {
  it('ingest-rules.md prescribes the rulebook/source/ archive path', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('rulebook/source/');
  });

  it('ingest-rules.md prescribes shasum -a 256 with a sha256sum fallback', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('shasum -a 256');
    expect(ingestRules).toContain('sha256sum');
  });

  it('ingest-rules.md states the non-destructive copy/never-move-or-delete invariant', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/copy[\s\S]{0,200}never[\s\S]{0,60}(move|delete|rename|overwrite)/i);
  });

  it('ingest/scaffold.md does NOT contain rulebook/source/ (Pitfall 1 guard — scaffold.md runs before {rulebookPath} is known)', () => {
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).not.toContain('rulebook/source/');
  });
});

describe('v4.9 INGEST-04 — INDEX.md header block', () => {
  it('ingest-rules.md contains all four header labels', () => {
    const ingestRules = read('ingest-rules.md');
    for (const label of ['Edition:', 'Source:', 'Source hash:', 'Transcribed:']) {
      expect(ingestRules, `ingest-rules.md must contain "${label}"`).toContain(label);
    }
  });

  it('ingest-rules.md states the never-omit fallback value', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('not stated in the rulebook');
  });

  it('interview-fallback.md contains the same four header labels plus the interview-path not-applicable value', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    for (const label of ['Edition:', 'Source:', 'Source hash:', 'Transcribed:']) {
      expect(interviewFallback, `interview-fallback.md must contain "${label}"`).toContain(label);
    }
    expect(interviewFallback).toContain('not applicable — no source rulebook (interview path)');
  });
});

describe('v4.9 INGEST-03 — ## Open Rules Gaps section', () => {
  it('ingest-rules.md contains the exact bare heading (no parenthetical suffix)', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('## Open Rules Gaps');
    expect(ingestRules).not.toContain('## Open Rules Gaps (');
  });

  it('ingest-rules.md contains the always-emitted _None._ empty-state token', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('_None._');
  });

  it('ingest-rules.md builds the section exclusively from openGaps[]', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('openGaps[]');
  });

  it('interview-fallback.md also emits ## Open Rules Gaps on the same always/_None._ terms', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('## Open Rules Gaps');
    expect(interviewFallback).toContain('_None._');
  });
});

describe('return-shape field names — pinned across the file set (WR-07)', () => {
  it('transcription.md defines every return-shape field', () => {
    const transcription = read('ingest/transcription.md');
    for (const field of RETURN_SHAPE_FIELDS) {
      expect(transcription, `transcription.md must define "${field}"`).toContain(field);
    }
  });

  it('ingest-rules.md consumes the synthesis-facing fields by the same names', () => {
    const ingestRules = read('ingest-rules.md');
    for (const field of ['citedTerms[]', 'componentMentions[]', 'visualEvidence[]', 'variants[]', 'openGaps[]']) {
      expect(ingestRules, `ingest-rules.md must reference "${field}"`).toContain(field);
    }
  });

  it('interview-fallback.md produces the same citedTerms[]/componentMentions[] shape by name', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('citedTerms[]');
    expect(interviewFallback).toContain('componentMentions[]');
  });
});

describe('CLI string claims in scaffold.md match the CLI source (WR-07)', () => {
  it('init.ts still emits the already-exists error scaffold.md quotes', () => {
    const initSrc = read('../../commands/init.ts');
    expect(initSrc).toContain('Error: Directory "${name}" already exists');
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain('already exists');
  });

  it('dev.ts still emits the --no-open skip message scaffold.md quotes', () => {
    const devSrc = read('../../commands/dev.ts');
    const skipMessage = 'Skipping auto-open (--no-open): connect a client to claim seat 1 yourself.';
    expect(devSrc).toContain(skipMessage);
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain(skipMessage);
  });

  it('dev.ts still emits the load-bearing ready line scaffold.md waits for verbatim', () => {
    const devSrc = read('../../commands/dev.ts');
    const readyLine = 'Ready! Press Ctrl+C to stop.';
    expect(devSrc).toContain(readyLine);
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain(readyLine);
  });
});

describe('reference-file cross-citations resolve (WR-07)', () => {
  it('transcription.md cites templates/ASSETS.template.md, which exists', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('templates/ASSETS.template.md');
    expect(existsSync(join(__dirname, 'templates/ASSETS.template.md'))).toBe(true);
  });

  it('sketch-derivation.md cites templates/SKETCH.template.md, which exists', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain('templates/SKETCH.template.md');
    expect(existsSync(join(__dirname, 'templates/SKETCH.template.md'))).toBe(true);
  });

  it('scaffold.md cites src/cli/lib/project-scaffold.ts, which exists', () => {
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain('src/cli/lib/project-scaffold.ts');
    expect(existsSync(join(__dirname, '../../lib/project-scaffold.ts'))).toBe(true);
  });
});

describe('cross-file consistency — aspects reference (WR-04)', () => {
  it('interview-fallback.md cites aspects/index.md by its resolvable relative path', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('../aspects/index.md');
  });

  it('../aspects/index.md exists on disk (relative to bs/)', () => {
    expect(existsSync(join(__dirname, '../aspects/index.md'))).toBe(true);
  });
});

describe('cross-file consistency — every referenced path resolves on disk', () => {
  it('ingest-rules.md cites every reference path (contains the pointer string)', () => {
    const ingestRules = read('ingest-rules.md');
    for (const path of REFERENCED_PATHS) {
      expect(ingestRules, `ingest-rules.md must cite "${path}"`).toContain(path);
    }
  });

  for (const path of REFERENCED_PATHS) {
    it(`${path} exists on disk`, () => {
      expect(existsSync(join(__dirname, path)), `${path} must exist`).toBe(true);
    });
  }
});
