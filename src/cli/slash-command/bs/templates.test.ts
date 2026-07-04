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

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
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

/** The exact enum line as it appears in state-machine.md ("Status Enum (exact)"). */
const STATE_MACHINE_ENUM_LINE = STATUS_ENUM_VALUES.map((v) => `\`${v}\``).join(' | ');

/** The exact enum value list as it appears in CHUNK.template.md and SKETCH.template.md. */
const TEMPLATE_ENUM_LINE = [...STATUS_ENUM_VALUES, STALE_MARKER].join(' | ');

/** The exact ASSETS.md ledger header row ("exactly these five columns, in this order"). */
const ASSETS_HEADER_ROW = '| needed-by-chunk | requested | received | placeholder-in-use | file path |';

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
    expect(sketchTemplate).toContain('Status: proposed (sketch-level — no CHUNK.md yet)');
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
      '## Findings Ledger',
      '## Revision Rounds',
      '## Build Manifest',
      '## Playtest Test Script',
      '## Verified Checklist',
      '## Verified Commit Hash',
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
