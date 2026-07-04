export type VotTranslationStatus =
  | 'idle'
  | 'loading'
  | 'waiting'
  | 'retrying'
  | 'playing'
  | 'error';

export type VotTranslationResult =
  | { translated: true; url: string }
  | { translated: false; remainingTime: number; message: string };
