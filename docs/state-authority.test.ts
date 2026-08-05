/**
 * BUG-004 regression guard: the docs must not re-acquire the event-sourcing
 * claim they carried for months.
 *
 * `docs/agent-control.md` and `docs/architecture.md` asserted that state is
 * reconstructed by replaying `actionHistory`. It never was — `fromSnapshot` is
 * state-authoritative and deliberately re-runs nothing, because selection-step
 * mutations are recorded in neither history. The docs contradicted
 * `core-concepts.md` AND the code, and a game port planned a whole architecture
 * on the false version before discovering it.
 *
 * That is drift a reader cannot detect, so it is asserted here rather than
 * trusted to review. These are prose assertions on purpose: the failing message
 * tells the next editor WHY the sentence they just wrote is wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DOCS = dirname(fileURLToPath(import.meta.url));

/** Every prose doc that describes how state is stored or restored. */
const STATE_MODEL_DOCS = [
  'agent-control.md',
  'architecture.md',
  'core-concepts.md',
  'nomenclature.md',
  'state-size.md',
] as const;

const read = (name: string) => readFileSync(join(DOCS, name), 'utf-8');

/**
 * Claims that assert the abandoned model. Each is matched case-insensitively
 * against the whole doc; the docs are free to say "NOT event-sourced" or
 * "never replayed", which is why the patterns require the AFFIRMATIVE form.
 */
const FALSE_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /(state|it) is (always )?(reconstructed|reconstructible|rebuilt|restored) by replaying/i,
    why: 'State is restored from a snapshot or a per-action checkpoint. Replay is unsound here: selection-step mutations are recorded in neither commandHistory nor actionHistory.',
  },
  {
    pattern: /GameRunner\.replay\s*\(/,
    why: 'There is no restore-by-replay entry point. Use GameRunner.fromSnapshot / fromCheckpoint.',
  },
  {
    pattern: /(game )?state is event-sourced/i,
    why: 'BoardSmith is state-authoritative. Say so, and point at docs/state-size.md for the cost.',
  },
  {
    pattern: /^#{2,4} Event Sourcing\s*$/m,
    why: 'The section is "State Authority" — the engine has no event-sourcing layer to document.',
  },
];

describe('BUG-004: docs assert the state-authoritative model', () => {
  for (const doc of STATE_MODEL_DOCS) {
    for (const { pattern, why } of FALSE_CLAIMS) {
      it(`${doc} does not claim ${pattern}`, () => {
        expect(read(doc), why).not.toMatch(pattern);
      });
    }
  }

  it('architecture.md states the model positively, near the top', () => {
    const opening = read('architecture.md').split('\n').slice(0, 30).join('\n');
    expect(opening, 'the invariant must be stated before the reader reaches any diagram').toMatch(
      /state-authoritative/i
    );
    expect(opening).toMatch(/never replayed/i);
  });

  it('architecture.md cross-links state-size.md, which explains the cost', () => {
    expect(read('architecture.md'), 'a reader who believes in replay cannot understand why saved size scales with action count').toContain(
      'state-size.md'
    );
  });

  it('agent-control.md describes time-travel as checkpoint restore', () => {
    const doc = read('agent-control.md');
    expect(doc).toMatch(/state-authoritative/i);
    expect(doc).toMatch(/checkpoint/i);
  });
});
