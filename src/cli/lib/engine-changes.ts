/**
 * What BoardSmith changed that a game's type errors run into (#423).
 *
 * When BoardSmith changes an API a game calls, the game stops type-checking,
 * and the compiler says only what no longer fits ("Expected 4 arguments, but
 * got 3"). What changed, and what to write instead, is in the engine contract's
 * history: every revision's summary names the APIs it changed. A game's last
 * build records the revision it was built against (`engineRevision` in
 * `dist/manifest.json`), so the revisions since then are the candidates, and
 * the ones whose summary names an identifier on an erroring line are the ones
 * to read.
 */
import type { EngineContractRevision } from '../../contract/index.js';

interface EngineChangeHintInput {
  /** The compiler's diagnostics, `path(line,col): error TSxxxx: message`. */
  diagnostics: readonly string[];
  /** The text of line `line` of `file` (a path as the diagnostic gives it), when it can be read. */
  sourceLine: (file: string, line: number) => string | undefined;
  /** The engine revision the game was last built against. */
  builtRevision: number;
  /** The engine contract's history, oldest first. */
  history: readonly EngineContractRevision[];
}

const DIAGNOSTIC = /^(.+?)\((\d+),\d+\): error TS\d+: (.*)$/;

/**
 * Names in code style (`walkDeclaration`, `WorldWalkAnswers`): a lower-case
 * word with a capital inside, or a capitalised word with a second capital.
 * Plain words ("Type", "arguments") would match every summary.
 */
const CODE_NAME = /\b(?:[a-z][a-z0-9]*[A-Z]|[A-Z][a-z0-9]+[A-Z])[A-Za-z0-9]*\b/g;

const mentions = (summary: string, name: string) => new RegExp(`\\b${name}\\b`).test(summary);

/** Each erroring place, with the code-style names on its line and in its message. */
function erroringPlaces(input: EngineChangeHintInput): Array<{ file: string; line: number; names: string[] }> {
  return input.diagnostics.flatMap((diagnostic) => {
    const match = DIAGNOSTIC.exec(diagnostic.trim());
    if (!match) return [];
    const [, file, lineText, message] = match;
    const line = Number(lineText);
    const text = `${input.sourceLine(file, line) ?? ''} ${message}`;
    return [{ file, line, names: [...new Set(text.match(CODE_NAME) ?? [])] }];
  });
}

/** `tests/a.ts:1, 2; src/b.ts:5` */
function placesText(places: Array<{ file: string; line: number }>): string {
  const byFile = new Map<string, number[]>();
  for (const { file, line } of places) {
    const lines = byFile.get(file) ?? [];
    if (!lines.includes(line)) lines.push(line);
    byFile.set(file, lines);
  }
  return [...byFile].map(([file, lines]) => `${file}:${lines.join(', ')}`).join('; ');
}

/**
 * Lines to print above the compiler's errors: each revision after the game's
 * last build whose summary names something on an erroring line, with where and
 * what it says. Null when no revision since the build does.
 */
export function engineChangeHint(input: EngineChangeHintInput): string[] | null {
  const current = input.history[input.history.length - 1].revision;
  const places = erroringPlaces(input);
  const changes = input.history
    .filter((r) => r.revision > input.builtRevision)
    .flatMap((r) => {
      const hit = places.filter((p) => p.names.some((name) => mentions(r.summary, name)));
      if (hit.length === 0) return [];
      const names = [...new Set(hit.flatMap((p) => p.names.filter((name) => mentions(r.summary, name))))];
      // In the order the summary names them, which is the order it explains them.
      names.sort((a, b) => r.summary.search(new RegExp(`\\b${a}\\b`)) - r.summary.search(new RegExp(`\\b${b}\\b`)));
      return [`Engine revision ${r.revision} (${r.date}) changed ${names.join(', ')}, used at ${placesText(hit)}: ${r.summary}`];
    });
  if (changes.length === 0) return null;
  return [
    `BoardSmith changed something this code uses after this game was last built (engine revision ${input.builtRevision}; ` +
      `this BoardSmith is revision ${current}). Change the code the way the revision${changes.length === 1 ? '' : 's'} below ` +
      `say${changes.length === 1 ? 's' : ''}, then run \`boardsmith validate\` again.`,
    ...changes,
  ];
}
