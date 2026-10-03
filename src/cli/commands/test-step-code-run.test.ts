import { describe, it, expect } from 'vitest';
import { mockedModules } from './test-step-code-run.js';

/** A project of `files`, read the way test-step-check reads one. */
const projectOf = (files: Record<string, string>) => ({ text: (path: string) => files[path] });

/**
 * #485: a test that pins earlier behaviour is mutation-tested on the game code it runs. A module it
 * mocks is not that code, so the check leaves it out.
 */
describe('mockedModules', () => {
  it('names every project module the test mocks, however it mocks it', () => {
    const test = `import { vi } from 'vitest';
vi.mock('../src/rules/a', { spy: true });
vi.mock('../src/rules/b');
vi.mock('../src/rules/c.js', () => ({ c: 1 }));
vi.doMock('../src/ui/Board.vue');
vi.mock('boardsmith/testing');
await vi.importActual('../src/rules/d');
`;
    const project = projectOf({
      'tests/pin.test.ts': test,
      'src/rules/a.ts': '', 'src/rules/b.ts': '', 'src/rules/c.ts': '', 'src/rules/d.ts': '', 'src/ui/Board.vue': '',
    });
    expect(mockedModules(test, 'tests/pin.test.ts', project)).toEqual(['src/rules/a.ts', 'src/rules/b.ts', 'src/rules/c.ts', 'src/ui/Board.vue']);
  });
});
