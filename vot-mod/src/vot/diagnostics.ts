export type TranslationDiagnosticEvent = {
  stage: 'session' | 'request' | 'response' | 'source-audio' | 'source-audio-failed' |
    'upload' | 'local-cache' | 'audio-download' | 'url-refresh' | 'ready';
  attempt?: number;
  httpStatus?: number;
  status?: number;
  shouldRetry?: number;
  chunk?: number;
  bypass?: boolean;
  reason?: 'source-not-ready' | 'source-video-mismatch' | 'source-attestation' | 'source-download-error';
};

const KEY = 'ytaf-vot-last-error-v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// A bounded, local-only record of the last failure. Never include response
// bodies, signed URLs, session secrets, account tokens, titles or audio bytes.
export function createTranslationTrace(videoId: string) {
  const startedAt = Date.now();
  const events: Array<TranslationDiagnosticEvent & { elapsedMs: number }> = [];
  try {
    const previous = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (previous && startedAt - previous.failedAt > MAX_AGE_MS) window.localStorage.removeItem(KEY);
  } catch { /* best effort */ }
  return {
    event(value: TranslationDiagnosticEvent) {
      // Copy an allowlist, so accidental extra properties cannot be persisted.
      const event: TranslationDiagnosticEvent & { elapsedMs: number } = {
        stage: value.stage, elapsedMs: Math.max(0, Date.now() - startedAt)
      };
      for (const key of ['attempt', 'httpStatus', 'status', 'shouldRetry', 'chunk'] as const) {
        if (typeof value[key] === 'number' && Number.isFinite(value[key])) event[key] = value[key];
      }
      if (typeof value.bypass === 'boolean') event.bypass = value.bypass;
      if (value.reason) event.reason = value.reason;
      events.push(event);
      if (events.length > 24) events.shift();
    },
    fail(error: unknown) {
      if ((error as { name?: string })?.name === 'AbortError') return;
      try {
        window.localStorage.setItem(KEY, JSON.stringify({
          version: 1, startedAt, failedAt: Date.now(),
          videoId: /^[\w-]{11}$/.test(videoId) ? videoId : undefined,
          events
        }));
      } catch { /* unavailable/full storage must not affect playback */ }
    }
  };
}
