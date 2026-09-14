import { describe, it, expect } from 'vitest';
import {
  SWEEP_FINGERPRINT_PREFIX,
  baselineKey,
  fingerprintOf,
  issueBody,
  issueTitle,
  sweepDuplicateExports,
  type DuplicateExportFinding,
  type FiledIssue,
  type IssueTracker,
} from './duplicate-export-sweep.js';

/** One finding as `fallow dead-code --duplicate-exports --format json` reports it. */
const elementRef: DuplicateExportFinding = {
  name: 'ElementRef',
  locations: [
    { path: 'src/types/protocol.ts', line: 534 },
    { path: 'src/ui/composables/useBoardInteraction.ts', line: 19 },
  ],
};

/** A whole-repository scan reporting exactly these findings. */
const scanReporting = (findings: DuplicateExportFinding[]) => async () => ({
  code: findings.length === 0 ? 0 : 1,
  stdout: JSON.stringify({
    duplicate_exports: findings.map((finding) => ({
      export_name: finding.name,
      locations: finding.locations.map((location) => ({ ...location, col: 17 })),
    })),
  }),
});

/** A tracker that remembers what it was asked to file. */
function recordingTracker(existing: Record<string, FiledIssue> = {}) {
  const created: { title: string; body: string }[] = [];
  const tracker: IssueTracker = {
    find: async (fingerprint) => existing[fingerprint],
    create: async (title, body) => {
      created.push({ title, body });
      return 900 + created.length;
    },
  };
  return { tracker, created };
}

describe('baselineKey', () => {
  /**
   * The fingerprint a human needs in order to ACCEPT a finding is the key
   * `.fallow-dead-code-baseline.json` already uses, so the sweep reports that
   * key verbatim rather than inventing a second vocabulary for the same debt.
   */
  it('is the name followed by every exporting file, sorted', () => {
    expect(baselineKey(elementRef)).toBe(
      'ElementRef|src/types/protocol.ts|src/ui/composables/useBoardInteraction.ts',
    );
  });

  it('names a file once however many times it exports the name', () => {
    expect(
      baselineKey({
        name: 'Player',
        locations: [
          { path: 'src/ui/types.ts', line: 158 },
          { path: 'src/engine/player/player.ts', line: 98 },
          { path: 'src/ui/types.ts', line: 402 },
        ],
      }),
    ).toBe('Player|src/engine/player/player.ts|src/ui/types.ts');
  });
});

describe('fingerprintOf', () => {
  it('is one searchable token, so an issue body can be found by it', () => {
    const fingerprint = fingerprintOf(baselineKey(elementRef));
    expect(fingerprint.startsWith(SWEEP_FINGERPRINT_PREFIX)).toBe(true);
    expect(fingerprint).toMatch(/^[a-z0-9]+$/);
  });

  it('follows the debt rather than the lines it sits on', () => {
    const moved: DuplicateExportFinding = {
      name: 'ElementRef',
      locations: [
        { path: 'src/types/protocol.ts', line: 991 },
        { path: 'src/ui/composables/useBoardInteraction.ts', line: 4 },
      ],
    };
    expect(fingerprintOf(baselineKey(moved))).toBe(fingerprintOf(baselineKey(elementRef)));
  });

  it('changes when a third file starts exporting the name', () => {
    const wider: DuplicateExportFinding = {
      name: 'ElementRef',
      locations: [...elementRef.locations, { path: 'src/engine/tutorial/types.ts', line: 12 }],
    };
    expect(fingerprintOf(baselineKey(wider))).not.toBe(fingerprintOf(baselineKey(elementRef)));
  });
});

