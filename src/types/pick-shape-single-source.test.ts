/**
 * THE PICK SHAPE IS DECLARED EXACTLY ONCE (#251).
 *
 * `PickMetadata` and the shapes around it used to be declared three times — here
 * in `protocol.ts`, again in `session/types.ts`, and again in
 * `ui/composables/useActionControllerTypes.ts`. Nothing tied the copies
 * together, so a new pick field was three edits with nothing forcing the third:
 * #249's `orderedList` had to be added to all three, and the leftover
 * divergence was reported by `boardsmith audit` as a 79-line clone group
 * against whoever touched a pick field next.
 *
 * A copy is easy to write and invisible once written, so the gate is here rather
 * than in review. A layer that genuinely needs more than the wire shape says so
 * by EXTENDING it (`interface ValidElement extends WireValidElement`, which is
 * how the UI adds its enriched `element`) or by binding its type parameter
 * (`type PickMetadata = WirePickMetadata<ValidElement>`). Both keep one
 * declaration of every field; a bare `interface PickMetadata { ... }` somewhere
 * else does not, and that is what this refuses.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const OWNER = path.join(SRC, 'types', 'protocol.ts');

/** The shapes that make up a pick, all owned by `types/protocol.ts`. */
const PICK_SHAPE = [
  'PickMetadata',
  'ActionMetadata',
  'PickChoicesResponse',
  'ChoiceWithRefs',
  'PickFilter',
] as const;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|vue)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * A fresh declaration of `name`'s own body — `interface name {` with no
 * `extends`. An `interface X extends Wire {}` is an extension of the one
 * declaration, not a second one, so it is deliberately not matched.
 */
function declaresOwnBody(source: string, name: string): boolean {
  return new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?interface\\s+${name}(?:<[^>]*>)?\\s*\\{`).test(source);
}

describe('the pick shape has one declaration', () => {
  const files = sourceFiles(SRC).filter((file) => !file.endsWith('.test.ts'));

  it.each(PICK_SHAPE)('%s is declared only in types/protocol.ts', (name) => {
    const offenders = files.filter(
      (file) => file !== OWNER && declaresOwnBody(fs.readFileSync(file, 'utf-8'), name),
    );
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it.each(PICK_SHAPE)('%s really is declared in types/protocol.ts', (name) => {
    expect(declaresOwnBody(fs.readFileSync(OWNER, 'utf-8'), name)).toBe(true);
  });
});
