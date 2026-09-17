// @vitest-environment jsdom
/**
 * The two ways a game meets an uninstalled three.js, and what each one says.
 *
 * `three` is an optional peer dependency (#276, and `./three-peer.ts` for the
 * reasoning), so "not installed" is a state BoardSmith supports rather than a
 * corrupt tree. The whole cost of that choice is carried by the message, so the
 * message is what is gated: the compiler's path is proven against a real
 * `vue-tsc` in `src/contract/dice-typecheck.test.ts`, and the loader's path --
 * a game that compiled elsewhere, or a dev server resolving at request time --
 * is proven here, by mounting the component the barrel actually exports.
 */
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

import { missingThreePeerHint, THREE_PEER_INSTRUCTION } from './three-peer.js';

describe('missingThreePeerHint', () => {
  it('recognises the compiler saying three could not be resolved', () => {
    expect(
      missingThreePeerHint([
        "node_modules/boardsmith/src/ui/components/dice/Die3D.vue(9,24): error TS2307: Cannot find module 'three' or its corresponding type declarations.",
      ]),
    ).toBe(THREE_PEER_INSTRUCTION);
  });

  it('recognises an unresolved subpath of three as the same missing install', () => {
    expect(
      missingThreePeerHint([
        "a.ts(1,1): error TS2307: Cannot find module 'three/examples/jsm/controls/OrbitControls.js'.",
      ]),
    ).toBe(THREE_PEER_INSTRUCTION);
  });

  it('leaves an ordinary type error alone, so it is never mislabelled as a missing install', () => {
    expect(
      missingThreePeerHint([
        "b.ts(4,2): error TS2322: Type 'string' is not assignable to type 'number'.",
        "b.ts(9,1): error TS2307: Cannot find module './missing.js'.",
      ]),
    ).toBeNull();
  });

  it('says nothing about a clean compile', () => {
    expect(missingThreePeerHint([])).toBeNull();
  });
});

describe('Die3D with three.js not installed', () => {
  it('fails with the install instruction rather than a bare resolution failure', async () => {
    vi.resetModules();
    // What the resolver does for a package that is not there. The words differ
    // between Vite, Node and a browser, which is exactly why the barrel probes
    // rather than reading them.
    vi.doMock('three', () => {
      throw new Error("Failed to resolve import 'three'");
    });

    const { Die3D } = await import('./index.js');

    const captured: unknown[] = [];
    const Host = defineComponent({
      errorCaptured(error) {
        captured.push(error);
        return false;
      },
      render: () => h(Die3D, { sides: 6, value: 1 }),
    });

    mount(Host);
    await vi.waitFor(() => expect(captured).toHaveLength(1));

    const error = captured[0] as Error;
    expect(error.message).toBe(THREE_PEER_INSTRUCTION);
    expect(error.message).toContain('npm install three @types/three');
    // The resolver's own failure is kept as `cause`, so a failure that is NOT
    // a missing install is still diagnosable from the same throw.
    expect(error.cause).toBeInstanceOf(Error);

    vi.doUnmock('three');
    vi.resetModules();
  });
});
