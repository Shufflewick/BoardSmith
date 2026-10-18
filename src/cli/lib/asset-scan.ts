/**
 * Asset-reachability scanner — the single source of truth for ASSET-02's
 * build-blocking gate.
 *
 * It is a file-system-level static scan: it never issues an HTTP request. Vite's
 * SPA fallback serves a 200 for any unmatched path, including missing images, so
 * an HTTP-based "is this asset reachable?" probe would falsely pass every time
 * (Pitfall 2). Instead this scan reads generated UI source directly off disk and
 * flags any bare `<img` tag in a game's own UI source — the coarse, pit-of-success
 * heuristic locked in 152-CONTEXT.md. `AssetImage` lives in `boardsmith/ui`
 * (issue #81), so no path inside a game is exempt: routing art through
 * `<AssetImage>` is the one sanctioned path, and anything else is a FAIL regardless
 * of what `src` resolves to. Today the `/bs:build-chunk` `test` step is the
 * caller (see `src/cli/slash-command/bs/build/test.md`); any future CLI wiring
 * should delegate here too rather than growing a second, subtly different regex
 * scanner — the single-source-of-truth pattern `sandbox-scan.ts` established.
 *
 * Games import it from its own subpath, `boardsmith/asset-scan` (the `exports`
 * entry in package.json), not from `boardsmith/testing`, so the testing barrel
 * stays free of Node types (see `src/testing/index.ts`). If you move or rename
 * this file, update that `exports` entry.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import { parse as parseSfc } from 'vue/compiler-sfc';
import { collectSourceFiles } from './source-files.js';

export interface AssetViolation {
  /** Path relative to the project root. */
  file: string;
  /** Absent when the problem has no line, such as a Vue parser error without a location. */
  line?: number;
  message: string;
}

// A real <img> tag: `<img` followed by whitespace, `/`, or `>` — case-insensitive
// (HTML tag names are). The trailing class excludes kebab-case custom elements
// like `<img-carousel>` (a false positive `\b` would have matched).
const BARE_IMG_TAG = /<img[\s/>]/i;

/** A file's lines with comments blanked, so line numbers and lengths match the original. */
interface StripCommentsResult {
  lines: string[];
  /**
   * WR-01: each block/HTML comment opener never closed by EOF —
   * everything after it was silently blanked (treated as commented-out) and
   * NOT scanned for bare `<img>` tags. `line` is the 1-based line the
   * comment opened on; `kind` distinguishes `/* *\/` from `<!-- -->`.
   */
  unterminated: { line: number; kind: 'block' | 'html' }[];
  /** #1096: what Vue's parser could not read in a `.vue` file, at 1-based lines. */
  parseErrors?: { line?: number; reason: string }[];
}

const blank = (text: string): string => text.replace(/[^\r\n]/g, ' ');

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = { '.tsx': ts.ScriptKind.TSX, '.jsx': ts.ScriptKind.JSX, '.js': ts.ScriptKind.JS, '.mjs': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS };

/**
 * Blank out the comments of a script file (`.ts`, `.tsx`, `.js` and the rest),
 * keeping line count and lengths. The comments come from TypeScript's parser, so
 * comment-looking text inside a template literal, a regex or JSX text is kept
 * and still scanned (#852).
 */
function stripScriptComments(content: string, filePath: string): StripCommentsResult {
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, SCRIPT_KINDS[extname(filePath)] ?? ts.ScriptKind.TS);
  const tokens: ts.Node[] = [];
  // A JSDoc node lies inside its comment, which the token it documents already reports.
  const isJSDoc = (node: ts.Node): boolean => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(source).filter((child) => !isJSDoc(child));
    if (children.length > 0) children.forEach(visit);
    else tokens.push(node);
  };
  visit(source);
  const comments = new Map<number, number>();
  const collect = (ranges: ts.CommentRange[] | undefined): void => { for (const r of ranges ?? []) comments.set(r.pos, r.end); };
  // Leading ranges start after a line break, trailing ones before it; JSX text has no trivia, so a `//` in it is text.
  tokens.forEach((token, i) => {
    if (token.kind === ts.SyntaxKind.JsxText) return;
    collect(ts.getLeadingCommentRanges(content, token.pos));
    if (tokens[i + 1]?.kind !== ts.SyntaxKind.JsxText) collect(ts.getTrailingCommentRanges(content, token.end));
  });

  const parts: string[] = [];
  let cursor = 0;
  const unterminated: StripCommentsResult['unterminated'] = [];
  for (const [start, end] of [...comments].sort((a, b) => a[0] - b[0])) {
    if (end <= cursor) continue;
    const comment = content.slice(start, end);
    parts.push(content.slice(cursor, start), blank(content.slice(Math.max(start, cursor), end)));
    cursor = end;
    if (comment.startsWith('/*') && (comment.length < 4 || !comment.endsWith('*/'))) {
      unterminated.push({ line: source.getLineAndCharacterOfPosition(start).line + 1, kind: 'block' });
    }
  }
  parts.push(content.slice(cursor));
  return { lines: parts.join('').split('\n'), unterminated };
}

