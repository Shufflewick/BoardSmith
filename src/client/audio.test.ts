// @vitest-environment jsdom
/**
 * `audioService` — the singleton `boardsmith/client` exports for turn-change
 * notification sounds. It is a singleton, so every test resets it explicitly
 * rather than relying on construction order.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { audioService } from './audio.js';

/** Records what was constructed/played so playback can be asserted without real audio. */
let played: number;
let constructedUrls: string[];
let constructedAudio: FakeAudio[];

class FakeAudio {
  #volume = 1;
  currentTime = 0;
  constructor(public src: string) {
    constructedUrls.push(src);
    constructedAudio.push(this);
  }
  /** Mirrors the browser, which throws rather than accepting a non-finite volume. */
  set volume(value: number) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Failed to set the 'volume' property: ${value} is not a finite value.`);
    }
    this.#volume = value;
  }
  get volume(): number {
    return this.#volume;
  }
  play(): Promise<void> {
    played++;
    return Promise.resolve();
  }
}

/** The element the service is currently holding. */
const lastAudio = (): FakeAudio => constructedAudio.at(-1)!;

beforeEach(() => {
  played = 0;
  constructedUrls = [];
  constructedAudio = [];
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  localStorage.clear();

  // `audioService` is a module singleton and exposes no reset, so its cached
  // audio element and initialized flag survive between tests. `init()` only
  // pre-creates an element when it does not already hold one, which made
  // "pre-creates the audio element" pass or fail purely on test ORDER. Clearing
  // the internals is what makes each test start from a genuinely fresh service.
  const internals = audioService as unknown as {
    audioElement: unknown;
    initialized: boolean;
    turnSoundUrl: string | null;
  };
  internals.audioElement = null;
  internals.initialized = false;
  internals.turnSoundUrl = null;

  audioService.init({ enabled: true, volume: 0.5 });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('init', () => {
  it('applies the options it is given', () => {
    audioService.init({ enabled: false, volume: 0.25 });
    expect(audioService.isEnabled()).toBe(false);
    expect(audioService.getVolume()).toBe(0.25);
  });

  it('leaves settings untouched for options that are omitted', () => {
    audioService.setVolume(0.75);
    audioService.init({});
    expect(audioService.getVolume()).toBe(0.75);
    expect(audioService.isEnabled()).toBe(true);
  });

  it('clamps the volume into 0..1', () => {
    audioService.init({ volume: 5 });
    expect(audioService.getVolume()).toBe(1);
    audioService.init({ volume: -3 });
    expect(audioService.getVolume()).toBe(0);
  });

  it('refuses a non-finite volume rather than propagating it', () => {
    audioService.init({ volume: 0.4 });
    for (const bad of [NaN, Infinity, -Infinity]) {
      audioService.init({ volume: bad });
      expect(audioService.getVolume()).toBe(0.4);
    }
  });

  it('pre-creates the audio element when given a sound URL', () => {
    audioService.init({ turnSoundUrl: 'turn.mp3' });
    expect(constructedUrls).toEqual(['turn.mp3']);
  });

  it('does not save to localStorage — init is configuration, not preference', () => {
    audioService.init({ enabled: false, volume: 0.2 });
    expect(localStorage.getItem('boardsmith-audio-enabled')).toBeNull();
    expect(localStorage.getItem('boardsmith-audio-volume')).toBeNull();
  });
});

describe('setTurnSoundUrl', () => {
  it('builds an audio element for the new URL', () => {
    audioService.setTurnSoundUrl('a.mp3');
    audioService.setTurnSoundUrl('b.mp3');
    expect(constructedUrls).toEqual(['a.mp3', 'b.mp3']);
  });

  it('applies the current volume to the new element, not just to the service', () => {
    audioService.setVolume(0.3);
    audioService.setTurnSoundUrl('a.mp3');
    expect(lastAudio().volume).toBe(0.3);
  });

  it('carries a later volume change onto the live element', () => {
    audioService.setTurnSoundUrl('a.mp3');
    audioService.setVolume(0.9);
    expect(lastAudio().volume).toBe(0.9);
  });
});

describe('playTurnSound', () => {
  it('plays once the sound URL is configured', async () => {
    audioService.setTurnSoundUrl('turn.mp3');
    await audioService.playTurnSound();
    expect(played).toBe(1);
  });

  it('does nothing when sound is disabled', async () => {
    audioService.setTurnSoundUrl('turn.mp3');
    audioService.setEnabled(false);
    await audioService.playTurnSound();
    expect(played).toBe(0);
  });

  it('does nothing when no sound URL has been configured', async () => {
    audioService.init({ turnSoundUrl: '' });
    await audioService.playTurnSound();
    expect(played).toBe(0);
  });

  it('restarts the sound rather than ignoring overlapping turns', async () => {
    audioService.setTurnSoundUrl('turn.mp3');
    await audioService.playTurnSound();
    await audioService.playTurnSound();
    expect(played).toBe(2);
  });

  it('swallows a rejected play — autoplay policy is not a game error', async () => {
    class BlockedAudio extends FakeAudio {
      override play(): Promise<void> {
        return Promise.reject(new Error('NotAllowedError'));
      }
    }
    vi.stubGlobal('Audio', BlockedAudio as unknown as typeof Audio);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    audioService.setTurnSoundUrl('turn.mp3');
    await expect(audioService.playTurnSound()).resolves.toBeUndefined();
  });
});

describe('setEnabled / isEnabled', () => {
  it('reports what was set', () => {
    audioService.setEnabled(false);
    expect(audioService.isEnabled()).toBe(false);
    audioService.setEnabled(true);
    expect(audioService.isEnabled()).toBe(true);
  });

  it('persists the preference', () => {
    audioService.setEnabled(false);
    expect(localStorage.getItem('boardsmith-audio-enabled')).toBe('false');
  });
});

describe('setVolume / getVolume', () => {
  it('reports what was set', () => {
    audioService.setVolume(0.4);
    expect(audioService.getVolume()).toBe(0.4);
  });

  it('clamps out-of-range volumes instead of rejecting them', () => {
    audioService.setVolume(2);
    expect(audioService.getVolume()).toBe(1);
    audioService.setVolume(-1);
    expect(audioService.getVolume()).toBe(0);
  });

  it('persists the preference', () => {
    audioService.setVolume(0.4);
    expect(localStorage.getItem('boardsmith-audio-volume')).toBe('0.4');
  });

  it('persists the clamped value, not the raw one', () => {
    audioService.setVolume(9);
    expect(localStorage.getItem('boardsmith-audio-volume')).toBe('1');
  });

  it('refuses a non-finite volume rather than propagating it', () => {
    // Math.max/min PROPAGATE NaN instead of clamping it, so a bare clamp is
    // not a guard. A NaN volume assigned to the audio element throws in the
    // browser, inside playTurnSound's catch — i.e. silently muted audio.
    audioService.setVolume(0.4);
    for (const bad of [NaN, Infinity, -Infinity]) {
      audioService.setVolume(bad);
      expect(audioService.getVolume()).toBe(0.4);
    }
  });

  it('never persists a rejected volume', () => {
    audioService.setVolume(0.4);
    audioService.setVolume(NaN);
    expect(localStorage.getItem('boardsmith-audio-volume')).toBe('0.4');
  });

  it('never puts a non-finite volume on the audio element', () => {
    audioService.setTurnSoundUrl('turn.mp3');
    audioService.setVolume(0.4);
    expect(() => audioService.setVolume(NaN)).not.toThrow();
    expect(lastAudio().volume).toBe(0.4);
  });

  it('keeps a live element in step with an accepted change', () => {
    audioService.setTurnSoundUrl('turn.mp3');
    audioService.setVolume(0.2);
    expect(lastAudio().volume).toBe(0.2);
  });
});

describe('loadPreferences', () => {
  it('restores a saved enabled flag', () => {
    localStorage.setItem('boardsmith-audio-enabled', 'false');
    audioService.loadPreferences();
    expect(audioService.isEnabled()).toBe(false);
  });

  it('restores a saved volume', () => {
    localStorage.setItem('boardsmith-audio-volume', '0.25');
    audioService.loadPreferences();
    expect(audioService.getVolume()).toBe(0.25);
  });

  it('leaves the defaults alone when nothing is stored', () => {
    audioService.loadPreferences();
    expect(audioService.isEnabled()).toBe(true);
    expect(audioService.getVolume()).toBe(0.5);
  });

  it('keeps the volume in 0..1 even when storage holds an out-of-range value', () => {
    // localStorage is user-writable and survives across versions; an
    // out-of-range value must not become the live volume.
    localStorage.setItem('boardsmith-audio-volume', '7');
    audioService.loadPreferences();
    expect(audioService.getVolume()).toBe(1);
  });

  it('ignores an unparseable stored volume rather than going NaN', () => {
    localStorage.setItem('boardsmith-audio-volume', 'loud');
    audioService.loadPreferences();
    expect(audioService.getVolume()).toBe(0.5);
  });

  it('restores a stored "true" as enabled', () => {
    audioService.setEnabled(false);
    localStorage.setItem('boardsmith-audio-enabled', 'true');
    audioService.loadPreferences();
    expect(audioService.isEnabled()).toBe(true);
  });

  it('treats any value other than "true" as disabled, since that is how it is written', () => {
    for (const stored of ['false', 'TRUE', '1', 'yes', '']) {
      audioService.setEnabled(true);
      localStorage.setItem('boardsmith-audio-enabled', stored);
      audioService.loadPreferences();
      expect(audioService.isEnabled(), `stored value ${JSON.stringify(stored)}`).toBe(false);
    }
  });
});
