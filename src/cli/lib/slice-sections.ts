/**
 * THE SECTIONS OF A RULEBOOK SLICE (#415): the unit two chunks can conflict over.
 *
 * A slice (`design/rulebook/<file>.md`) often holds several unrelated rules. A designer-decisions
 * page is the extreme case: board geometry, economy and towers on one page, each cited by a
 * different chunk. So `boardsmith parallel-check` and `boardsmith chunk-merge` compare the
 * sections chunks cite, not whole slices.
 *
 * A slice is divided, top to bottom, into sections. A new section starts at:
 *
 *   - a Markdown heading (`## Towers`), named by its text (`Towers`), the same heading
 *     `claim-quote-check` reads a `§"<heading>"` location by; or
 *   - a transcription citation prefix (`p.2, Designer Decisions > Battlefield:`, see
 *     `ingest/transcription-subagent.md`), named by what sits between the page and the colon
 *     (`Designer Decisions > Battlefield`), unless the section in force already has that name, so a
 *     run of quote lines that each carry the same prefix is one section. A prefix line that ends
 *     with a colon is named up to that last colon (`p.2, JAB (TIMING: 1), italic:`); a prefix with
 *     quote text after it is named up to its first `: `.
 *
 * A section runs to the line before the next one starts. Lines above the first heading or prefix
 * form a section with an empty name.
 *
 * A citation names sections by `§"<name>"`: a prefix name names every section with that name, and a
 * heading names its own section and every section under it, down to the next heading of the same or
 * higher level (the span `claim-quote-check` reads).
 */

import { fileLines } from './line-location.js';

export interface SliceSection {
  name: string;
  /** First line, 1-based. */
  from: number;
  /** Last line, 1-based, inclusive. */
  to: number;
  /** The heading's level (1 for `#`), for a section a heading starts. */
  headingLevel?: number;
}

const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** A Markdown heading line's level and text, the one heading rule `claim-quote-check` shares. */
export function markdownHeading(line: string): { level: number; text: string } | undefined {
  const m = HEADING_LINE.exec(line);
  return m ? { level: m[1].length, text: m[2] } : undefined;
}

const CITATION_PREFIX = /^p\.\d+(?:\s*\([^)]*\))?,\s+(.+)$/;

/** The section name a citation-prefix line carries, or `undefined` for any other line. */
function prefixName(line: string): string | undefined {
  const m = CITATION_PREFIX.exec(line.trimEnd());
  if (!m) return undefined;
  const rest = m[1];
  if (rest.endsWith(':')) return rest.slice(0, -1).trim();
  const colon = rest.indexOf(': ');
  return colon === -1 ? undefined : rest.slice(0, colon).trim();
}

/** The slice's sections, in order, covering every line exactly once. */
export function sliceSections(text: string): SliceSection[] {
  const lines = fileLines(text);
  const sections: SliceSection[] = [];
  let current: SliceSection | undefined;
  const start = (section: SliceSection) => {
    sections.push(section);
    current = section;
  };
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const heading = markdownHeading(line);
    const prefix = heading ? undefined : prefixName(line);
    if (heading) {
      start({ name: heading.text, from: lineNo, to: lineNo, headingLevel: heading.level });
    } else if (prefix !== undefined && (current === undefined || current.headingLevel !== undefined || current.name !== prefix)) {
      start({ name: prefix, from: lineNo, to: lineNo });
    } else if (current === undefined) {
      start({ name: '', from: lineNo, to: lineNo });
    } else {
      current.to = lineNo;
    }
  });
  return sections;
}

/** The sections a `§"<name>"` citation names; `[]` when the slice has no section by that name. */
export function sectionsNamed(sections: readonly SliceSection[], name: string): SliceSection[] {
  const named = new Set<SliceSection>();
  sections.forEach((section, index) => {
    if (section.name !== name) return;
    named.add(section);
    if (section.headingLevel === undefined) return;
    for (const below of sections.slice(index + 1)) {
      if (below.headingLevel !== undefined && below.headingLevel <= section.headingLevel) break;
      named.add(below);
    }
  });
  return sections.filter((s) => named.has(s));
}

/** The sections holding any of lines `from` to `to`. */
export function sectionsHolding(sections: readonly SliceSection[], from: number, to: number): SliceSection[] {
  return sections.filter((s) => s.from <= to && s.to >= from);
}
