import { describe, expect, it } from 'vitest';
import { checkRunLogRoles } from './run-log-roles.js';
import { buildVerifyResult, resultProblem } from './verify-result.js';

const commit = '0123456789abcdef0123456789abcdef01234567';
const hash = 'd7839d85d1638bc3c6dd13fa26a4d60a56eb7c9dbad65a318e2fd2b0fbb3524c';
function focusedReceipt() {
  return buildVerifyResult({
    commit, cleanTree: true, base: { ref: 'ticket base', commit: 'abcdef0123456789abcdef0123456789abcdef0123' },
    checks: [
      { name: 'test', passed: true, summary: '1 authored test passed.', counts: { files: 1, tests: 1, passed: 1 } },
      { name: 'typecheck', passed: true, summary: 'No type errors.' },
    ],
    scope: { kind: 'focused', selection: {
      path: 'authored-selection.json', hash, ticket: 'Shufflewick/BoardSmith#951',
      base: 'abcdef0123456789abcdef0123456789abcdef0123',
      tests: [{ file: 'tests/authored.test.ts', names: ['doubles the answer'] }],
    } },
  });
}

describe('focused review provenance (#951)', () => {
  it('requires the authored selection hash when a review names a focused verify result', () => {
    const result = focusedReceipt();
    const log = `### Dispatch 1
- Work: build-chunk
- Role: bounded
- Agent: bs-bounded
- Retry of: none
- Outcome: done

### Review Round 1
- Step: audit
- Reviewed: Dispatch 1
- Level: full
- Verify: ${commit} passed
- Agents: bs-review
- Outcome: clean
`;
    const lookup = () => ({ file: `.boardsmith/verify/${commit}.json`, result });
    expect(checkRunLogRoles(log, lookup).map((finding) => finding.detail)).toEqual([
      expect.stringMatching(/Scope: focused.*d7839d85/),
    ]);
    expect(checkRunLogRoles(`${log}- Scope: focused ${hash}\n`, lookup)).toEqual([]);
    expect(checkRunLogRoles(`${log}- Scope: focused ${'0'.repeat(64)}\n`, lookup).map((finding) => finding.detail)).toEqual([
      expect.stringMatching(/scope.*does not match|does not match.*scope/i),
    ]);
    result.checks[0].counts = { files: 0, tests: 0, passed: 0 };
    expect(checkRunLogRoles(`${log}- Scope: focused ${hash}\n`, lookup).map((finding) => finding.detail)).toEqual([
      expect.stringMatching(/authored.*counts|counts.*authored/i),
    ]);
  });

  it('refuses a focused receipt whose passing counts do not account for the declared authored tests', () => {
    const result = focusedReceipt();
    result.checks[0].counts = { files: 0, tests: 0, passed: 0 };
    expect(resultProblem(result, commit)).toEqual(expect.stringMatching(/authored.*counts|counts.*authored/i));
  });
});
