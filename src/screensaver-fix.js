/**
 * On webOS, when a video element doesn't perfectly fill
 * the entire screen, the screensaver can kick in.
 *
 * Also asks the TV itself, through its power service, not to start the
 * screensaver while a video plays (best effort; see registerScreenSaverRequest).
 */

import { waitForChildAdd, sendKey, SELECTORS, REMOTE_KEYS, isWatchPage, isShortsPage, getVideo } from './utils';

// Set to true when debugging the keep-alive / player-sizing logic.
const DEBUG = false;

function isPlayerHidden(video) {
  return video.style.display == 'none' || (video.style.top && video.style.top.indexOf('-') === 0);
}

// Cached Page State
let lastPageType = null;
let shortsKeepAliveTimer = null;
let shortsBufferTimer = null;
const STATE_PLAYING = 1;

function setShortsKeepAlive(enable) {
  if (enable) {
    if (shortsKeepAliveTimer) return;
    DEBUG && console.info('[ScreensaverFix] Shorts detected: Starting keep-alive (Yellow Key / 30s)');
    shortsKeepAliveTimer = window.setInterval(() => {
        // Check player state to ensure we only keep awake if actually playing
        const player = document.getElementById(SELECTORS.PLAYER_ID);
        const isPlaying = player && typeof player.getPlayerState === 'function' && player.getPlayerState() === STATE_PLAYING;
        if (!isPlaying) return;

        // NOTE: never log the element itself here. console.log(msg, node) makes
        // the console retain a strong reference to a DOM node that may since
        // have been removed — a slow leak firing every 30s for the whole
        // Shorts session on a runtime with no way to drain the buffer.
        DEBUG && console.log('[ScreensaverFix] keep-alive tick');

        // activeElement is document.body when nothing else has focus, null only pre-load.
        const target = document.activeElement || document.body;

        sendKey(REMOTE_KEYS.YELLOW, target);

        if (shortsBufferTimer) clearTimeout(shortsBufferTimer);
        shortsBufferTimer = window.setTimeout(() => {
            sendKey(REMOTE_KEYS.YELLOW_ALT, target);
            shortsBufferTimer = null;
        }, 250);
    }, 30000);
  } else {
    if (shortsKeepAliveTimer) {
      DEBUG && console.info('[ScreensaverFix] Stopping Shorts keep-alive');
      clearInterval(shortsKeepAliveTimer);
      shortsKeepAliveTimer = null;
    }
    if (shortsBufferTimer) {
        clearTimeout(shortsBufferTimer);
        shortsBufferTimer = null;
    }
  }
}

let rafPending = false;
let rafTargetVideo = null;

const playerCtrlObs = new MutationObserver((mutations) => {
  // Only watch page has a full-screen player fix logic.
  if (lastPageType !== 'WATCH') {
    playerCtrlObs.disconnect();
    return;
  }

  const video = mutations[0]?.target;
  // Both of these are normal during navigation teardown, not error conditions.
  if (!video || !(video instanceof HTMLVideoElement) || !video.isConnected) {
    DEBUG && console.warn('[ScreensaverFix] Video element gone, disconnecting observer');
    playerCtrlObs.disconnect();
    // The page may still be the watch page with a new <video>: look again.
    // (ytaf-page-update fires on a page-type change only.)
    setTimeout(updateState, 0);
    return;
  }

  // Coalesce bursts of style mutations into one rAF — Chrome 38 on webOS 3
  // pays a heavy reflow cost per write, so we read window dimensions and
  // diff against current style.* only once per frame.
  rafTargetVideo = video;
  if (rafPending) return;
  rafPending = true;

  requestAnimationFrame(() => {
    rafPending = false;
    const v = rafTargetVideo;
    rafTargetVideo = null;
    if (!v || !v.isConnected || lastPageType !== 'WATCH') return;
    if (isPlayerHidden(v)) return;

    const style = v.style;
    const tw = `${window.innerWidth}px`;
    const th = `${window.innerHeight}px`;
    try {
      // Some webOS versions fire a mutation even when assignment is a no-op,
      // causing an infinite loop — only write when the value actually differs.
      if (style.width !== tw) style.width = tw;
      if (style.height !== th) style.height = th;
      if (style.left !== '0px') style.left = '0px';
      if (style.top !== '0px') style.top = '0px';
    } catch (e) {
      console.warn('[ScreensaverFix] Error updating video styles:', e);
      playerCtrlObs.disconnect();
    }
  });
});

// --- webOS screensaver request ---
// The Yellow-key keep-alive above is ignored by some TVs, so longer Shorts
// still ended in the screensaver (NicholasBly/youtube-webos#46). The TV's
// power service announces each screensaver it is about to start to the
// clients registered for it, and a client answering ack:false holds it off.
// Best effort: PalmServiceBridge (the webOS service bridge) may be missing or
// the call refused on a given firmware; the keep-alive stays as the fallback.
const TVPOWER_URI = 'luna://com.webos.service.tvpower/power/';
const SCREENSAVER_CLIENT = 'youtube-webos';
// A bridge collected before its answer arrives drops the answer; keep each
// one-shot call referenced until its callback ran.
const pendingLunaCalls = [];

function lunaCall(method, params, onResponse, subscribe) {
  const Bridge = typeof window !== 'undefined' ? window.PalmServiceBridge : null;
  if (typeof Bridge !== 'function') return null;
  try {
    const bridge = new Bridge();
    if (!subscribe) pendingLunaCalls.push(bridge);
    bridge.onservicecallback = (msg) => {
      if (!subscribe) {
        const i = pendingLunaCalls.indexOf(bridge);
        if (i !== -1) pendingLunaCalls.splice(i, 1);
      }
      if (!onResponse) return;
      let res = null;
      try { res = JSON.parse(msg); } catch { /* not JSON */ }
      try { onResponse(res); } catch (e) { DEBUG && console.warn('[ScreensaverFix] luna callback failed:', e); }
    };
    bridge.call(TVPOWER_URI + method, JSON.stringify(params));
    return bridge;
  } catch (e) {
    DEBUG && console.warn('[ScreensaverFix] luna call failed:', method, e);
    return null;
  }
}

