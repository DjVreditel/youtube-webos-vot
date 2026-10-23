export type VotTranslationStatus =
  'idle' | 'loading' | 'waiting' | 'retrying' | 'playing' | 'error';

export type VotTranslationResult =
  | { translated: true; url: string; usedLivelyVoice: boolean }
  | { translated: false; remainingTime: number; message: string };
