export type PlayerVolume = {
  getVolume?: () => number;
  setVolume?: (volume: number) => void;
};

/** Control the current YouTube track, including replacements after an audio-track change. */
export class OriginalVolume {
  private media: HTMLMediaElement | null = null;
  private originalVolume = 1;
  private originalMuted = false;
  private originalPlayerVolume: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private applying = false;
  private level = 0.15;
  private readonly onVolume = () => this.refresh();
  private readonly onPlayback = () => this.refresh(true);

  constructor(
    private readonly getMedia: () => HTMLMediaElement | null,
    private readonly getPlayer: () => PlayerVolume | null
  ) {}

  private readPlayerVolume() {
    try {
      return this.getPlayer()?.getVolume?.();
    } catch {
      return undefined;
    }
  }

  private writePlayerVolume(volume: number) {
    try {
      this.getPlayer()?.setVolume?.(volume);
    } catch {
      /* Media element remains the fallback. */
    }
  }

  start(level: number) {
    this.stop();
    const media = this.getMedia();
    if (!media) return;
    this.originalVolume = media.volume;
    this.originalMuted = media.muted;
    const volume = this.readPlayerVolume();
    this.originalPlayerVolume =
      typeof volume === 'number' && Number.isFinite(volume) ? volume : null;
    this.active = true;
    this.level = Math.min(1, Math.max(0, level));
    this.refresh(true);
    this.timer = setInterval(() => this.refresh(), 500);
  }

  setLevel(level: number) {
    this.level = Math.min(1, Math.max(0, level));
    this.refresh(true);
  }

  private unbind() {
    if (!this.media) return;
    this.media.removeEventListener('volumechange', this.onVolume);
    this.media.removeEventListener('loadedmetadata', this.onPlayback);
    this.media.removeEventListener('playing', this.onPlayback);
    this.media.volume = this.originalVolume;
    this.media.muted = this.originalMuted;
    this.media = null;
  }

  refresh(force = false) {
    if (!this.active || this.applying) return;
    const media = this.getMedia();
    if (!media) return;
    this.applying = true;
    try {
      if (media !== this.media) {
        this.unbind();
        this.media = media;
        media.addEventListener('volumechange', this.onVolume);
        media.addEventListener('loadedmetadata', this.onPlayback);
        media.addEventListener('playing', this.onPlayback);
        force = true;
      }
      const playerVolume = this.readPlayerVolume();
      // Updating the player too prevents its track switch from restoring 100%.
      if (
        force ||
        (typeof playerVolume === 'number' &&
          Math.abs(playerVolume - this.level * 100) > 0.5)
      ) {
        this.writePlayerVolume(this.level * 100);
      }
      if (Math.abs(media.volume - this.level) > 0.001)
        media.volume = this.level;
      // Explicit mute also covers backends that round very low volume values.
      const muted = this.originalMuted || this.level === 0;
      if (media.muted !== muted) media.muted = muted;
    } finally {
      this.applying = false;
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.unbind();
    if (this.originalPlayerVolume !== null)
      this.writePlayerVolume(this.originalPlayerVolume);
    this.originalPlayerVolume = null;
  }
}
