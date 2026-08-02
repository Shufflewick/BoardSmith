/**
 * Drift-protection tests for the BS Skills shared reference files (TMPL-01/02/03).
 *
 * These files (state-machine.md, and later the six *.template.md skeletons) are
 * plain markdown read directly by future bs- skill instructions and by humans/
 * agents authoring game-project state files. They are NOT parsed by any runtime
 * code in this repo — the enum values, step-name lists, and rule phrases below
 * are the exact strings the skill instructions and downstream templates depend
 * on. This test exists to catch silent drift: if a future edit rewords the
 * status enum or reorders the step names, these assertions fail loudly instead
 * of the drift being discovered only when a downstream skill misbehaves.
 *
 * Extended by:
 * - Plan 02 (CHUNK.template.md / SKETCH.template.md assertions)
 * - Plan 03 (RULINGS.template.md / DECISIONS.template.md / DESIGN.template.md /
 *   ASSETS.template.md assertions)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  VERIFIED_AGAINST_HEADING,
  VERIFIED_AGAINST_BEGIN,
  VERIFIED_AGAINST_END,
} from '../../commands/chunk-provenance.js';
import {
  RULES_STALENESS_HEADING,
  RULES_STALENESS_BEGIN,
  RULES_STALENESS_END,
  RULES_STALENESS_EMPTY,
  RULES_STALE_MARKER,
  RULES_STALENESS_CLEAR,
  SKETCH_RULES_STALENESS_GRAMMAR,
} from '../../commands/verify-impact.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

/**
 * Collapse all runs of whitespace to a single space, so a pinned phrase stays pinned across a
 * hand-wrapped Markdown line break without also pinning where that break falls.
 */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * The status enum values, in order — single source of truth for this suite.
 * Both pinned lines below are derived from this array so the enum cannot
 * drift between state-machine.md and CHUNK.template.md without a test edit.
 */
const STATUS_ENUM_VALUES = [
  'proposed',
  'approved',
  'built',
  'verified',
  'verified (user-waived)',
] as const;

/** CHUNK-level stale marker (em-dash, not hyphen). */
const STALE_MARKER = 'stale — re-derive before build';

/**
 * Sketch-level tail-entry marker (em-dash, not hyphen). Appears in BOTH
 * state-machine.md (parse contract + consistency-check exemption) and
 * SKETCH.template.md (tail-entry Status line) and must stay byte-identical —
 * the consistency-check exemption matches this exact string.
 */
const SKETCH_LEVEL_MARKER = 'Status: proposed (sketch-level — no CHUNK.md yet)';

/**
 * Derived-pointer qualifier grammar. Appears in BOTH state-machine.md (parse
 * contract + consistency-check item 1) and SKETCH.template.md (detailed-entry
 * grammar) and must stay byte-identical — the `(derived from ...)` qualifier
 * is what distinguishes a derived pointer from CHUNK.md's authoritative line.
 */
const DERIVED_POINTER_GRAMMAR = 'Status (derived from chunks/<slug>/CHUNK.md):';

/** The exact enum line as it appears in state-machine.md ("Status Enum (exact)"). */
const STATE_MACHINE_ENUM_LINE = STATUS_ENUM_VALUES.map((v) => `\`${v}\``).join(' | ');

/** The exact enum value list as it appears in CHUNK.template.md and SKETCH.template.md. */
const TEMPLATE_ENUM_LINE = [...STATUS_ENUM_VALUES, STALE_MARKER].join(' | ');

/** The exact ASSETS.md ledger header row ("exactly these five columns, in this order"). */
const ASSETS_HEADER_ROW = '| needed-by-chunk | requested | received | placeholder-in-use | file path |';

/**
 * SKILLDEF-01: the exact clock-read command that is the ONLY sanctioned source for the session
 * lock's ISO timestamp — never fabricated. Byte-identical across SKETCH.template.md and
 * state-machine.md's "Session Lock" spec.
 */
const LOCK_CLOCK_READ = 'date -u +%Y-%m-%dT%H:%M:%SZ';

/** SKILLDEF-01: the session/chunk identity field the lock grammar carries. */
const LOCK_SESSION_ID_MARKER = '@ <session-id>';

