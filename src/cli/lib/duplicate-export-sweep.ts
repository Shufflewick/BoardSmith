import { sha256Hex } from './hash.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fallowCommandLine, runToolCapturingStdout } from './run-tool.js';

/**
 * THE WHOLE-REPOSITORY SWEEP FOR DUPLICATE EXPORTS (#265).
 *
 * `boardsmith audit` scopes itself to the files a branch changed, and fallow
 * only reports a duplicate export when more than one of the files declaring
 * the name is in that scope. So a duplicate whose two halves live in files
 * that never change together is invisible for as long as that holds. The
 * `ElementRef` triplicate of #263 had been in the tree for as long as its
 * three declarations existed; it surfaced because two unrelated tickets
 * happened to touch two of the three files inside one merge window.
 *
 * ## Why this is not `--backlog`, and not a wider `--since`
 *
 * `boardsmith audit --backlog` already reports the whole repository, but it
 * sets the baselines ASIDE, so it answers "how much accepted debt is there"
 * (hundreds of findings, `docs/fallow-gate.md`) rather than "what is here that
 * nothing has accepted". A latent duplicate is one line in that flood.
 *
 * `boardsmith audit --since <first commit>` does put the whole tree in scope
 * WITH the baselines applied, and it passes today. But it is a GATE: it exits
 * non-zero on findings and it drags the jscpd duplication sweep and the
 * health-baseline drift check along with it, both of which report this repo's
 * accepted backlog over a whole-repository scope. Run on a schedule it would
 * be red forever, which is the failure mode that teaches people to stop
 * reading a gate.
 *
 * So the missing thing is neither a new analysis nor a new scope rule. It is a
 * run that asks fallow the one question whose answer can go latent, applies
 * the baseline the repo already keeps, and FILES rather than blocks.
 *
 * ## Why duplicate exports specifically
 *
 * Every other dead-code category is a property of a single file: an unused
 * export is unused in the file that declares it, so the changed-files audit
 * sees it the moment that file is touched. A duplicate export is the one
 * finding whose identity is a SET of files -- which is also why its baseline
 * key is the name followed by every exporting file, and why a scoped run that
 * sees only some of them produces a subset key that matches nothing
 * (`docs/fallow-gate.md`, "A `duplicate_exports` key can fail while already
 * being baselined").
 *
 * ## Why it never gates
 *
 * Making the whole-repository view blocking would drop the repo's accepted
 * backlog onto whoever merges next, which is exactly what the baselines exist
 * to prevent. A latent duplicate deserves a ticket, not a red board. The one
 * thing that does exit non-zero here is a scan that produced nothing readable,
 * because a broken tool must not be reported as a clean sweep.
 */

/** One duplicate export, as `fallow dead-code --duplicate-exports` reports it. */
export interface DuplicateExportFinding {
  name: string;
  locations: { path: string; line: number }[];
}

/** An issue that already exists for a finding. */
export interface FiledIssue {
  number: number;
  state: string;
}

/** The issue tracker the sweep files into. Injected so the logic is testable. */
export interface IssueTracker {
  /** The issue carrying this fingerprint, open or closed, if there is one. */
  find: (fingerprint: string) => Promise<FiledIssue | undefined>;
  /** Open an issue and answer with its number. */
  create: (title: string, body: string) => Promise<number>;
}

/** One whole-repository, baseline-aware duplicate-export scan. Injected in tests. */
type ScanDuplicateExports = (cwd: string) => Promise<{ code: number; stdout: string }>;

/** The dead-code baseline `.fallowrc.json` names, which this sweep subtracts. */
const DEAD_CODE_BASELINE_FILE = '.fallow-dead-code-baseline.json';

/**
 * Marks a fingerprint in an issue body. Deliberately one lowercase
 * alphanumeric token: GitHub's issue search splits on punctuation, so a key
 * spelled with `|` or `-` could not be searched for exactly.
 */
export const SWEEP_FINGERPRINT_PREFIX = 'bsdupexport';

