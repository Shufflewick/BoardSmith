/**
 * Audio notification service for BoardSmith
 *
 * Provides system-wide sound notifications for game events like turn changes.
 */

export interface AudioServiceOptions {
  /** Enable/disable sound notifications (default: true) */
  enabled?: boolean;
  /** Volume level 0-1 (default: 0.5) */
  volume?: number;
  /** URL to the turn notification sound file */
  turnSoundUrl?: string;
}

/**
 * Audio service singleton for playing game notification sounds
 */
class AudioService {
  private enabled: boolean = true;
  private volume: number = 0.5;
  private turnSoundUrl: string | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private initialized: boolean = false;
  private listeners = new Set<() => void>();

  /**
   * Initialize the audio service with options
   */
  /**
   * The ONE place a volume is validated, so a new entry point cannot
   * reintroduce the hole this closes. Two traps live here:
   *
   * - `Math.max(0, Math.min(1, NaN))` is `NaN` — the clamp PROPAGATES NaN
   *   rather than rejecting it, so a bare clamp looks safe and is not.
   * - Assigning `NaN` to `HTMLAudioElement.volume` throws in the browser, and
   *   the throw happens inside `playTurnSound`'s catch, so the failure mode is
   *   a muted chime and a console warning rather than an error the game sees.
   *
   * A non-finite value therefore keeps the current setting instead of taking
   * it. Returns whether the volume was accepted, so callers know whether there
   * is anything worth persisting.
   */
  private applyVolume(volume: number): boolean {
    if (!Number.isFinite(volume)) return false;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audioElement) {
      this.audioElement.volume = this.volume;
    }
    return true;
  }

  init(options: AudioServiceOptions = {}): void {
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.volume !== undefined) {
      this.applyVolume(options.volume);
    }
    const urlChanged = options.turnSoundUrl !== undefined && options.turnSoundUrl !== this.turnSoundUrl;
    if (options.turnSoundUrl !== undefined) {
      this.turnSoundUrl = options.turnSoundUrl;
    }

    // Pre-create audio element for faster playback
    if (this.turnSoundUrl && (urlChanged || !this.audioElement)) {
      this.setTurnSoundUrl(this.turnSoundUrl);
    }
    this.notify();
  }

  /**
   * Set the turn sound URL (for lazy initialization)
   */
  setTurnSoundUrl(url: string): void {
    this.turnSoundUrl = url;
    if (typeof window !== 'undefined') {
      this.audioElement?.pause();
      this.audioElement = new Audio(url);
      this.audioElement.volume = this.volume;
      this.initialized = true;
    }
  }

  /**
   * Play the turn notification sound
   */
  async playTurnSound(): Promise<void> {
    if (!this.enabled) return;
    if (!this.turnSoundUrl) return; // No sound URL configured

    // Lazy init if not already done
    if (!this.initialized && this.turnSoundUrl) {
      this.setTurnSoundUrl(this.turnSoundUrl);
    }

    if (!this.audioElement) return;

    try {
      // Reset to start if already playing
      this.audioElement.currentTime = 0;
      this.audioElement.volume = this.volume;
      await this.audioElement.play();
    } catch (err) {
      // An AbortError only means a newer sound took over the element.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        console.warn(
          'The browser blocked the turn chime because nobody has clicked or pressed a key in the game yet. ' +
            'Sounds play once you click or press a key in the game. A host page that frames the game from ' +
            'another origin should give its iframe allow="autoplay" so clicks on the host page count too.',
        );
        return;
      }
      console.warn('The turn chime could not play:', err);
    }
  }

  /**
   * Enable or disable sound notifications
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // Save preference to localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('boardsmith-audio-enabled', String(enabled));
    }
    this.notify();
  }

  /**
   * Check if sound is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set volume level (0-1)
   */
  setVolume(volume: number): void {
    if (!this.applyVolume(volume)) return;
    // Save preference to localStorage. Only reached for an accepted value, so
    // a rejected one can never be written back and re-read on the next load.
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('boardsmith-audio-volume', String(this.volume));
    }
    this.notify();
  }

  /**
   * Call `listener` after each `init`, `loadPreferences`, `setEnabled` or accepted `setVolume`, so a game
   * that synthesizes sound or shows its own control follows the shell's menu.
   * Returns the unsubscribe.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current volume level
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Load preferences from localStorage
   */
  loadPreferences(): void {
    if (typeof localStorage === 'undefined') return;

    const enabled = localStorage.getItem('boardsmith-audio-enabled');
    if (enabled !== null) {
      this.enabled = enabled === 'true';
    }

    const volume = localStorage.getItem('boardsmith-audio-volume');
    if (volume !== null) {
      // Routed through the shared guard rather than assigned raw: localStorage
      // is user-writable and outlives any version of this code, so a stale or
      // hand-edited value must not become the live volume.
      this.applyVolume(parseFloat(volume));
    }
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

// Export singleton instance
export const audioService = new AudioService();

// Load preferences on module load
if (typeof window !== 'undefined') {
  audioService.loadPreferences();
}
