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

  it('contains every exact status-enum token', () => {
    expect(stateMachine).toContain('`proposed`');
    expect(stateMachine).toContain('`approved`');
    expect(stateMachine).toContain('`built`');
    expect(stateMachine).toContain('`verified`');
    expect(stateMachine).toContain('verified (user-waived)');
  });

  it('contains the exact CHUNK-level stale marker (em-dash, not hyphen)', () => {
    expect(stateMachine).toContain('stale — re-derive before build');
    // Guard against a hyphen regression slipping in unnoticed.
    expect(stateMachine).not.toContain('stale - re-derive before build');
  });
});

// TODO(Plan 02): describe('TMPL-01 — CHUNK.template.md') / describe('TMPL-01 — SKETCH.template.md')
// asserting the same step-name/status-enum strings appear identically in the templates
// themselves (cross-file consistency with state-machine.md), plus each template's own
// required-headings / parse-contract content.

// TODO(Plan 03): describe('TMPL-01 — RULINGS.template.md'), describe('TMPL-01 — DECISIONS.template.md'),
// describe('TMPL-01 — DESIGN.template.md'), describe('TMPL-01 — ASSETS.template.md')
// asserting each ledger template's required fields per the Durable Artifacts table.