const scanWithFallow: ScanDuplicateExports = (cwd) =>
  runToolCapturingStdout(
    'fallow',
    [
      '--baseline',
      DEAD_CODE_BASELINE_FILE,
      '--format',
      'json',
      '--quiet',
      'dead-code',
      '--duplicate-exports',
    ],
    { cwd },
  );

/**
 * The key `.fallow-dead-code-baseline.json` records this finding under: the
 * exported name followed by every file that exports it, sorted.
 *
 * Reported verbatim so the thing a human needs in order to ACCEPT a finding is
 * the thing the sweep already printed. A second vocabulary for the same debt
 * would mean translating by hand, every time.
 */
export function baselineKey(finding: DuplicateExportFinding): string {
  const files = [...new Set(finding.locations.map((location) => location.path))].sort();
  return [finding.name, ...files].join('|');
}

/**
 * A searchable identity for one finding.
 *
 * Hashed from the baseline key, so it follows the debt rather than the lines
 * it sits on: code moving above a declaration does not change it, and a third
 * file starting to export the name does.
 */
export function fingerprintOf(key: string): string {
  return SWEEP_FINGERPRINT_PREFIX + sha256Hex(key).slice(0, 16);
}

/** `path:line` for every declaration, in the order fallow reported them. */
const describeLocations = (finding: DuplicateExportFinding): string[] =>
  finding.locations.map((location) => `${location.path}:${location.line}`);

function parseFindings(stdout: string): DuplicateExportFinding[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const raw = (parsed as { duplicate_exports?: unknown } | null)?.duplicate_exports;
  if (!Array.isArray(raw)) return undefined;

  const findings: DuplicateExportFinding[] = [];
  for (const entry of raw as {
    export_name?: unknown;
    locations?: { path?: unknown; line?: unknown }[];
  }[]) {
    if (typeof entry.export_name !== 'string' || !Array.isArray(entry.locations)) return undefined;
    const locations = entry.locations.map((location) => ({
      path: String(location.path),
      line: Number(location.line),
    }));
    findings.push({ name: entry.export_name, locations });
  }
  return findings;
}

/** The title of the issue one finding gets. */
export function issueTitle(finding: DuplicateExportFinding): string {
  const files = [...new Set(finding.locations.map((location) => location.path))];
  return `${finding.name} is exported from ${files.length} files, so an importer cannot tell which one it got`;
}

/** The body of the issue one finding gets: what, where, why, and both ways out. */
export function issueBody(finding: DuplicateExportFinding): string {
  const key = baselineKey(finding);
  return [
    `\`${finding.name}\` is declared and exported in more than one place, so two importers of `
    + 'the same name can be holding two different types. Barrel re-exports resolve ambiguously '
    + 'and nothing tells a consumer which declaration it reached.',
    '',
    '## Where',
    '',
    ...describeLocations(finding).map((location) => `- \`${location}\``),
    '',
    '## How it was found',
    '',
    '`boardsmith audit --sweep`, the periodic whole-repository run added for #265. The '
    + 'changed-files audit cannot see this pair: it reports a duplicate export only when more '
    + 'than one of the declaring files is in the diff being audited, and these need never '
    + 'change together.',
    '',
    '## What to do',
    '',
    'Either give the name a single declaration and have the other modules import it, or record '
    + `the duplication as accepted by adding this key to \`duplicate_exports\` in `
    + `\`${DEAD_CODE_BASELINE_FILE}\`:`,
    '',
    '```',
    key,
    '```',
    '',
    'The second is the right answer when the two declarations are deliberately different; '
    + '`docs/fallow-gate.md` says what accepting debt does and does not mean.',
    '',
    `<!-- ${fingerprintOf(key)} -->`,
  ].join('\n');
}

