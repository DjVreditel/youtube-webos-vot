export type VideoID = string;

export declare enum PlayerMode {
  PREVIEW = 0,
  SHORTS = 1,
  NORMAL = 2
}

export type PlayerManager = {
  readonly currentVideoID: VideoID | null;
  readonly playerMode: PlayerMode;
  readonly player: {
    getVideoData(): {
      defaultAudioLanguage?: string;
      audioTracks?: Array<{ language?: string }>;
    };
  };
  addEventListener<K extends 'newVideo'>(
    type: K,
    listener: (evt: CustomEvent<VideoID>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener<K extends 'noVideo'>(
    type: K,
    listener: (evt: CustomEvent<undefined>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
};

export declare function getPlayerManager(): Promise<PlayerManager>;
