import { describe, it, expect } from 'vitest';
import { generateAICode, type CodeGeneratorOptions } from './code-generator.js';
import type { TrainingResult } from './types.js';

/**
 * Regression test for F27: the AI code generator must emit valid `boardsmith`
 * subpath imports, not the nonexistent `@boardsmith/*` scope. Generated ai.ts
 * files import these directly, so a wrong scope produces files that will not
 * resolve or compile.
 */
function makeResult(): TrainingResult {
  return {
    objectives: [
      {
        featureId: 'f1',
        description: 'example objective',
        weight: 1,
        checkerCode: 'return 0;',
        correlation: 0.5,
      },
    ],
    actionPreferences: [],
    featureStats: [],
    actionStats: [],
    metadata: {
      gamesPlayed: 1,
      gamesCompleted: 1,
      totalStates: 1,
      candidateFeaturesGenerated: 1,
      featuresSelected: 1,
      iterations: 1,
      finalWinRate: 0.5,
    },
  };
}

describe('generateAICode import paths (F27)', () => {
  const options: CodeGeneratorOptions = {
    gameClassName: 'GoFishGame',
    includeMetadata: false,
    includeActionHints: false,
  };

  it('emits the published boardsmith package paths', () => {
    const code = generateAICode(makeResult(), options);
    expect(code).toContain(`import type { Game } from 'boardsmith';`);
    expect(code).toContain(`import type { Objective } from 'boardsmith/ai';`);
  });

  it('never emits the nonexistent @boardsmith/* scope', () => {
    const code = generateAICode(makeResult(), options);
    expect(code).not.toContain('@boardsmith/');
  });
});