/**
 * Blank out the comments of a `.vue` file, keeping line count and lengths. Vue's
 * own parser finds the blocks: each `<script>` goes through `stripScriptComments`
 * like any script file (#1017), `<style>` is blanked whole since CSS cannot render
 * an `<img>`, and the rest is template, where only `<!-- -->` is a comment (F-11).
 */
function stripVueComments(content: string, relPath: string): StripCommentsResult {
  // Vue puts this name in some of its error text, so it is the project path, never the machine one.
  const { descriptor, errors } = parseSfc(content, { filename: relPath });
  const blocks = [descriptor.script, descriptor.scriptSetup, ...descriptor.styles]
    .filter((block) => block !== null)
    .sort((a, b) => a.loc.start.offset - b.loc.start.offset);
  const unterminated: StripCommentsResult['unterminated'] = [];
  const template = (text: string, offset: number): string => text.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment: string, at: number) => {
    if (!comment.endsWith('-->')) unterminated.push({ line: content.slice(0, offset + at).split('\n').length, kind: 'html' });
    return blank(comment);
  });

  let out = '';
  let cursor = 0;
  for (const block of blocks) {
    const { start, end } = block.loc;
    out += template(content.slice(cursor, start.offset), cursor);
    if (block.type === 'style') out += blank(block.content);
    else {
      const script = stripScriptComments(block.content, `${relPath}.${block.lang ?? 'js'}`);
      out += script.lines.join('\n');
      unterminated.push(...script.unterminated.map(({ line, kind }) => ({ line: start.line + line - 1, kind })));
    }
    cursor = end.offset;
  }
  out += template(content.slice(cursor), cursor);
  // An unclosed template comment runs to the end of the file, so Vue's errors are that same cause, already reported.
  const parseErrors = unterminated.some(({ kind }) => kind === 'html') ? [] : errors.map((error) => ({ line: 'loc' in error ? error.loc?.start.line : undefined, reason: error.message }));
  return { lines: out.split('\n'), unterminated, parseErrors };
}

/** The parts of a file the scan could not read, each as a violation: a false PASS otherwise. */
function unscannedParts(relPath: string, { unterminated, parseErrors = [] }: StripCommentsResult): AssetViolation[] {
  const violations: AssetViolation[] = parseErrors.map(({ line, reason }) => ({
    file: relPath,
    line,
    message: `${relPath}${line === undefined ? '' : `:${line}`} could not be read as a Vue file: ${reason} Fix it so Vue can parse the file (close every tag you open, such as <template> or <script>); until then the file is not fully scanned for bare <img> tags.`,
  }));
  // WR-01: a comment that never closes silently blanks everything after it (including any real <img> tags).
  for (const { line, kind } of unterminated) {
    const commentLabel = kind === 'block' ? '/* block' : '<!-- HTML';
    violations.push({
      file: relPath,
      line,
      message: `${relPath}:${line} has an unterminated ${commentLabel} comment that is never closed. Everything after it was NOT scanned for bare <img> tags, so this is a false PASS risk -- close the comment (or remove the stray opener).`,
    });
  }
  return violations;
}

/**
 * Scan `<cwd>/src/ui` for bare `<img` tags.
 * Returns one violation per offending line; an empty array is a PASS.
 */
export function scanAssetReachability(cwd: string): AssetViolation[] {
  const uiDir = join(cwd, 'src', 'ui');
  if (!existsSync(uiDir)) return [];

  const violations: AssetViolation[] = [];

  for (const filePath of collectSourceFiles(uiDir)) {
    const relPath = relative(cwd, filePath);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const stripped = filePath.endsWith('.vue') ? stripVueComments(content, relPath) : stripScriptComments(content, filePath);
    for (let i = 0; i < lines.length; i++) {
      if (BARE_IMG_TAG.test(stripped.lines[i])) {
        violations.push({
          file: relPath,
          line: i + 1,
          message: `${relPath}:${i + 1} uses a bare <img> tag. Route art through \`import { AssetImage } from 'boardsmith/ui'\` instead (<AssetImage :src="..." aspect-ratio="2 / 3" :alt="..."> with your drawn fallback in the slot), so a missing asset falls back cleanly rather than shipping a broken image.`,
        });
      }
    }
    violations.push(...unscannedParts(relPath, stripped));
  }

  return violations;
}