/** SKILLDEF-01: the released/no-lock value a clean close writes as its terminal step. */
const LOCK_RELEASED_VALUE = 'Session Lock: none';

/** Extract a file's actual H2 headings, in document order. */
function actualHeadings(content: string): string[] {
  return content.split('\n').filter((line) => line.startsWith('## '));
}

/** Extract a file's PARSE CONTRACT (TMPL-02) comment block, or fail loudly. */
function parseContractBlock(content: string): string {
  const match = content.match(/<!-- PARSE CONTRACT \(TMPL-02\)[\s\S]*?-->/);
  expect(match, 'file must declare a PARSE CONTRACT (TMPL-02) comment').not.toBeNull();
  return match![0];
}

describe('TMPL-03 — authority & write order', () => {
  const stateMachine = read('state-machine.md');

  it('states CHUNK.md owns its status and wins on contradiction', () => {
    expect(stateMachine).toContain('CHUNK.md owns its chunk\'s status');
    expect(stateMachine).toContain('On contradiction, CHUNK.md wins');
  });

  it('states SKETCH.md holds only the ordered list and derived pointers', () => {
    expect(stateMachine).toContain('SKETCH.md holds only the ordered chunk list and derived pointers');
  });

  it('states write order is always CHUNK.md first, then SKETCH.md second', () => {
    expect(stateMachine).toContain('Write order is always CHUNK.md first, then SKETCH.md second');
  });
});

describe('TMPL-02 — parse contract', () => {
  const stateMachine = read('state-machine.md');

  it('states a parse failure means stop and ask, never guess', () => {
    expect(stateMachine).toContain(
      'the session STOPS and asks the user. It never guesses the intended state.'
    );
  });

  it('defines the status-line grammar as `Status: <enum-value>`', () => {
    expect(stateMachine).toContain('Status: <enum-value>');
  });
});

describe('TMPL-01/02/03 — shared enum & step-name invariants', () => {
  const stateMachine = read('state-machine.md');

  it('contains the exact full-ceremony step-name list', () => {
    expect(stateMachine).toContain(
      'investigate, redteam, ask, build, test, audit, repair, playtest, revise, close'
    );
  });

  it('contains the exact light-path step-name list', () => {
    expect(stateMachine).toContain('build, test, playtest');
  });

  it('contains the exact status-enum line, verbatim and in order', () => {
    // Pinned as one exact line — bare-word containment would pass even if the
    // enum line were reordered or partially deleted (the words appear in prose).
    expect(stateMachine).toContain(STATE_MACHINE_ENUM_LINE);
  });

  it('contains the exact CHUNK-level stale marker (em-dash, not hyphen)', () => {
    expect(stateMachine).toContain('stale — re-derive before build');
    // Guard against a hyphen regression slipping in unnoticed.
    expect(stateMachine).not.toContain('stale - re-derive before build');
  });
});

describe('TMPL-01 — exact step names & status enum', () => {
  const chunkTemplate = read('templates/CHUNK.template.md');
  const sketchTemplate = read('templates/SKETCH.template.md');

  it('CHUNK.template.md contains the exact status-enum value list, verbatim and in order', () => {
    expect(chunkTemplate).toContain(TEMPLATE_ENUM_LINE);
  });

  it('SKETCH.template.md derived-status pointer lists the same exact enum values', () => {
    expect(sketchTemplate).toContain(TEMPLATE_ENUM_LINE);
  });

  it('SKETCH.template.md carries the machine anchors and markers the skills depend on', () => {
    // /bs-insert-chunk bumps this stamp; the lock check reads this line.
    expect(sketchTemplate).toContain('Sketch Version:');
    expect(sketchTemplate).toContain('Session Lock:');
    // Stale marker must be present (em-dash, not hyphen) in the derived-status pointer.
    expect(sketchTemplate).toContain(STALE_MARKER);
    expect(sketchTemplate).not.toContain('stale - re-derive before build');
    // Tail entries use the exact sketch-level marker (exempt from consistency-check item 1).
    expect(sketchTemplate).toContain(SKETCH_LEVEL_MARKER);
  });

  it('CHUNK.template.md contains the exact full-ceremony step-name list', () => {
    expect(chunkTemplate).toContain(
      'investigate, redteam, ask, build, test, audit, repair, playtest, revise, close'
    );
  });

  it('CHUNK.template.md contains the exact light-path step-name list', () => {
    expect(chunkTemplate).toContain('build, test, playtest');
  });

  it('SKETCH.template.md contains the `ui:` tag values', () => {
    expect(sketchTemplate).toMatch(/none *\| *touches *\| *major/);
  });

  it('SKETCH.template.md contains the "Variants (deferred)" heading', () => {
    expect(sketchTemplate).toContain('Variants (deferred)');
  });
});