function isVideoPlaying() {
  if (lastPageType !== 'WATCH' && lastPageType !== 'SHORTS') return false;
  const video = getVideo();
  return !!(video && !video.paused && !video.ended);
}

// Held for the session: the subscription lasts as long as its bridge.
let screenSaverSubscription = null;

function registerScreenSaverRequest() {
  screenSaverSubscription = lunaCall('registerScreenSaverRequest', { subscribe: true, clientName: SCREENSAVER_CLIENT }, (res) => {
    if (!res || res.returnValue === false) {
      DEBUG && console.info('[ScreensaverFix] Screensaver request refused:', res);
      return;
    }
    // The first answer only confirms the subscription; each screensaver the
    // TV is about to start comes with a timestamp to answer.
    if (res.timestamp === undefined) return;
    const playing = isVideoPlaying();
    DEBUG && console.info(`[ScreensaverFix] Screensaver request: ${playing ? 'blocked (video playing)' : 'allowed'}`);
    lunaCall('responseScreenSaverRequest', { clientName: SCREENSAVER_CLIENT, ack: !playing, timestamp: res.timestamp });
  }, true);
}

registerScreenSaverRequest();

let currentVideoElement = null;

// The <video> itself, or a player subtree mounted with it inside.
const holdsVideo = (node) =>
  node instanceof HTMLVideoElement || !!(node.querySelector && node.querySelector('video'));

// waitForChildAdd cancels through an AbortSignal-like object; AbortController
// is missing on webOS 3 (Chromium 38), so this is the minimal stand-in.
function createWaitCanceller() {
  let onAbort = null;
  return {
    addEventListener(type, fn) { if (type === 'abort') onAbort = fn; },
    removeEventListener(type, fn) { if (onAbort === fn) onAbort = null; },
    cancel() {
      const fn = onAbort;
      onAbort = null;
      if (fn) fn();
    }
  };
}

// The pending wait for a <video> on the watch page, cancelled on a page change
// so its observer does not outlive the page.
let videoWait = null;

function unbindVideo() {
  playerCtrlObs.disconnect();
  currentVideoElement = null;
}

// The watch page's <video>, waited for when it has not mounted yet; null when
// it never does (left the page, or the 30s wait ran out).
async function findWatchVideo() {
  const playerContainer = document.getElementById(SELECTORS.PLAYER_CONTAINER);
  // If container exists, search inside it. If not, fallback to body.
  const searchRoot = playerContainer || document.body;

  // Shared cached lookup (isConnected-guarded, invalidated on page change).
  const found = getVideo() || searchRoot.querySelector('video');
  if (found) return found;

  const wait = createWaitCanceller();
  videoWait = wait;
  try {
    const node = await waitForChildAdd(searchRoot, holdsVideo, false, wait);
    // The added node can be a player subtree with the <video> inside.
    return node instanceof HTMLVideoElement ? node : node.querySelector('video');
  } catch (e) {
    DEBUG && console.info('[ScreensaverFix] No video element to attach to:', e.message);
    return null;
  } finally {
    if (videoWait === wait) videoWait = null;
  }
}

async function bindWatchVideo() {
  try {
    const video = await findWatchVideo();

    // Double check we are still on Watch page after await
    if (!video || lastPageType !== 'WATCH' || video === currentVideoElement) return;

    if (currentVideoElement) playerCtrlObs.disconnect();
    currentVideoElement = video;

    if (video.isConnected) {
      playerCtrlObs.observe(video, {
        attributes: true,
        attributeFilter: ['style']
      });
    }
  } catch (e) {
    console.warn('[ScreensaverFix] Error attaching to video element:', e);
  }
}

const updateState = async () => {
  const isWatch = isWatchPage();
  const isShorts = isShortsPage();

  const newPageType = isWatch ? 'WATCH' : (isShorts ? 'SHORTS' : 'OTHER');

  if (newPageType === lastPageType) {
    // Watch to watch: bind a remounted <video>, or one that mounted after the
    // wait for it ran out; a wait still running is left to find it.
    if (newPageType !== 'WATCH') return;
    if (currentVideoElement ? currentVideoElement.isConnected : videoWait) return;
    unbindVideo();
  }
  lastPageType = newPageType;

  if (videoWait) {
    videoWait.cancel();
    videoWait = null;
  }

  // Shorts: the keep-alive; any other page switches it off.
  setShortsKeepAlive(newPageType === 'SHORTS');

  if (newPageType === 'WATCH') await bindWatchVideo();
  else unbindVideo();
};

window.addEventListener('ytaf-page-update', updateState);
// A video-to-video navigation keeps the page type and may replace the <video>.
window.addEventListener('hashchange', updateState);

// Initial Check
if(document.body) updateState();
else document.addEventListener('DOMContentLoaded', updateState);

window.addEventListener('beforeunload', () => {
  playerCtrlObs.disconnect();
  window.removeEventListener('ytaf-page-update', updateState);
  window.removeEventListener('hashchange', updateState);
  if (videoWait) videoWait.cancel();
  if (screenSaverSubscription) {
    try { screenSaverSubscription.cancel(); } catch { /* ignore */ }
    screenSaverSubscription = null;
  }
  currentVideoElement = null;
  setShortsKeepAlive(false);
});