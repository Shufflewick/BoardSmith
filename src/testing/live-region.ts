/**
 * READING WHAT A SEAT ANNOUNCES, the way a screen reader hears it: from the
 * live regions its shell draws (`LiveRegions`, written by `createLiveRegion`'s
 * announcer). `renderAsSeat` draws the same regions beside the board, so a board
 * test and a shell test read announcements alike.
 */

/** A mounted wrapper, as `renderAsSeat` or `mount()` returns it. */
interface MountedWrapper {
  readonly vm: { readonly $root: { readonly $el: unknown } | null };
}

/** The element the wrapper's app is mounted in, which holds the whole mount: a shell, or a board and the regions renderAsSeat draws beside it. */
export function mountContainer(wrapper: MountedWrapper): Element | null {
  const root = wrapper.vm.$root?.$el;
  const container = root instanceof Node ? root.parentNode : null;
  return container instanceof Element ? container : null;
}

/**
 * Records every text the `level` live region of `wrapper`'s mount is given from
 * now on, in order, and returns a reader for them.
 *
 * Call it before the board announces. The reader lets pending announcements
 * render first, since `announce()` clears the region and sets its text a tick
 * later, so the same message twice is heard twice.
 *
 * @example
 * ```ts
 * const wrapper = await renderAsSeat(testGame, 1, { component: Board });
 * const said = watchLiveRegion(wrapper, 'assertive');
 * await wrapper.find('button').trigger('click');
 * expect(await said()).toEqual(['That space is taken']);
 * ```
 *
 * @throws When the mount draws no such region: mount the board with
 *   `renderAsSeat`, or the shell itself.
 */
export function watchLiveRegion(wrapper: MountedWrapper, level: 'polite' | 'assertive'): () => Promise<string[]> {
  const region = mountContainer(wrapper)?.querySelector(`[data-bs-live-region="${level}"]`);
  if (!region) {
    throw new Error(
      `watchLiveRegion found no ${level} live region in this mount, so there is nothing announced to read. ` +
        'Mount the board with renderAsSeat from boardsmith/testing, or mount GameShell or WorldShell, ' +
        'which draw the live regions; a board mounted on its own with mount() has none.',
    );
  }
  const said: string[] = [];
  const record = (records: MutationRecord[]) => {
    // Vue sets the region's text whole, so each write adds a node.
    for (const { addedNodes } of records) for (const node of addedNodes) if (node.textContent) said.push(node.textContent);
  };
  const observer = new MutationObserver(record);
  observer.observe(region, { childList: true });
  return async () => {
    // Loaded here so that importing boardsmith/testing never loads Vue for a test that renders nothing.
    const { nextTick } = await import('vue');
    await nextTick();
    await nextTick();
    record(observer.takeRecords());
    return [...said];
  };
}
