/**
 * One world element id key for tests that build a world and do not care which
 * key it is (#482). A real host mints a fresh one per world with
 * `mintWorldElementIdKey()`; a test names one so a second build of the same
 * world -- a restart, a cold host -- reads the first one's ids back.
 */
export const TEST_WORLD_ELEMENT_ID_KEY = '5eed0f1d0c0ffee15ba5e482';
