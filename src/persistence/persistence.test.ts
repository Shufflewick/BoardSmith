import { describe, it, expect } from 'vitest';
import { readPersistCommit } from './persistence.js';

describe('#739 -- one commit may write each key at most once per channel', () => {
  it.each(['public', 'private'] as const)('refuses a key named twice on the %s channel, with production\'s message', (channel) => {
    const entries = [
      { key: 'record', value: 1 },
      { key: 'record', value: 2 },
    ];
    expect(readPersistCommit({ [channel]: { entries } })).toEqual({
      kind: 'invalid',
      reason:
        'A single commit names the key "record" twice. One commit may write each key ' +
        'at most once -- merge the two records, or use distinct keys.',
    });
  });
});