/** What the sweep decided about one finding. */
async function fileFinding(
  finding: DuplicateExportFinding,
  tracker: IssueTracker | undefined,
): Promise<string> {
  const key = baselineKey(finding);
  const detail = [
    `  ${finding.name}`,
    ...describeLocations(finding).map((location) => `    ${location}`),
    `    accept it with: ${key}`,
  ].join('\n');

  if (!tracker) {
    return `${detail}\n    not filed — run with --file-issue to open a ticket for this`;
  }

  const existing = await tracker.find(fingerprintOf(key));
  if (existing) {
    const state = existing.state.toLowerCase();
    return state === 'open'
      ? `${detail}\n    already filed as #${existing.number}, still open`
      : `${detail}\n    already filed as #${existing.number}, and closed — nothing re-filed. `
        + 'Fix it, or accept it with the key above, or it will be reported again next sweep.';
  }

  const number = await tracker.create(issueTitle(finding), issueBody(finding));
  return `${detail}\n    filed as #${number}`;
}

/**
 * Sweep the whole repository for duplicate exports the dead-code baseline does
 * not already accept, and report (or file) what is left.
 */
export async function sweepDuplicateExports(
  cwd: string,
  options: { scan?: ScanDuplicateExports; tracker?: IssueTracker } = {},
): Promise<{ code: number; report: string }> {
  const scan = options.scan ?? scanWithFallow;
  const { code, stdout } = await scan(cwd);
  const findings = parseFindings(stdout);

  if (!findings) {
    return {
      code: 1,
      report:
        `\`fallow dead-code --duplicate-exports\` exited ${code} without a readable report, so `
        + 'the whole repository was NOT swept.\n'
        + `Run \`${fallowCommandLine(['--baseline', DEAD_CODE_BASELINE_FILE, 'dead-code', '--duplicate-exports'], cwd)}\` `
        + 'here to see what it says.',
    };
  }

  if (findings.length === 0) {
    return {
      code: 0,
      report:
        'Swept the whole repository: no duplicate exports beyond the ones '
        + `${DEAD_CODE_BASELINE_FILE} already accepts.`,
    };
  }

  const lines: string[] = [];
  for (const finding of findings) lines.push(await fileFinding(finding, options.tracker));

  const count = findings.length;
  return {
    code: 0,
    report:
      `Swept the whole repository: ${count} duplicate export${count === 1 ? '' : 's'} nothing has `
      + 'accepted. One name, more than one declaration, so an importer cannot tell which it got.\n\n'
      + `${lines.join('\n\n')}\n\n`
      + 'This is a report, not a verdict on your change. Nothing here blocks a merge.',
  };
}

const execFileAsync = promisify(execFile);

/**
 * The GitHub issue tracker, through the `gh` CLI.
 *
 * Spawned directly rather than through `runTool`, which runs only the tools
 * boardsmith pins or a workspace's own `node_modules/.bin`: `gh` is a system
 * binary, found on PATH.
 *
 * `find` searches BOTH open and closed issues. A closed issue is a human's
 * ruling on this exact finding, and re-filing it every run is the auto-filer
 * that spams; the sweep still reports the finding, it just does not open a
 * second ticket for it.
 */
export function githubIssueTracker(cwd: string): IssueTracker {
  const gh = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('gh', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      throw new Error(
        `Could not run \`gh ${args.join(' ')}\`: ${(error as Error).message}\n`
        + 'Install the GitHub CLI and sign in with `gh auth login`, or run '
        + '`boardsmith audit --sweep` without --file-issue to just read the findings.',
      );
    }
  };

  return {
    find: async (fingerprint) => {
      const stdout = await gh([
        'issue',
        'list',
        '--state',
        'all',
        '--search',
        `${fingerprint} in:body`,
        '--json',
        'number,state',
        '--limit',
        '1',
      ]);
      const [issue] = JSON.parse(stdout) as FiledIssue[];
      return issue;
    },
    create: async (title, body) => {
      const stdout = await gh(['issue', 'create', '--title', title, '--body', body]);
      const number = /\/issues\/(\d+)/.exec(stdout.trim())?.[1];
      if (!number) {
        throw new Error(
          `\`gh issue create\` did not report an issue number. It printed: ${stdout.trim()}`,
        );
      }
      return Number(number);
    },
  };
}
