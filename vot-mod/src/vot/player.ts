export type VideoID = string;

export enum PlayerMode {
  PREVIEW,
  SHORTS,
  NORMAL
}

type VideoData = {
  video_id?: string;
  defaultAudioLanguage?: string;
  audioTracks?: Array<{ language?: string }>;
};

type YTPlayer = HTMLElement & {
  getVideoData(): VideoData;
  getVideoStats(): { el?: string };
  isInline(): boolean;
};

type EventMap = {
  newVideo: VideoID;
  noVideo: undefined;
};

type Listener<K extends keyof EventMap> = (
  evt: CustomEvent<EventMap[K]>
) => void;

export class PlayerManager {
  readonly player: YTPlayer;
  #lastVideoID: VideoID | null = null;
  #listeners: { [K in keyof EventMap]: Listener<K>[] } = {
    newVideo: [],
    noVideo: []
  };

  constructor(player: YTPlayer) {
    this.player = player;
    player.addEventListener('onStateChange', this.#handleStateChange);
  }

  get currentVideoID(): VideoID | null {
    return this.player.getVideoData().video_id || null;
  }

  get playerMode(): PlayerMode {
    if (this.player.isInline()) return PlayerMode.PREVIEW;
    if (this.player.getVideoStats().el === 'shortspage') {
      return PlayerMode.SHORTS;
    }
    return PlayerMode.NORMAL;
  }

  addEventListener<K extends keyof EventMap>(type: K, listener: Listener<K>) {
    this.#listeners[type].push(listener);
  }

  #emit<K extends keyof EventMap>(type: K, detail: EventMap[K]) {
    const evt = new CustomEvent(type, { detail });
    for (const listener of this.#listeners[type].slice()) {
      try {
        listener(evt);
      } catch (err) {
        console.error('[VOT] player listener failed', err);
      }
    }
  }

  #handleStateChange = () => {
    const videoID = this.currentVideoID;
    if (videoID === this.#lastVideoID) return;
    this.#lastVideoID = videoID;
    if (videoID) this.#emit('newVideo', videoID);
    else this.#emit('noVideo', undefined);
  };
}

const PLAYER_SELECTOR = '.html5-video-player';
const PLAYER_LOOKUP_INTERVAL_MS = 1000;

let managerPromise: Promise<PlayerManager> | null = null;

function findPlayer(): YTPlayer | null {
  const el = document.querySelector(PLAYER_SELECTOR) as YTPlayer | null;
  return el && typeof el.getVideoData === 'function' ? el : null;
}

export function getPlayerManager(): Promise<PlayerManager> {
  managerPromise ??= new Promise((resolve) => {
    const found = findPlayer();
    if (found) {
      resolve(new PlayerManager(found));
      return;
    }
    const timer = setInterval(() => {
      const player = findPlayer();
      if (!player) return;
      clearInterval(timer);
      resolve(new PlayerManager(player));
    }, PLAYER_LOOKUP_INTERVAL_MS);
  });
  return managerPromise;
}
