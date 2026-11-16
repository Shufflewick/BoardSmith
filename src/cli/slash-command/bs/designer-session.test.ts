/**
 * The designer's session writes no file (#1674).
 *
 * The session the designer talks to only coordinates: it holds the conversation, runs commands,
 * dispatches, relays, and reads returns. Every file a step used to have it write is a `record`
 * dispatch. routing.md owns the rule; this file pins that it says so and that every step which
 * used to write in the designer's session now hands the write to an agent.
 */
import { describe, expect, it } from 'vitest';
import { SKILL_NAMES } from '../../commands/install-claude-command.js';
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

const ENTRY_POINTS = SKILL_NAMES.map((name) => `${name.replace(/^bs-/, '')}.md`);

/** The one line each entry point carries, pointing at the rule instead of restating it. */
const POINTER =
  "In the designer's session nothing is written by hand: " +
  '`${CLAUDE_SKILL_DIR}/../bs-shared/routing.md` "The Designer\'s Session Writes No File".';

describe("the designer's session writes no file (#1674)", () => {
  it('routing.md owns the rule: coordinate only, and every write is a record dispatch at the role its content needs', () => {
    const rule = section(read('routing.md'), "The Designer's Session Writes No File");
    expect(rule).not.toBe('');
    expect(rule).toMatch(/never writes, creates, copies or edits a file with its own tools/);
    expect(rule).toMatch(/`judgement` role's agent, `Work: record <what>`/);
    expect(rule).toMatch(/`mechanical` role's agent, `Work: record <what>`/);
    expect(rule).toMatch(/records its own dispatch in the run log/);
    expect(rule).toMatch(/the session never patches it/);
  });

  it('every entry point points at the rule in its Model Routing section', () => {
    for (const file of ENTRY_POINTS) {
      expect(section(read(file), 'Model Routing'), file).toContain(POINTER);
    }
  });

  it('ingest: the interview slices, the synthesis and the approved sketch are each written by a record dispatch', () => {
    const ingest = read('ingest-rules.md');
    expect(flat(ingest)).not.toMatch(/by this session from the designer's short answers/);
    says(section(ingest, 'Step 2: Route'), '`record interview slices`', '`judgement` role');
    says(section(ingest, 'Step 3: Synthesis'), '`Work: record synthesis`', '`judgement` role');
    says(section(ingest, 'Step 7: Write Files'), '`Work: record sketch`', '`judgement` role');
    says(section(ingest, 'Step 0: State Detection'), '`Work: record migrated slices`', '`judgement` role');
    says(section(read('ingest/interview-fallback.md'), 'Output Re-Target'), '`Work: record interview slices`', '`judgement` role');
  });

  it('the design session dispatches its sign-off writes', () => {
    const signOff = section(read('ingest/design-session.md'), 'Sign-Off (Gate-Before-Write)');
    says(signOff, '`Work: record design sign-off`', '`judgement` role');
  });

  it('build-game hands every journal, ledger and lock write to a record dispatch', () => {
    const game = read('build-game.md');
    says(section(game, 'Every Write Is a Record'), '`mechanical` role', '`judgement` role', 'the lock');
    says(section(game, 'Step 3: The Chunk Loop'), '`Work: record dispatch`', '`mechanical` role');
    says(section(game, 'Step 4: Routing a Return'), '`record gate`', '`judgement` role');
    says(section(read('orchestrate/run-state.md'), 'Writing It'), 'The orchestrator makes none of these writes itself');
    says(section(read('orchestrate/questions.md'), 'Who Writes What, Under an Orchestrated Run'), 'It writes nothing itself', '`record gate`');
  });

  it('a skill the designer types that would write in their session hands the work to an agent instead', () => {
    says(section(read('build-chunk.md'), 'Typed by the Designer'), 'builds nothing itself', 'bs-build-game/SKILL.md', '`judgement` role', 'bs-check-status/SKILL.md', 'bs-insert-chunk/SKILL.md');
    says(section(read('build-bot.md'), 'Typed by the Designer'), 'dispatches the writing', '`judgement` role');
    const reshape = read('insert-chunk.md');
    expect(flat(reshape)).not.toMatch(/it never dispatches subagents to do this work/);
    says(section(reshape, 'Typed by the Designer'), 'makes the writes', '`judgement` role');
    says(section(read('build-game.md'), 'Step 2: Confirm the Run'), 'the run is that one chunk', 'never built here');
    expect(flat(read('ingest/transcription.md'))).not.toMatch(/may transcribe inline/);
  });
});
