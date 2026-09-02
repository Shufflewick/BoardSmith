/**
 * Drift detection for `.fallow-health-baseline.json` (issue #159).
 *
 * `fallow audit` scopes its verdict to the files a change touches and reports
 * every finding in them, baseline-matched ones excluded. The baseline is a
 * GENERATED file: it records, per file, how many findings of each category the
 * tree had when it was saved. Nothing keeps it in sync afterwards.
 *
 * When it drifts, the gate stops excluding a file's long-standing debt and
 * reports all of it against whatever change happened to touch that file. The
 * observed shape was one appended comment line in
 * `src/engine/action/action.ts` producing seven critical complexity findings,
 * none introduced by the change, and a blocked commit — so an unrelated file
 * became uneditable, which reads as a gate catching something rather than as a
 * stale generated file.
 *
 * This module makes the drift itself the finding: a named, actionable failure
 * with the regeneration command, rather than a surprise on whoever next edits
 * a drifted file.
 *
 * @module
 */

/** One finding category's count for one file, as fallow saves it. */
interface BaselineCount {
  count: number;
}

/** The committed `.fallow-health-baseline.json` shape, as far as drift cares. */
export interface HealthBaseline {
  /** Per-file, per-category finding counts — the half that goes stale. */
  finding_counts: Record<string, Record<string, BaselineCount>>;
  production_coverage_findings?: unknown[];
  target_keys?: string[];
}

/**
 * One category of one file whose recorded count no longer matches the tree.
 *
 * `direction` says which failure this is:
 * - `unrecorded` — the tree has MORE than the baseline forgives, so the next
 *   change touching this file is blocked on debt it did not introduce. This is
 *   the false-block mechanism.
 * - `stale` — the baseline still forgives debt that is gone, so a real
 *   regression in that category could slip in under the old allowance.
 */
export interface BaselineDrift {
  file: string;
  category: string;
  baseline: number;
  current: number;
  direction: 'unrecorded' | 'stale';
}

function countOf(
  counts: Record<string, Record<string, BaselineCount>>,
  file: string,
  category: string,
): number {
  return counts[file]?.[category]?.count ?? 0;
}

/**
 * Compare the committed baseline against one freshly saved from the same tree.
 *
 * Returns one entry per drifted (file, category), sorted by file then category
 * so the report is stable across runs.
 */
export function compareHealthBaselines(
  committed: HealthBaseline,
  fresh: HealthBaseline,
): BaselineDrift[] {
  const committedCounts = committed.finding_counts ?? {};
  const freshCounts = fresh.finding_counts ?? {};
  const files = [...new Set([...Object.keys(committedCounts), ...Object.keys(freshCounts)])].sort();

  const drift: BaselineDrift[] = [];
  for (const file of files) {
    const categories = [
      ...new Set([
        ...Object.keys(committedCounts[file] ?? {}),
        ...Object.keys(freshCounts[file] ?? {}),
      ]),
    ].sort();

    for (const category of categories) {
      const baseline = countOf(committedCounts, file, category);
      const current = countOf(freshCounts, file, category);
      if (baseline === current) continue;
      drift.push({
        file,
        category,
        baseline,
        current,
        direction: current > baseline ? 'unrecorded' : 'stale',
      });
    }
  }
  return drift;
}

/**
 * An actionable report for a drifted baseline: what drifted, which way, and
 * the one command that fixes it.
 */
export function describeBaselineDrift(drift: BaselineDrift[]): string {
  const lines = [
    `The committed .fallow-health-baseline.json no longer describes this tree (${drift.length} drifted ${drift.length === 1 ? 'entry' : 'entries'}).`,
    '',
    'A baseline entry that under-records real debt is what turns one unrelated',
    'edit into a blocked commit: the gate stops excluding that file\'s existing',
    'findings and reports all of them against the change that touched it.',
    '',
  ];

  for (const entry of drift) {
    const shape =
      entry.direction === 'unrecorded'
        ? `baseline forgives ${entry.baseline}, tree has ${entry.current} — the next edit to this file is blocked on debt it did not add`
        : `baseline forgives ${entry.baseline}, tree has ${entry.current} — the allowance outlived the debt`;
    lines.push(`  ${entry.file} · ${entry.category}: ${shape}`);
  }

  lines.push(
    '',
    'Regenerate it from a clean checkout of main:',
    '  npx fallow health --save-baseline .fallow-health-baseline.json',
    '',
    'See docs/fallow-gate.md — regenerate deliberately, never to turn a red board green.',
  );
  return lines.join('\n');
}
