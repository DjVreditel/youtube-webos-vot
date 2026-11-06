// Never send an invented duration: the server can ask us to upload only that
// much source audio, leaving a long video with a partial translation.
export function waitForVideoMetadata(
  getVideo: () => HTMLVideoElement | null,
  signal: AbortSignal,
  timeoutMs = 20_000
): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(Object.assign(new Error('Translation aborted'), { name: 'AbortError' }));
    };
    const check = () => {
      if (signal.aborted) { abort(); return; }
      const video = getVideo();
      if (video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
        cleanup();
        resolve(video);
        return;
      }
      if (Date.now() >= deadline) {
        cleanup();
        reject(new Error('Видео ещё загружается. Повторите перевод после начала воспроизведения.'));
        return;
      }
      timer = setTimeout(check, Math.min(100, Math.max(1, deadline - Date.now())));
    };
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}
