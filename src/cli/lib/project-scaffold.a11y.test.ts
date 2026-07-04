// @vitest-environment jsdom
/**
 * Executable proof for the generated a11y example harness (WR-01).
 *
 * The grep-only assertions in project-scaffold.test.ts pin that
 * `generateA11yExampleTestTs()` emits `attachTo: document.body` + an unconditional
 * `wrapper.unmount()`. This file *executes* the invariant those strings depend on:
 * axe-core scans only nodes that are IN the document, and `@vue/test-utils` `mount`
 * WITHOUT `attachTo` renders a DETACHED node (axe then throws "No elements found for
 * include in page Context"). We reproduce that attach/detach fact with the real
 * `@vue/test-utils` + jsdom stack BoardSmith already ships, so a future revert of the
 * CR-01 fix — dropping `attachTo` — turns this red rather than passing green.
 *
 * axe-core itself is intentionally NOT a BoardSmith dependency (it belongs only in the
 * generated project's devDependencies), so this proves the precondition axe requires
 * rather than importing axe here.
 */
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, it, expect, afterEach } from 'vitest';

// A trivial fixture standing in for the generated GameTable.vue stub.
const Fixture = defineComponent({
  name: 'A11yFixture',
  render() {
    return h('button', { 'aria-label': 'Take the only available action' }, 'Act');
  },
});

describe('a11y example harness — attach/detach invariant (WR-01)', () => {
  afterEach(() => {
    // Guard the shared jsdom document between cases in this file.
    document.body.innerHTML = '';
  });

  it('mount WITHOUT attachTo yields a detached node (why the generated test must set attachTo)', () => {
    const wrapper = mount(Fixture);
    try {
      // This is exactly the state that makes axe.run() throw.
      expect(document.body.contains(wrapper.element)).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('mount WITH attachTo: document.body yields an attached node axe.run can scan', () => {
    const wrapper = mount(Fixture, { attachTo: document.body });
    try {
      expect(document.body.contains(wrapper.element)).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it('wrapper.unmount() detaches the node so it does not leak into the next test', () => {
    const wrapper = mount(Fixture, { attachTo: document.body });
    expect(document.body.contains(wrapper.element)).toBe(true);
    wrapper.unmount();
    expect(document.body.contains(wrapper.element)).toBe(false);
  });
});
