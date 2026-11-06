import { isSourceLang } from './langs';

const STORAGE_KEY = 'ytaf-vot-source-languages-v1';
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type ObservedLanguage = { language: string; observedAt: number };

function isKnownLanguage(value: unknown): value is string {
  return typeof value === 'string' && value !== 'auto' && isSourceLang(value);
}

function isVideoId(value: string): boolean {
  return /^[\w-]{11}$/.test(value);
}

function readLanguages(now: number): Record<string, ObservedLanguage> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const entries: Array<[string, ObservedLanguage]> = [];
    for (const [videoId, value] of Object.entries(stored)) {
      if (!isVideoId(videoId) || !value || typeof value !== 'object') continue;
      const entry = value as Partial<ObservedLanguage>;
      if (
        !isKnownLanguage(entry.language) ||
        typeof entry.observedAt !== 'number' ||
        !Number.isFinite(entry.observedAt) ||
        entry.observedAt > now ||
        now - entry.observedAt >= MAX_AGE_MS
      ) continue;
      // Copy only the two fields this cache owns.
      entries.push([videoId, { language: entry.language, observedAt: entry.observedAt }]);
    }
    entries.sort((a, b) => b[1].observedAt - a[1].observedAt);
    return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  } catch {
    return {};
  }
}

/** Remember observed metadata per video, never a global manual language choice. */
export function resolveSourceLanguage(
  videoId: string,
  configuredLanguage: string,
  detectedLanguage: string
): string {
  if (isKnownLanguage(configuredLanguage)) return configuredLanguage;

  const now = Date.now();
  const languages = readLanguages(now);
  if (isKnownLanguage(detectedLanguage)) {
    if (isVideoId(videoId)) {
      const entries = Object.entries(languages)
        .filter(([id]) => id !== videoId)
        .sort((a, b) => b[1].observedAt - a[1].observedAt)
        .slice(0, MAX_ENTRIES - 1);
      // Keep the current observation even when the clock has not advanced.
      entries.unshift([videoId, { language: detectedLanguage, observedAt: now }]);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
      } catch { /* Storage must not prevent a translation. */ }
    }
    return detectedLanguage;
  }

  if (!isVideoId(videoId)) return 'auto';
  return Object.prototype.hasOwnProperty.call(languages, videoId)
    ? languages[videoId].language
    : 'auto';
}
