/**
 * Which strings in a design record cite a script or a capture, and where each one lives (#292).
 *
 * A ledger entry or a verified CHUNK.md that says "measured with <harness>" or "see <screenshot>"
 * is only evidence if a reviewer can open that file later. `.boardsmith/scratch/` is gitignored,
 * so a harness written there and cited as proof exists nowhere once the session ends (sotf's
 * food-invariant harness, cited by a decision that said it was committed). `ledger-check` holds
 * every path this module finds to "it is in git"; this module only finds them. Where each one
 * points is the one rule for a path in a design record, `designRecordPath` (project-paths.ts, #409).
 *
 * A citation is a whitespace-, quote-, bracket- or backtick-delimited token that contains a `/`
 * and ends in a script or capture extension, optionally followed by a line location (`:N`,
 * `:N-M`, `:N:C`) read by the one grammar for one, `splitLineLocation` (line-location.ts, #414).
 * The lines it names are returned with it, so `ledger-check` can hold them to "the file has them". Skipped on purpose: URLs, a path in another
 * repository written `<repo>:<path>` (for example `BoardSmith:src/engine/game.ts`), template
 * placeholders and globs (`<slug>`, `*`, `{a,b}`), bare file names, anything inside an HTML
 * comment, which is where the templates keep their examples, and a module specifier quoted in
 * import, export or require syntax (`import { beat } from './heartbeat.js'`), which is code being
 * described rather than a file being cited (#398).
 */

import { blankComments } from './ledger-entries.js';
import { type LineRange, splitLineLocation } from './line-location.js';
import { CHUNKS_DIR, DESIGN_DIR } from './project-paths.js';

/** Where committed evidence for a chunk lives, project-relative. */
export const CHUNK_EVIDENCE_DIR = `${DESIGN_DIR}/${CHUNKS_DIR}/<slug>/evidence/`;

interface CitedPath {
  /** The path as written, without its line location. */
  path: string;
  /** 1-based line of the file it was cited on. */
  line: number;
  /** The lines of the cited file the citation names, when it names any (`path:N`, `path:N-M`). */
  lines?: LineRange;
}

const EVIDENCE_EXTENSION = /\.(?:mjs|cjs|js|mts|cts|ts|sh|py|png|jpe?g|gif|webp|svg|webm|mp4)$/i;
const TOKEN = /[^\s`'"()[\],;]+/g;
const NOT_A_GAME_PATH = /[*{}<>$]/;
/**
 * The quoted specifier of an `import ... from`, `export ... from`, `import(...)`, bare `import`
 * or `require(...)`. A `from` counts only after `import` or `export` on the same line, so prose
 * such as `copied from "tests/food.test.ts"` is still a citation.
 */
const MODULE_SPECIFIER =
  /\b(?:import|export)\b[^'"\n]*?\bfrom\s*(['"])[^'"\n]*\1|\b(?:import|require)\s*\(?\s*(['"])[^'"\n]*\2/g;

function asCitation(raw: string): { path: string; lines?: LineRange } | undefined {
  const { path, lines } = splitLineLocation(raw.replace(/[.,:;!?]+$/, ''));
  if (!path.includes('/') || !EVIDENCE_EXTENSION.test(path)) return undefined;
  if (NOT_A_GAME_PATH.test(path)) return undefined;
  // A colon before the first slash is a URL scheme or a `<repo>:` qualifier.
  if (/^[^/]*:/.test(path)) return undefined;
  return lines ? { path, lines } : { path };
}

/** Every cited script or capture in `text`, in file order. */
export function citedEvidencePaths(text: string): CitedPath[] {
  const cited: CitedPath[] = [];
  blankComments(text)
    .split('\n')
    .forEach((lineText, index) => {
      for (const [token] of lineText.replace(MODULE_SPECIFIER, ' ').matchAll(TOKEN)) {
        const citation = asCitation(token);
        if (citation) cited.push({ ...citation, line: index + 1 });
      }
    });
  return cited;
}
