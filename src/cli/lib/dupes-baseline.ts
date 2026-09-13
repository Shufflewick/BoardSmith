/**
 * A CONTENT KEY FOR THE DUPLICATION BASELINE (#232).
 *
 * `.fallow-dupes-baseline.json` keys an accepted clone group by
 * `file:start-end|file:start-end`. That address is not a property of the debt;
 * it is a property of everything ABOVE the debt. Insert a line at the top of a
 * file and every accepted group in it is mis-addressed, silently, because
 * `fallow audit` has nothing in scope on `main` and never looks. The staleness
 * surfaces on whoever next edits one of the named files, as their change being
 * blamed for clone groups that predate it: #230 hit exactly that with a
 * four-line edit to `GameShell.vue` and six groups keyed 22 to 31 lines above
 * where the code sat, and `main` had already drifted 25 lines before that edit.
 *
 * ## The key, and why it is stable
 *
 * A clone group is keyed here by ITS OWN TEXT: the SHA-256 of the group's
 * instance fragments, sorted lexicographically and joined, which is exactly
 * what `fallow dupes --format json` already reports per instance.
 *
 * That is invariant under every change that is not this debt. Code moving
 * above it, below it, or in another file does not touch it. Renaming the file
 * does not touch it. Moving the whole group to another file does not touch it,
 * and should not: relocated duplication is the same duplication. The fragments
 * are sorted by their own text rather than by position, so two instances
 * swapping places in a file do not either.
 *
 * And it still fails on what should fail. Copy-pasting an accepted clone into
 * one more place makes the group's fragment multiset larger, so its key
 * changes and the group reports as new. Editing the duplicated code changes
 * its text, so it reports as new too, which is the honest answer: the reason
 * `docs/fallow-gate.md` tells a human to check a group's content line by line
 * before re-keying it is that a group whose content changed is new debt wearing
 * an old key. This does that check on every run instead of on request.
 *
 * ## The one thing that DID move it was not fallow (#241)
 *
 * This module used to warn that fallow chooses a clone group's boundaries, so
 * a large edit elsewhere in the same file might re-cut the same debt a line or
 * two differently and change its key. Two sightings were attributed to that,
 * and neither was that. Both were a defect in how the scan was READ.
 *
 * `fallow dupes --format json` prints a report of several megabytes, and
 * `runToolCapturingStdout` used to decode each arriving chunk on its own.
 * A chunk boundary can fall inside a multi-byte UTF-8 character, and decoding
 * the halves separately replaces them with U+FFFD -- so the fragment being
 * hashed was not the source text. Where the boundary lands depends on the byte
 * offsets of everything printed earlier, which is why inserting lines in the
 * MIDDLE of one file (renumbering every group reported after it) moved the
 * keys of accepted groups in four unrelated, byte-identical files, while
 * appending the same lines at the END of that file moved nothing.
 *
 * Measured on the tree that reported it: with the per-chunk decode, the
 * insertion produced six U+FFFD characters and a different key set; with the
 * whole stream decoded once, both trees produce zero and the same key set.
 * The group ADDRESSES were byte-identical across the insertion on both sides,
 * so fallow had never re-cut anything.
 *
 * The key was already a pure function of the group's own text. What it now
 * also gets is that text. Normalising the fragments would have hidden this
 * instead of fixing it, and would have cost the gate the property it exists
 * for: an edit to duplicated code MUST change its key.
 *
 * ## Why the line-keyed file still exists
 *
 * `fallow audit` reads it, and the key format is fallow's, not ours. So it
 * becomes a DERIVED file: `.fallow-dupes-accepted.json` records the accepted
 * debt by content, and the addresses are re-derived from a scan whenever they
 * move. Re-addressing is safe precisely because the content matched first, and
 * it carries no judgement -- three measured instances in one session all
 * reported "every one matched by content, so no debt was forgiven" -- so
 * `boardsmith audit` now does it itself and reports that it did (#256). It is
 * still COMMITTED rather than generated on demand, because the thing that runs
 * automatically is a raw `fallow audit` from ShufflewickPub's commit hook, with
 * no `boardsmith` in the loop: an absent baseline would report all ~1100
 * accepted groups against whatever file the next commit touched.
 *
 * ## Why the other two baselines keep their own keys
 *
 * Neither carries an address, so neither can be invalidated this way.
 * `.fallow-dead-code-baseline.json` keys a finding by symbol name and file, and
 * `.fallow-health-baseline.json` keys a per-file, per-category COUNT. Both
 * still drift, but they drift in what they record rather than in where they
 * point, which is why #159's answer for the health baseline is a drift report
 * (`health-baseline.ts`) and not a re-key. A content key would tell you nothing
 * about either.
 *
 * @module
 */