describe('sweepDuplicateExports', () => {
  it('reports a clean sweep when the baseline already accepts everything', async () => {
    const result = await sweepDuplicateExports('/repo', { scan: scanReporting([]) });
    expect(result.code).toBe(0);
    expect(result.report).toContain('whole repository');
    expect(result.report).toMatch(/no duplicate export/i);
  });

  /**
   * The whole point of #265: a whole-repository view that FILES rather than
   * gates. Making it blocking would drop the repo's accepted backlog onto
   * whoever merges next, which is what the baselines exist to prevent.
   */
  it('exits 0 even when it finds something, because it is not a gate', async () => {
    const result = await sweepDuplicateExports('/repo', { scan: scanReporting([elementRef]) });
    expect(result.code).toBe(0);
  });

  it('names the export, every file and line, and why it matters', async () => {
    const { report } = await sweepDuplicateExports('/repo', { scan: scanReporting([elementRef]) });
    expect(report).toContain('ElementRef');
    expect(report).toContain('src/types/protocol.ts:534');
    expect(report).toContain('src/ui/composables/useBoardInteraction.ts:19');
    expect(report).toContain(baselineKey(elementRef));
  });

  it('says how to file when no tracker was asked for', async () => {
    const { report } = await sweepDuplicateExports('/repo', { scan: scanReporting([elementRef]) });
    expect(report).toContain('--file-issue');
  });

  it('exits non-zero when the scan produced no readable report, so a broken tool is not a clean sweep', async () => {
    const result = await sweepDuplicateExports('/repo', {
      scan: async () => ({ code: 2, stdout: 'not json' }),
    });
    expect(result.code).not.toBe(0);
    expect(result.report).toContain('fallow dead-code');
  });

  describe('filing', () => {
    it('opens one issue per finding, carrying the fingerprint that identifies it', async () => {
      const { tracker, created } = recordingTracker();
      const { report } = await sweepDuplicateExports('/repo', {
        scan: scanReporting([elementRef]),
        tracker,
      });

      expect(created).toHaveLength(1);
      expect(created[0]!.title).toContain('ElementRef');
      expect(created[0]!.body).toContain(fingerprintOf(baselineKey(elementRef)));
      expect(report).toContain('#901');
    });

    /** Sweep the ElementRef finding against a tracker that already knows it. */
    const sweepAlreadyFiled = async (existing: FiledIssue) => {
      const { tracker, created } = recordingTracker({
        [fingerprintOf(baselineKey(elementRef))]: existing,
      });
      const { report } = await sweepDuplicateExports('/repo', {
        scan: scanReporting([elementRef]),
        tracker,
      });
      return { report, created };
    };

    it('files nothing a second time for a finding that is already filed', async () => {
      const { report, created } = await sweepAlreadyFiled({ number: 265, state: 'OPEN' });
      expect(created).toEqual([]);
      expect(report).toContain('#265');
    });

    /**
     * A CLOSED issue is a human's ruling on this exact finding. Re-filing it
     * every run would make the sweep an auto-filer that spams, which is worse
     * than no auto-filer: the way to stop a finding recurring is to fix it or
     * to record it in the dead-code baseline, and the report still names it
     * either way.
     */
    it('does not re-file a finding whose issue a human already closed', async () => {
      const { report, created } = await sweepAlreadyFiled({ number: 263, state: 'CLOSED' });
      expect(created).toEqual([]);
      expect(report).toContain('#263');
      expect(report).toContain('closed');
    });

    it('still reports a finding it did not need to file', async () => {
      const { report } = await sweepAlreadyFiled({ number: 265, state: 'OPEN' });
      expect(report).toContain('src/types/protocol.ts:534');
    });
  });
});

describe('the issue it files', () => {
  it('is titled by the export and the barrels it comes from', () => {
    expect(issueTitle(elementRef)).toContain('ElementRef');
  });

  it('says which files declare it, why ambiguity matters, and both ways to close it out', () => {
    const body = issueBody(elementRef);
    expect(body).toContain('src/types/protocol.ts:534');
    expect(body).toContain('src/ui/composables/useBoardInteraction.ts:19');
    expect(body).toContain('.fallow-dead-code-baseline.json');
    expect(body).toContain(baselineKey(elementRef));
    expect(body).toContain(fingerprintOf(baselineKey(elementRef)));
  });
});
