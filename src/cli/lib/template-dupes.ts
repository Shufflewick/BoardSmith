/**
 * DUPLICATED VUE TEMPLATE AND STYLE MARKUP, GATED BY CONTENT (#596).
 *
 * fallow scans only the script blocks of `.vue` files, so duplicated
 * `<template>` and `<style>` markup is reported by jscpd alone. jscpd exits 0
 * whatever it finds unless told to fail, so `boardsmith audit --duplication`
 * used to gate nothing. This module turns jscpd's report into the same
 * content-keyed record the fallow duplication baseline uses
 * (`dupes-baseline.ts`), so a new clone fails and accepted ones are recorded in
 * `.jscpd-accepted.json`.
 *
 * ## Scope: `.vue` template and style blocks only
 *
 * jscpd runs with `--format vue`, which splits each component into blocks and
 * reports each clone with its block's format (`ActionPanel.vue:html`). Clones in
 * script blocks are dropped here, and `.ts` files are never scanned, because
 * fallow already gates both: counting them twice would make every script clone
 * need two acceptances and two fixes to agree.
 *
 * ## The key
 *
 * jscpd reports a clone as a PAIR of line ranges. Each pair becomes a clone
 * group of its two instances, read from the source by whole lines (which is
 * exactly what jscpd's own `fragment` holds for the first instance), and is
 * keyed by `cloneGroupKey`: a hash of the instances' sorted text. Code moving
 * above or below the clone does not change it; editing or copying the clone
 * does.
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DupesScan, compareAcceptedDupes } from './dupes-baseline.js';

/** The committed record of accepted template and style duplication. */
export const TEMPLATE_DUPES_FILE = '.jscpd-accepted.json';

/** What jscpd scans, relative to the workspace. Its report names files relative to this. */
const SCAN_ROOT = 'src';

/** The file jscpd's `json` reporter writes into its `--output` directory. */
export const JSCPD_REPORT_FILE = 'jscpd-report.json';

/** The arguments of the one jscpd scan the gate runs, writing its JSON report into `outputDir`. */
export function jscpdTemplateArgs(outputDir: string): string[] {
  return [
    SCAN_ROOT,
    '--format', 'vue',
    '--min-lines', '10',
    '--min-tokens', '100',
    '--reporters', 'json',
    '--output', outputDir,
    '--silent',
  ];
}

/** Block formats fallow already scans, so their clones are left to it. */
const SCRIPT_FORMATS = new Set(['javascript', 'typescript', 'jsx', 'tsx']);

/** One side of a clone, as jscpd 5.3.2's `json` reporter writes it. */
interface JscpdLocation {
  /** Relative to the scan root, with the block's format after a colon: `ui/X.vue:html`. */
  name: string;
  start: number;
  end: number;
}

/** The part of `jscpd-report.json` this module reads. */
export interface JscpdReport {
  duplicates: {
    format: string;
    lines: number;
    firstFile: JscpdLocation;
    secondFile: JscpdLocation;
  }[];
}

export function isJscpdReport(value: unknown): value is JscpdReport {
  return Array.isArray((value as Partial<JscpdReport> | null)?.duplicates);
}

/** The workspace-relative source file a jscpd location names. */
function sourcePath(name: string): string {
  return `${SCAN_ROOT}/${name.replace(/\.vue:[\w-]+$/, '.vue')}`;
}

/** The template and style clones in a jscpd report, as clone groups keyed by their text. */
export function templateScan(report: JscpdReport, cwd: string): DupesScan {
  const sources = new Map<string, string[]>();
  const instance = (location: JscpdLocation) => {
    const file = sourcePath(location.name);
    let lines = sources.get(file);
    if (lines === undefined) {
      lines = readFileSync(join(cwd, file), 'utf-8').split('\n');
      sources.set(file, lines);
    }
    return {
      file,
      start_line: location.start,
      end_line: location.end,
      fragment: lines.slice(location.start - 1, location.end).join('\n'),
    };
  };
  return {
    clone_groups: report.duplicates
      .filter((clone) => !SCRIPT_FORMATS.has(clone.format))
      .map((clone) => ({
        line_count: clone.lines,
        instances: [instance(clone.firstFile), instance(clone.secondFile)],
      })),
  };
}

/** A clone the record and the tree disagree about, as `compareAcceptedDupes` reports it. */
type TemplateDrift = ReturnType<typeof compareAcceptedDupes>[number];

/**
 * An actionable report for template duplication the record does not match.
 *
 * Like `describeDupesDrift`, it names no command for duplication nothing has
 * accepted, except when the project keeps no record at all: creating the
 * record is a deliberate act that shows up as a new committed file.
 */
export function describeTemplateDrift(drift: TemplateDrift[], recordExists: boolean): string {
  const added = drift.filter((entry) => entry.direction === 'new');
  const gone = drift.filter((entry) => entry.direction === 'gone');
  const row = (sign: string, entry: TemplateDrift) =>
    `  ${sign} ${entry.content} · ${entry.lines} lines · ${entry.files.join(', ')}`;
  const lines = [
    `${TEMPLATE_DUPES_FILE} does not match this tree's Vue template and style duplication `
      + `(${added.length} unaccepted, ${gone.length} accepted but absent).`,
    '',
  ];
  if (added.length > 0) {
    lines.push('TEMPLATE DUPLICATION NOTHING HAS ACCEPTED:', '', ...added.map((entry) => row('+', entry)), '');
  }
  if (gone.length > 0) {
    lines.push(
      'ACCEPTED TEMPLATE DUPLICATION THAT IS GONE. The allowance outlived the clone:',
      '',
      ...gone.map((entry) => row('-', entry)),
      '',
      'Drop them with `boardsmith audit --rekey-dupes` and commit the file it rewrites.',
      '',
    );
  }
  lines.push(
    'Fix the duplication, or accept it deliberately. See docs/fallow-gate.md',
    '§ "Vue template duplication is gated by jscpd (#596)".',
  );
  if (!recordExists) {
    lines.push(
      '',
      `This project keeps no ${TEMPLATE_DUPES_FILE} yet. To accept this tree's template`,
      'duplication as it stands, run `boardsmith audit --rekey-dupes`, which creates it.',
    );
  }
  return lines.join('\n');
}