import { createHash } from 'node:crypto';

/** One occurrence of a clone, as `fallow dupes --format json` reports it. *
 * Not exported: it is only ever reached through `CloneGroup`.
 */
interface CloneInstance {
  file: string;
  start_line: number;
  end_line: number;
  /** The duplicated text itself. This is what the key is made of. */
  fragment: string;
}

/** One clone group: the same code in two or more places. */
export interface CloneGroup {
  instances: CloneInstance[];
  line_count: number;
}

/** The part of a `fallow dupes --format json` report this module reads. */
export interface DupesScan {
  clone_groups: CloneGroup[];
}

/**
 * One accepted clone group, addressed by content.
 *
 * `files` and `lines` are recorded for the reader, not for the key: they say
 * where the debt currently is and how big it is, so the committed file is
 * reviewable. They are re-derived on every re-key, so they cannot go stale
 * without the check saying so.
 *
 * Not exported: it is only ever reached through `AcceptedDupes`.
 */
interface AcceptedCloneGroup {
  content: string;
  lines: number;
  files: string[];
}

/** The committed `.fallow-dupes-accepted.json` shape. */
export interface AcceptedDupes {
  accepted: AcceptedCloneGroup[];
}

/**
 * The content key: a hash of the group's own text and nothing else.
 *
 * Truncated to 16 hex characters, which is 64 bits. The whole repository holds
 * on the order of a thousand groups, so an accidental collision is not a
 * scenario this has to survive, and a short key keeps the committed file
 * readable.
 *
 * The fragments are joined by a NUL, which no source text can hold, so no
 * fragment can forge the delimiter. It is spelled as the escape and never as
 * the byte: one literal NUL in this file makes git classify it as binary and
 * every change to it undiffable, which is what #243 fixed.
 */
export function cloneGroupKey(group: CloneGroup): string {
  const text = group.instances
    .map((instance) => instance.fragment)
    .sort()
    .join('\u0000');
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** The accepted record this tree would produce, sorted for a stable diff. */
export function acceptedFromScan(scan: DupesScan): AcceptedDupes {
  const accepted = scan.clone_groups.map((group) => ({
    content: cloneGroupKey(group),
    lines: group.line_count,
    files: [...new Set(group.instances.map((instance) => instance.file))].sort(),
  }));
  accepted.sort(
    (a, b) => a.content.localeCompare(b.content) || a.files.join('|').localeCompare(b.files.join('|')),
  );
  return { accepted };
}

/**
 * A clone group the accepted record and the tree disagree about.
 *
 * - `new` -- the tree has duplication nothing has accepted. Fix it, or accept
 *   it deliberately; it cannot be re-keyed away, because there is no entry to
 *   re-key.
 * - `gone` -- the record accepts duplication the tree no longer has, so a real
 *   regression could return under the old allowance.
 *
 * Not exported: it is only ever the inferred result of `compareAcceptedDupes`.
 */
interface DupesDrift {
  direction: 'new' | 'gone';
  content: string;
  lines: number;
  files: string[];
}

/** How many times each content key appears. A record is a multiset of debt. */
function countKeys(record: AcceptedDupes): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of record.accepted ?? []) {
    counts.set(group.content, (counts.get(group.content) ?? 0) + 1);
  }
  return counts;
}

/** One entry per content key, for saying WHERE a drifted group is. */
function representatives(records: readonly AcceptedDupes[]): Map<string, AcceptedCloneGroup> {
  const byKey = new Map<string, AcceptedCloneGroup>();
  for (const record of records) {
    for (const group of record.accepted ?? []) {
      if (!byKey.has(group.content)) byKey.set(group.content, group);
    }
  }
  return byKey;
}

/**
 * Compare the committed accepted record against the tree's own.
 *
 * Multiplicity counts: two groups with identical text in different places are
 * two pieces of debt, and accepting one does not accept the other. So the
 * comparison is a multiset difference, and a key whose count is unchanged
 * contributes nothing.
 *
 * It returns nothing when the accepted CONTENT matches, even if every address
 * has moved. That is the whole point: a moved group is not a finding, it is a
 * re-key, and `describeAddressDrift` is what reports one.
 */
