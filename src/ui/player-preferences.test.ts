// @vitest-environment jsdom
/**
 * A GAME'S OWN PLAYER PREFERENCES, SAVED PER GAME IN THE BROWSER (#1440).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { definePlayerPreferences } from './player-preferences.js';

const declarations = {
  battleEffects: { label: 'Battle effects', description: 'Bursts and explosions', default: true },
  flicker: {
    label: 'Flicker',
    options: [{ value: 'full', label: 'Full' }, { value: 'slow', label: 'Slow' }],
    default: 'full',
  },
} as const;

beforeEach(() => localStorage.clear());

describe('definePlayerPreferences', () => {
  it('starts at the declared defaults', () => {
    const prefs = definePlayerPreferences('windup', declarations);
    expect(prefs.use('battleEffects').value).toBe(true);
    expect(prefs.use('flicker').value).toBe('full');
  });

  it('saves a change and reads it back in a later visit', () => {
    definePlayerPreferences('windup', declarations).use('flicker').value = 'slow';
    expect(definePlayerPreferences('windup', declarations).use('flicker').value).toBe('slow');
  });

  it('keeps two games apart', () => {
    definePlayerPreferences('windup', declarations).use('battleEffects').value = false;
    expect(definePlayerPreferences('other-game', declarations).use('battleEffects').value).toBe(true);
  });

  it('falls back to the default when the stored value is no longer accepted', () => {
    localStorage.setItem('boardsmith-preference:windup:flicker', '"strobe"');
    localStorage.setItem('boardsmith-preference:windup:battleEffects', 'not json');
    const later = definePlayerPreferences('windup', declarations);
    expect(later.use('flicker').value).toBe('full');
    expect(later.use('battleEffects').value).toBe(true);
  });

  it('types each value from its declaration', () => {
    const prefs = definePlayerPreferences('windup', declarations);
    // @ts-expect-error 'strobe' is not one of flicker's options
    prefs.use('flicker').value = 'strobe';
    // @ts-expect-error an on/off preference holds a boolean
    prefs.use('battleEffects').value = 'yes';
  });

  it('updates every reader live', () => {
    const prefs = definePlayerPreferences('windup', declarations);
    const a = prefs.use('battleEffects');
    const b = prefs.use('battleEffects');
    a.value = false;
    expect(b.value).toBe(false);
  });

  it('refuses a choice whose default is not one of its options', () => {
    expect(() => definePlayerPreferences('windup', {
      flicker: { label: 'Flicker', options: [{ value: 'full', label: 'Full' }], default: 'slow' },
    })).toThrow(/"flicker".*"slow".*full/);
  });

  it('refuses a key the game did not declare', () => {
    const prefs = definePlayerPreferences('windup', declarations);
    expect(() => prefs.use('typo' as 'flicker')).toThrow(/"typo".*battleEffects, flicker/);
  });

  it('refuses an empty game name', () => {
    expect(() => definePlayerPreferences('', declarations)).toThrow(/game name/);
  });
});
