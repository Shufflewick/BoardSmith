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

  /**
   * Initialize the audio service with options
   */
  init(options: AudioServiceOptions = {}): void {
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.volume !== undefined) {
      this.volume = Math.max(0, Math.min(1, options.volume));
    }
    if (options.turnSoundUrl !== undefined) {
      this.turnSoundUrl = options.turnSoundUrl;
    }

    // Pre-create audio element for faster playback
    if (typeof window !== 'undefined' && this.turnSoundUrl && !this.audioElement) {
      this.audioElement = new Audio(this.turnSoundUrl);
      this.audioElement.volume = this.volume;
      this.initialized = true;
    }
  }

  /**
   * Set the turn sound URL (for lazy initialization)
   */
  setTurnSoundUrl(url: string): void {
    this.turnSoundUrl = url;
    if (typeof window !== 'undefined') {
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
      // Audio play can fail if user hasn't interacted with page yet
      // This is expected behavior - silently ignore
      console.debug('Audio play failed (user interaction required):', err);
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
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audioElement) {
      this.audioElement.volume = this.volume;
    }
    // Save preference to localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('boardsmith-audio-volume', String(this.volume));
    }
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
      this.volume = parseFloat(volume);
    }
  }
}

// Export singleton instance
export const audioService = new AudioService();

// Load preferences on module load
if (typeof window !== 'undefined') {
  audioService.loadPreferences();
}
