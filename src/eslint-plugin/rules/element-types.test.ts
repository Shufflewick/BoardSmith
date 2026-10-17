import { describe, expect, it } from 'vitest';
import * as engine from '../../engine/index.js';
import { ENGINE_ELEMENT_CLASS_NAMES } from './element-types.js';

describe('ENGINE_ELEMENT_CLASS_NAMES', () => {
  it('names exactly the GameElement classes the engine exports (#872)', () => {
    const exported = Object.entries(engine)
      .filter(([, value]) => value === engine.GameElement
        || (typeof value === 'function' && value.prototype instanceof engine.GameElement))
      .map(([name]) => name);
    expect([...ENGINE_ELEMENT_CLASS_NAMES].sort()).toEqual(exported.sort());
  });
});
