/**
 * THE ONE GRAMMAR FOR A LINE LOCATION written after a path in a design record (#414).
 *
 * A claim's `Source:` line (`../src/rules/game.ts:120-135`, claim-quotes.ts) and a script or
 * capture cited as evidence (`.boardsmith/scratch/probe.mjs:1-5`, cited-evidence.ts) are both
 * split here, so a location one check reads is never a different file, or no file at all, to the
 * other. Where the path then points is `designRecordPath` (project-paths.ts, #409).
 *
 *   - `path:N` is line N.
 *   - `path:N-M` is lines N to M.
 *   - `path:N:C` (compiler style, line and column) is line N; the column is returned so a reader
 *     that only takes lines, such as claim-quote-check, can refuse it.
 */

/** A 1-based, inclusive range of lines, as written: `lineRangeProblem` says whether it is valid. */
export type LineRange = readonly [from: number, to: number];

interface LineLocation {
  /** The path as written, without its location. */
  path: string;
  lines?: LineRange;
  column?: number;
}

const LOCATION = /^(.+?):(\d+)(?:-(\d+)|:(\d+))?$/;

/** Splits a written `path:N`, `path:N-M` or `path:N:C` into its path and the lines it names. */
export function splitLineLocation(written: string): LineLocation {
  const m = LOCATION.exec(written);
  if (!m) return { path: written };
  const from = Number(m[2]);
  const lines: LineRange = [from, m[3] === undefined ? from : Number(m[3])];
  return m[4] === undefined ? { path: m[1], lines } : { path: m[1], lines, column: Number(m[4]) };
}

/** A file's lines. The empty text after a final newline is not a line. */
export function fileLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * What is wrong with citing `range` in a file of `lineCount` lines: `invalid` for line 0 or a
 * range that runs backwards, `past-end` for one that runs past the last line.
 */
export function lineRangeProblem(range: LineRange, lineCount: number): 'invalid' | 'past-end' | undefined {
  const [from, to] = range;
  if (from < 1 || to < from) return 'invalid';
  return to > lineCount ? 'past-end' : undefined;
}

/** How to write a line location, for any message that refuses one. */
export const LINE_LOCATION_HINT = 'Write it as :N or :N-M with N <= M.';
