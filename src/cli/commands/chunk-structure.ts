/**
 * What makes a CHUNK.md ambiguous to an edit that changes the first match of a heading or a
 * checklist line (#1784): a section written twice, or a heading or checklist line inside an HTML
 * comment, where every reader skips it. Either way the edit can land on a copy no reader sees.
 */
import { lineOf, markdownCitable, markdownComments } from '../lib/ledger-entries.js';

/** The level-2 headings of a CHUNK.md, in order: CHUNK.template.md ships exactly these. */
export const CHUNK_HEADINGS = [
  '## ui:',
  '## Ceremony',
  '## Step Checklist',
  '## Interpretation',
  '## Visibility Declaration',
  '## Newly Discovered Citations',
  '## Redteam Rounds',
  '## Constraints Review',
  '## Findings Ledger',
  '## Revision Rounds',
  '## Spec Manifest',
  '## Build Manifest',
  '## Playtest Test Script',
  '## Verified Checklist',
  '## Sign-off',
  '## Verified Commit Hash',
  '## Verified Against',
  '## Rules Staleness',
] as const;

const HEADING_OR_CHECKBOX = /^[ \t]*(?:<!--)?[ \t]*(?:#{2,6}[ \t]|[-*+][ \t]+\[[ xX]\])/;

/** One sentence per problem, each naming the line it is on. Empty when the file is unambiguous. */
export function chunkStructureProblems(chunkText: string): string[] {
  const problems: string[] = [];

  const visibleLines = markdownCitable(chunkText).text.split('\n');
  for (const heading of CHUNK_HEADINGS) {
    const lines = visibleLines.flatMap((line, i) => (line.trimEnd() === heading ? [i + 1] : []));
    if (lines.length > 1) {
      problems.push(
        `"${heading}" appears ${lines.length} times, on lines ${lines.join(', ')}. A CHUNK.md has each ` +
          'section once: keep the current copy, move anything only another copy holds into it, and delete the rest.',
      );
    }
  }

  for (const comment of markdownComments(chunkText)) {
    const firstLine = lineOf(chunkText, comment.index);
    comment.text.split('\n').forEach((line, i) => {
      if (!HEADING_OR_CHECKBOX.test(line)) return;
      problems.push(
        `Line ${firstLine + i} is a heading or checklist line inside an HTML comment, where no reader sees it: ` +
          `"${line.trim()}". Move it out of the comment into its section, or delete it.`,
      );
    });
  }

  return problems;
}