export function compareAcceptedDupes(
  committed: AcceptedDupes,
  fresh: AcceptedDupes,
): DupesDrift[] {
  const was = countKeys(committed);
  const is = countKeys(fresh);
  const where = representatives([committed, fresh]);
  return [...where.keys()].sort().flatMap((content) => {
    const delta = (is.get(content) ?? 0) - (was.get(content) ?? 0);
    const direction: DupesDrift['direction'] = delta > 0 ? 'new' : 'gone';
    const { lines, files } = where.get(content) as AcceptedCloneGroup;
    return Array.from({ length: Math.abs(delta) }, () => ({ direction, content, lines, files }));
  });
}

/** The two baseline files, named once so a report and a writer agree. */
export const ACCEPTED_DUPES_FILE = '.fallow-dupes-accepted.json';
export const DUPES_BASELINE_FILE = '.fallow-dupes-baseline.json';

/**
 * An actionable report for duplication the accepted record does not match.
 *
 * Deliberately does NOT name a regeneration command for the `new` case: a
 * fresh full-repository save is what silently forgives new duplication, which
 * is the mistake `docs/fallow-gate.md` warns about in those words.
 */
export function describeDupesDrift(drift: DupesDrift[]): string {
  const added = drift.filter((entry) => entry.direction === 'new');
  const gone = drift.filter((entry) => entry.direction === 'gone');
  const lines = [
    `${ACCEPTED_DUPES_FILE} does not match this tree's duplication `
      + `(${added.length} unaccepted, ${gone.length} accepted but absent).`,
    '',
  ];

  if (added.length > 0) {
    lines.push(
      'DUPLICATION NOTHING HAS ACCEPTED. Every one of these will be reported',
      'against whoever next edits one of the named files, so it is theirs to',
      'answer for unless it is dealt with here:',
      '',
    );
    for (const entry of added) {
      lines.push(`  + ${entry.content} · ${entry.lines} lines · ${entry.files.join(', ')}`);
    }
    lines.push('');
  }

  if (gone.length > 0) {
    lines.push(
      'ACCEPTED DEBT THAT IS GONE. The allowance outlived the duplication, so',
      'the same clone could come back without the gate noticing:',
      '',
    );
    for (const entry of gone) {
      lines.push(`  - ${entry.content} · ${entry.lines} lines · ${entry.files.join(', ')}`);
    }
    lines.push('');
  }

  lines.push(
    'Fix the duplication, or accept the named groups deliberately. See',
    'docs/fallow-gate.md § "The duplication baseline is keyed by CONTENT".',
    '',
    'Discarding the whole accepted record and re-recording this tree',
    'is NOT the ordinary remedy (#256). It forgives every allowance in the record',
    'at once, along with whatever else the tree happens to hold, and under time',
    'pressure that is exactly how accepted debt gets widened by accident.',
  );
  return lines.join('\n');
}

/**
 * A report for accepted debt whose ADDRESSES the audit has just moved (#256).
 *
 * This is the #232 case, and it is not a finding about the code: the content
 * matched exactly, so nothing about the debt changed and re-addressing is
 * provably safe. It used to be reported as a FAILURE naming `--rekey-dupes`,
 * which made a mechanical, judgement-free correction into a manual step -- and
 * the cost of forgetting it landed on whoever next edited a moved file, not on
 * whoever moved it. So the message is in the past tense: the audit did it.
 *
 * What it must still say is what changed and that nothing was forgiven, because
 * a tool that silently rewrites a committed file is worse than one that asks.
 */
export function describeReaddressed(moved: number): string {
  return [
    `Re-addressed ${moved} accepted clone ${moved === 1 ? 'group' : 'groups'} in `
      + `${DUPES_BASELINE_FILE} and ${ACCEPTED_DUPES_FILE}.`,
    '',
    "The duplication itself is unchanged -- every group's content matched the",
    'accepted record exactly, so no debt was forgiven. Only the line numbers',
    'moved, because code above them did. Left as they were, the next edit to one',
    'of those files would have been blocked on clone groups that predate it',
    '(#232), which is a bill nobody who caused it ever sees.',
    '',
    'Commit both files with your change.',
  ].join('\n');
}
