/**
 * Every piece of a bs-built game's work lands on `main` through the repository's merge (#1675).
 *
 * The skills used to say nothing about branches, so a session that may not commit on `main` put
 * the whole kickoff on one `ingest-rules` branch and went on building on top of it, unmerged.
 * state-machine.md "Branches and Landing" owns the rule: one plain branch per piece of work, made
 * from `main`, landed with `agent-policy merge` by the agent that writes its last record, before
 * the next piece starts. This file pins that rule and that each point where a piece ends cites it.
 */
import { describe, expect, it } from 'vitest';
import { skillMarkdown } from '../skill-markdown.test-helper.js';

const read = (file: string) => skillMarkdown(`bs/${file}`);
const flat = (text: string) => text.split(/\s+/).join(' ');

/** The body of the heading that starts with `heading` (any level), up to the next heading of that level or higher. */
function section(text: string, heading: string): string {
  const match = new RegExp(`^(#+) ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').exec(text);
  if (!match) return '';
  const rest = text.slice(match.index + match[0].length);
  const next = new RegExp(`^#{1,${match[1].length}} `, 'm').exec(rest);
  return flat(match[0] + (next ? rest.slice(0, next.index) : rest));
}

/** Asserts `text` contains every one of `parts`. */
function says(text: string, ...parts: string[]): void {
  for (const part of parts) expect(text).toContain(part);
}

const RULE = '"Branches and Landing"';

describe('every piece of work lands on main through the merge (#1675)', () => {
  const rule = section(read('state-machine.md'), 'Branches and Landing');

  it('state-machine.md owns the rule: a branch per piece, made from main, landed before the next', () => {
    expect(rule).not.toBe('');
    says(
      rule,
      'No step commits on `main`',
      '`git switch -c <branch> main`',
      '`agent-policy verify`',
      '`agent-policy merge --summary',
      'lands before the next piece of work starts',
    );
  });

  it('names a branch and a landing point for every piece of work', () => {
    for (const branch of ['`ingest-rules`', '`design-session`', '`chunk-<slug>`', '`batch-<slug>`', '`insert-chunk-<slug>`', '`verify-game`']) {
      expect(rule).toContain(branch);
    }
  });

  it('the agent that writes the last record lands it, and a refusal goes back, never around', () => {
    says(rule, 'the agent that writes its last record lands it', '`--approve <code>`', 'the designer');
    expect(rule).toMatch(/never merges a branch by hand/);
  });

  it('a chunk parked at a question while others build lands as it stands', () => {
    says(rule, 'parked', 'lands as it stands');
  });

  it('a chunk of a batch parked at a question leaves the batch, so the batch still lands', () => {
    says(rule, 'leaves the batch', 'a batch of one');
  });

  it('build-game makes the next piece\'s branch before its entry checks record or commit anything', () => {
    says(section(read('build-game.md'), 'Step 0: Entry'), 'if `main` is checked out, make the branch', '`git branch -m`', RULE);
    says(section(read('build-game.md'), 'Step 6: The bot Opponent'), '`insert-chunk-<slug>` branch', RULE);
  });

  it('kickoff checks the merge can land: a `main` branch, and an `origin` to push it to', () => {
    says(section(read('ingest-rules.md'), 'Step 1: Scaffold + Verify'), "the repository's main branch to be `main`", '`git remote add origin <url>`');
  });

  it('routing.md tells a record which branch it commits on', () => {
    says(section(read('routing.md'), "The Designer's Session Writes No File"), RULE);
  });

  it('each point where a piece of work starts or ends cites the rule', () => {
    says(section(read('ingest-rules.md'), 'Step 1: Scaffold + Verify'), '`ingest-rules`', RULE);
    says(section(read('ingest-rules.md'), 'Step 7: Write Files'), 'lands the `ingest-rules` branch', RULE);
    says(section(read('ingest/design-session.md'), 'Sign-Off (Gate-Before-Write)'), 'lands the `design-session` branch', RULE);
    says(section(read('build-game.md'), 'Step 3: The Chunk Loop'), '`chunk-<slug>`', RULE);
    says(section(read('build-game.md'), 'Step 4: Routing a Return'), 'lands the chunk', RULE);
    says(section(read('verify-game.md'), 'Step 0: State Detection'), '`git switch -c verify-game main`', RULE);
    says(section(read('orchestrate/chunk-dispatch.md'), 'How a Parallel Batch Runs'), '`batch-<slug>`', RULE);
    says(section(read('insert-chunk.md'), 'Typed by the Designer'), '`insert-chunk-<slug>`', RULE);
    says(section(read('verify-game.md'), 'Step 9: Close'), "lands the pass's branch", RULE);
  });
});
