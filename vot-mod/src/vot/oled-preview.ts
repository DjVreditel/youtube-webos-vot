// Cobalt composites hardware video behind the page. OLED page backgrounds can
// cover inline playback even though the same video works in the watch view.
// Suspend only the page styling while a preview has a frame; retain the saved
// preference and the separate settings-panel/notification theme.
let enabled = false;
let installed = false;

function previewHasFrame(): boolean {
  if (!/Cobalt\//.test(navigator.userAgent)) return false;
  const body = document.body;
  if (!body || body.classList.contains('WEB_PAGE_TYPE_WATCH') ||
      body.classList.contains('WEB_PAGE_TYPE_SHORTS')) return false;
  const player = document.getElementById('ytlr-player__player-container-player') as
    (HTMLElement & { isInline?: () => boolean }) | null;
  try {
    const video = player?.querySelector('video');
    // Keep a paused preview visible too. A missing/emptied video restores OLED.
    return !!(player?.isInline?.() && video && video.readyState >= 2);
  } catch {
    return false;
  }
}

function sync(): void {
  const root = document.documentElement;
  const wanted = enabled && !previewHasFrame();
  if (root.classList.contains('oled-page-active') !== wanted) {
    root.classList.toggle('oled-page-active', wanted);
  }
}

export function setOledPageEnabled(value: boolean): void {
  enabled = value;
  sync();
  if (installed || !/Cobalt\//.test(navigator.userAgent)) return;
  installed = true;
  const events = ['loadeddata', 'playing', 'emptied'];
  for (const type of events) document.addEventListener(type, sync, true);
  window.addEventListener('ytaf-page-update', sync);
  // YouTube can change isInline() without a page event or a new <video>.
  const timer = window.setInterval(sync, 500);
  window.addEventListener('beforeunload', () => {
    window.clearInterval(timer);
    for (const type of events) document.removeEventListener(type, sync, true);
    window.removeEventListener('ytaf-page-update', sync);
  });
}