describe('SKILLDEF-01 — session lock: clock-read + session identity + release', () => {
  const sketchTemplate = read('templates/SKETCH.template.md');
  const stateMachine = read('state-machine.md');

  it('SKETCH.template.md names the exact clock-read command as the only sanctioned timestamp source', () => {
    expect(sketchTemplate).toContain(LOCK_CLOCK_READ);
  });

  it('state-machine.md Session Lock spec names the exact clock-read command', () => {
    expect(stateMachine).toContain(LOCK_CLOCK_READ);
  });

  it('SKETCH.template.md lock grammar carries a session/chunk identity field', () => {
    expect(sketchTemplate).toContain(LOCK_SESSION_ID_MARKER);
  });

  it('state-machine.md Session Lock section documents release-to-none on clean close', () => {
    expect(stateMachine).toContain(LOCK_RELEASED_VALUE);
    expect(stateMachine).toMatch(/same-day session that resumes a\s+DIFFERENT next chunk/i);
  });

  it('SKETCH.template.md keeps `none` as the released/no-lock alternative', () => {
    expect(sketchTemplate).toMatch(/none \| "<slug> @ <session-id>/);
  });
});

describe('TMPL-03 — CHUNK/SKETCH ↔ state-machine consistency', () => {
  const chunkTemplate = read('templates/CHUNK.template.md');
  const sketchTemplate = read('templates/SKETCH.template.md');
  const stateMachine = read('state-machine.md');

  it('CHUNK.template.md and state-machine.md list the identical exact step-name string', () => {
    const stepNames = 'investigate, redteam, ask, build, test, audit, repair, playtest, revise, close';
    expect(chunkTemplate).toContain(stepNames);
    expect(stateMachine).toContain(stepNames);
  });

  it('CHUNK.template.md and SKETCH.template.md both carry an authority pointer to state-machine.md', () => {
    expect(chunkTemplate).toContain('state-machine.md');
    expect(sketchTemplate).toContain('state-machine.md');
  });

  it('sketch-level marker is byte-identical in state-machine.md and SKETCH.template.md', () => {
    expect(stateMachine).toContain(SKETCH_LEVEL_MARKER);
    expect(sketchTemplate).toContain(SKETCH_LEVEL_MARKER);
    // Guard against a hyphen regression slipping into either copy.
    expect(stateMachine).not.toContain('(sketch-level - no CHUNK.md yet)');
    expect(sketchTemplate).not.toContain('(sketch-level - no CHUNK.md yet)');
  });

  it('derived-pointer grammar is byte-identical in state-machine.md and SKETCH.template.md', () => {
    expect(stateMachine).toContain(DERIVED_POINTER_GRAMMAR);
    expect(sketchTemplate).toContain(DERIVED_POINTER_GRAMMAR);
  });

  it('CHUNK.template.md pins the Ceremony valid values as exactly `full | light`', () => {
    expect(chunkTemplate).toContain('Valid values: full | light');
  });
});

describe('TMPL-02 — parse contract (CHUNK/SKETCH)', () => {
  const chunkTemplate = read('templates/CHUNK.template.md');
  const sketchTemplate = read('templates/SKETCH.template.md');

  it('CHUNK.template.md contains an authoritative `Status:` line', () => {
    expect(chunkTemplate).toContain('Status: proposed');
  });

  it('SKETCH.template.md documents its derived-status pointer', () => {
    expect(sketchTemplate).toContain('DERIVED');
    expect(sketchTemplate).toContain('CHUNK.md');
  });
});

describe('TMPL-01 — six templates ship with required content', () => {
  const rulingsTemplate = read('templates/RULINGS.template.md');
  const decisionsTemplate = read('templates/DECISIONS.template.md');
  const designTemplate = read('templates/DESIGN.template.md');
  const assetsTemplate = read('templates/ASSETS.template.md');

  const allTemplateFiles = [
    'templates/SKETCH.template.md',
    'templates/CHUNK.template.md',
    'templates/RULINGS.template.md',
    'templates/DECISIONS.template.md',
    'templates/DESIGN.template.md',
    'templates/ASSETS.template.md',
  ];

  it('all six template files exist and read non-empty', () => {
    for (const path of allTemplateFiles) {
      const content = read(path);
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('RULINGS.template.md mentions the citation-per-entry requirement', () => {
    expect(rulingsTemplate).toContain('Citation interpreted or overridden');
  });

  it('DECISIONS.template.md mentions invariants', () => {
    expect(decisionsTemplate).toContain('Invariant');
  });

  it('DESIGN.template.md contains --bsg- and the theme-block color rule phrase', () => {
    expect(designTemplate).toContain('--bsg-');
    expect(designTemplate).toContain(
      'color literals live only in the theme block, everything else references tokens'
    );
  });

  it('ASSETS.template.md contains the exact ledger header row, verbatim and in order', () => {
    // Pinned as one exact row — unordered substring checks would pass even if
    // the columns were reordered (several labels also appear in the prose).
    expect(assetsTemplate).toContain(ASSETS_HEADER_ROW);
  });

  it('none of the six template files is a {{BOARDSMITH_ROOT}} thin pointer', () => {
    for (const path of allTemplateFiles) {
      const content = read(path);
      expect(content).not.toContain('{{BOARDSMITH_ROOT}}');
    }
  });
});

describe('TMPL-02 — each template declares its parse contract', () => {
  const chunkTemplate = read('templates/CHUNK.template.md');
  const sketchTemplate = read('templates/SKETCH.template.md');
  const rulingsTemplate = read('templates/RULINGS.template.md');
  const decisionsTemplate = read('templates/DECISIONS.template.md');
  const designTemplate = read('templates/DESIGN.template.md');
  const assetsTemplate = read('templates/ASSETS.template.md');

  it('CHUNK.template.md exposes its authoritative Status: line grammar', () => {
    expect(chunkTemplate).toContain('Status: proposed');
    expect(chunkTemplate).toContain('PARSE CONTRACT (TMPL-02)');
  });

  it('SKETCH.template.md exposes its derived-status pointer grammar', () => {
    expect(sketchTemplate).toContain('DERIVED');
    expect(sketchTemplate).toContain('CHUNK.md');
  });

  it('each ledger template states its required sections (parse contract)', () => {
    expect(rulingsTemplate).toContain('PARSE CONTRACT (TMPL-02)');
    expect(rulingsTemplate).toContain('## Ledger');
    expect(decisionsTemplate).toContain('PARSE CONTRACT (TMPL-02)');
    expect(decisionsTemplate).toContain('## Ledger');
    expect(designTemplate).toContain('PARSE CONTRACT (TMPL-02)');
    expect(designTemplate).toContain('## Chosen Direction');
    expect(assetsTemplate).toContain('PARSE CONTRACT (TMPL-02)');
    expect(assetsTemplate).toContain('## Ledger');
  });
});

describe('SKILLAUTO-01 — SKETCH milestone flag', () => {
  const sketchTemplate = read('templates/SKETCH.template.md');

  it('the Ordered Chunk List entry shape declares a Milestone field', () => {
    expect(sketchTemplate).toMatch(/Milestone: *<!--[^>]*none[^>]*core-loop[^>]*scoring[^>]*final-acceptance/);
  });

  it('the tail-entry shape also carries the Milestone field', () => {
    const tailBlockMatch = sketchTemplate.match(
      /### <!-- slug \(tail entry, sketch-level only\) -->[\s\S]*?(?=\n## )/
    );
    expect(tailBlockMatch, 'tail-entry block must exist').not.toBeNull();
    expect(tailBlockMatch![0]).toContain('Milestone:');
  });

  it('Mandated Chunks names the core-loop, scoring/endgame, and final-acceptance chunks as the three milestone anchors', () => {
    const mandatedSection = sketchTemplate.slice(sketchTemplate.indexOf('## Mandated Chunks'));
    expect(mandatedSection).toContain('milestone anchor');
    expect(mandatedSection).toMatch(/core-loop/);
    expect(mandatedSection).toMatch(/scoring/i);
    expect(mandatedSection).toMatch(/final-acceptance/);
  });
});

/**
 * INDEX.template.md (Phase 170 Plan 07) — pins the exact strings the harness's
 * `checkIngestArtifacts()` asserts against a live-agent-produced `rulebook/INDEX.md`. These
 * assertions prove the template carries the required strings; they do NOT prove an agent
 * copies and fills the template rather than composing its own INDEX.md from prose memory —
 * on 2026-07-27 every contract test for this requirement was green while the real run
 * diverged on every one of these strings. The acceptance bar is `boardsmith harness-ingest`.
 */
describe('v4.9 INGEST-01/03/04 — INDEX.template.md', () => {
  const indexTemplate = read('templates/INDEX.template.md');

  /** The three literal headings, in document order — single source of truth for this block. */
  const INDEX_HEADINGS = ['## Open Rules Gaps', '## Slices', '## Term → Slice'] as const;

  /** The four header labels, in the exact order they must appear at line start. */
  const HEADER_LABELS = ['Edition:', 'Source:', 'Source hash:', 'Transcribed:'] as const;

  it('contains each required heading, exactly, on its own line', () => {
    for (const heading of INDEX_HEADINGS) {
      expect(indexTemplate, `must contain the exact line "${heading}"`).toMatch(
        new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
      );
    }
  });

  it('does not carry a parenthetical suffix on the gaps heading', () => {
    expect(indexTemplate).not.toContain('## Open Rules Gaps (');
  });

  it('uses the rightwards arrow U+2192 in the term-table heading, never the ASCII "->" digraph', () => {
    expect(indexTemplate).toContain('## Term → Slice');
    expect(indexTemplate).not.toContain('## Term -> Slice');
  });

  it('contains all four header labels at line start, in order', () => {
    let cursor = -1;
    for (const label of HEADER_LABELS) {
      const match = indexTemplate.slice(cursor + 1).match(new RegExp(`^${label}`, 'm'));
      expect(match, `must contain "${label}" at line start after the previous label`).not.toBeNull();
      const index = cursor + 1 + (match!.index ?? 0);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('contains the always-emitted empty-gaps body token, exactly', () => {
    expect(indexTemplate).toContain('_None._');
  });

  it('contains the archive path shape, rulebook/source/<original-filename>', () => {
    expect(indexTemplate).toContain('rulebook/source/<original-filename>');
  });

  it('names the interview-path Edition sentinel and states it must not appear on the rulebook path', () => {
    expect(indexTemplate).toContain('unpublished — designer statement');
    expect(flat(indexTemplate)).toMatch(
      /INTERVIEW PATH.{0,80}must NEVER appear on this \(rulebook\) path/,
    );
  });

  it('declares a PARSE CONTRACT (TMPL-02) comment naming the required headings in order', () => {
    const contract = parseContractBlock(indexTemplate);
    let cursor = -1;
    for (const heading of INDEX_HEADINGS) {
      const index = contract.indexOf(heading, cursor + 1);
      expect(index, `PARSE CONTRACT must list "${heading}" (after the previously listed heading)`).toBeGreaterThan(
        cursor,
      );
      cursor = index;
    }
  });

  it('is not a {{BOARDSMITH_ROOT}} thin pointer', () => {
    expect(indexTemplate).not.toContain('{{BOARDSMITH_ROOT}}');
  });
});

/**
 * PROV-01 — the `## Verified Against` fence CHUNK.template.md scaffolds into every new chunk,
 * so the fence exists before any session could be tempted to author the block by hand
 * (171-CONTEXT.md decision 3). The fence strings are imported from the writer's own exported
 * constants rather than re-typed here — a re-typed marker is the exact duplication trap
 * `PRESENTATION_LEXICON` already had to be pinned against.
 */
describe('PROV-01 — CHUNK.template.md scaffolds the machine-owned Verified Against fence', () => {
  const chunkTemplate = read('templates/CHUNK.template.md');

  it('contains the "## Verified Against" heading', () => {
    expect(chunkTemplate).toContain(VERIFIED_AGAINST_HEADING);
  });

  it('contains both fence strings, byte-identical to the exported constants', () => {
    expect(chunkTemplate).toContain(VERIFIED_AGAINST_BEGIN);
    expect(chunkTemplate).toContain(VERIFIED_AGAINST_END);
  });

  it('places the section AFTER "## Verified Commit Hash"', () => {
    const commitHashIdx = chunkTemplate.indexOf('## Verified Commit Hash');
    const verifiedAgainstIdx = chunkTemplate.indexOf(VERIFIED_AGAINST_HEADING);
    expect(commitHashIdx).toBeGreaterThan(-1);
    expect(verifiedAgainstIdx).toBeGreaterThan(commitHashIdx);
  });
});

describe('TMPL-02 — parse-contract heading lists match each template\'s actual headings', () => {
  // The exact H2 headings each template ships, in order. A template's PARSE
  // CONTRACT comment must enumerate exactly these, and the file body must
  // contain exactly these — a mismatch in either direction (a heading shipped
  // but missing from the contract, or vice versa) is the CR-01 defect class.
  const EXPECTED_HEADINGS: Record<string, string[]> = {
    'templates/CHUNK.template.md': [
      '## ui:',
      '## Ceremony',
      '## Step Checklist',
      '## Interpretation',
      '## Visibility Declaration',
      '## Newly Discovered Citations',
      '## Redteam Rounds',
      '## Findings Ledger',
      '## Revision Rounds',
      '## Build Manifest',
      '## Playtest Test Script',
      '## Verified Checklist',
      '## Verified Commit Hash',
      '## Verified Against',
      '## Rules Staleness',
    ],
    'templates/SKETCH.template.md': [
      '## Player Counts',
      '## UI Strategy',
      '## Ordered Chunk List',
      '## Variants (deferred)',
      '## Ideas Backlog',
      '## Mandated Chunks',
    ],
    'templates/RULINGS.template.md': ['## Ledger'],
    'templates/DECISIONS.template.md': ['## Ledger'],
    'templates/DESIGN.template.md': [
      '## Chosen Direction',
      '## Theme Block (--bsg-* / applyTheme() overrides)',
      '## Typography & Spacing',
      '## Component Recipes',
      '## Placeholder Policy',
      "## Do / Don't",
    ],
    'templates/ASSETS.template.md': ['## Ledger'],
  };

  for (const [path, expected] of Object.entries(EXPECTED_HEADINGS)) {
    it(`${path}: actual H2 headings exactly match the expected list, in order`, () => {
      expect(actualHeadings(read(path))).toEqual(expected);
    });

    it(`${path}: PARSE CONTRACT enumerates every shipped heading, in order`, () => {
      const contract = parseContractBlock(read(path));
      let cursor = -1;
      for (const heading of expected) {
        const index = contract.indexOf(heading, cursor + 1);
        expect(
          index,
          `PARSE CONTRACT must list "${heading}" (after the previously listed heading)`
        ).toBeGreaterThan(cursor);
        cursor = index;
      }
    });
  }
});

/**
 * VERIFY-05 — the rules-staleness marker (175-CONTEXT.md decisions 1, 2, 5, 18) must be
 * registered EVERYWHERE its Cold-Resume Parse Contract requires, in the SAME change that ships
 * it (decision 5: an unregistered marker is a project-wide `bs-` skill hard-fail). Constants are
 * imported from `verify-impact.ts`'s own exports — never re-typed here.
 */
describe('VERIFY-05 — the rules-staleness marker is registered everywhere it must be', () => {
  const stateMachine = read('state-machine.md');
  const chunkTemplate = read('templates/CHUNK.template.md');
  const sketchTemplate = read('templates/SKETCH.template.md');

  it('state-machine.md and both templates reference the RULES_STALE_MARKER string', () => {
    expect(stateMachine).toContain(RULES_STALE_MARKER);
    expect(chunkTemplate).toContain(RULES_STALE_MARKER);
    expect(sketchTemplate).toContain(RULES_STALE_MARKER);
  });

  it('CHUNK.template.md scaffolds the heading, both fences, and the empty-state body', () => {
    expect(chunkTemplate).toContain(RULES_STALENESS_HEADING);
    expect(chunkTemplate).toContain(RULES_STALENESS_BEGIN);
    expect(chunkTemplate).toContain(RULES_STALENESS_END);
    expect(chunkTemplate).toContain(RULES_STALENESS_EMPTY);
  });

  it('CHUNK.template.md places the section AFTER "## Verified Against"', () => {
    const verifiedAgainstIdx = chunkTemplate.indexOf(VERIFIED_AGAINST_HEADING);
    const rulesStalenessIdx = chunkTemplate.indexOf(RULES_STALENESS_HEADING);
    expect(verifiedAgainstIdx).toBeGreaterThan(-1);
    expect(rulesStalenessIdx).toBeGreaterThan(verifiedAgainstIdx);
  });

  it('SKETCH.template.md carries the derived-pointer grammar', () => {
    expect(sketchTemplate).toContain(SKETCH_RULES_STALENESS_GRAMMAR);
  });

  it('state-machine.md has a "## Rules Staleness Marker" heading', () => {
    expect(actualHeadings(stateMachine)).toContain('## Rules Staleness Marker');
  });

  it('state-machine.md\'s Consistency Check gains a new item 5 mentioning the marker', () => {
    const item5Match = /^5\..*$/m.exec(stateMachine);
    expect(item5Match, 'Consistency Check must gain a new item 5').not.toBeNull();
    expect(flat(item5Match![0])).toContain('Rules Staleness');
  });

  it('a Cold-Resume Parse Contract sentence points at Consistency Check item 5', () => {
    const contractSection = stateMachine.slice(stateMachine.indexOf('## Cold-Resume Parse Contract'));
    expect(flat(contractSection)).toMatch(/Consistency Check item 5/);
  });
});

/**
 * Decision 18 orthogonality guard — 175-CONTEXT.md's central invariant: rules-staleness is NOT
 * a Status enum value, so none of the 5 sites that enumerate/pin the Status enum should ever
 * change as a side effect of this phase. If a future change needs to edit these, that is the
 * signal that orthogonality broke upstream — not expected work.
 */
describe('decision 1 orthogonality guard — the Status enum did not move', () => {
  const stateMachine = read('state-machine.md');
  const chunkTemplate = read('templates/CHUNK.template.md');
  const sketchTemplate = read('templates/SKETCH.template.md');

  it('STATUS_ENUM_VALUES still has exactly five members', () => {
    expect(STATUS_ENUM_VALUES).toHaveLength(5);
  });

  it('STATE_MACHINE_ENUM_LINE and TEMPLATE_ENUM_LINE each still appear in their files, unchanged', () => {
    expect(stateMachine).toContain(STATE_MACHINE_ENUM_LINE);
    expect(chunkTemplate).toContain(TEMPLATE_ENUM_LINE);
    expect(sketchTemplate).toContain(TEMPLATE_ENUM_LINE);
  });

  it('CHUNK.template.md and SKETCH.template.md each contain TEMPLATE_ENUM_LINE exactly once', () => {
    const countOccurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;
    expect(countOccurrences(chunkTemplate, TEMPLATE_ENUM_LINE)).toBe(1);
    expect(countOccurrences(sketchTemplate, TEMPLATE_ENUM_LINE)).toBe(1);
  });

  it('neither TEMPLATE_ENUM_LINE nor STATE_MACHINE_ENUM_LINE contains the rules-staleness marker or "rules-stale"', () => {
    expect(TEMPLATE_ENUM_LINE).not.toContain(RULES_STALE_MARKER);
    expect(TEMPLATE_ENUM_LINE).not.toContain('rules-stale');
    expect(STATE_MACHINE_ENUM_LINE).not.toContain(RULES_STALE_MARKER);
    expect(STATE_MACHINE_ENUM_LINE).not.toContain('rules-stale');
  });

  it('RULES_STALENESS_CLEAR is never the same string as any Status enum value', () => {
    expect((STATUS_ENUM_VALUES as readonly string[]).includes(RULES_STALENESS_CLEAR)).toBe(false);
  });
});
