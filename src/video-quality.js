import { configRead, configAddChangeListener } from './config.js';
import { showNotification } from './notifications.js';
import { isWebOS25 } from './webos-utils.js';
import { sendKey, REMOTE_KEYS, SELECTORS, isWatchPage, getVideo } from './utils.js';
import { speedCapsQuality } from './playback-speed.js';

const DEBUG = false;

const IS_WEBOS_25 = isWebOS25();
const QUALITY_KEY = 'yt-player-quality';
const ONE_YEAR_MS = 31536000000; // 365 * 24 * 60 * 60 * 1000
// The record is rewritten this long before it expires, so Force Max Quality
// does not quietly stop working a year after it was first switched on.
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
let cachedQualityExpiration = 0;

// Caching: In-memory cache for localStorage & Config
let cachedQualitySettings = null;
let _shouldForce = false;

let player = null;
let lastVideoId = null;
let initTimer = null;
let isDestroyed = false;
let lastWriteTime = 0;
let statePollingInterval = null;
let lastKnownState = null;
let _isWatchPageCached = false;
let videoBeingProcessed = null;
let kickstartInProgress = false;

const qualitySetForVideo = new Set();

// webOS 25 first video fix
let hasKickstarted = false;

// Player States
const STATE_UNSTARTED = -1;
// const STATE_ENDED = 0;
const STATE_PLAYING = 1;
// const STATE_PAUSED = 2;
const STATE_BUFFERING = 3;
// const STATE_CUED = 5;

function isForceEnabled() {
  return _shouldForce && (!player?.isInline || !player.isInline()) && !speedCapsQuality();
}

async function ensurePlaybackStarts() {
  if (!IS_WEBOS_25 || hasKickstarted || isDestroyed || !player || kickstartInProgress) return;

  kickstartInProgress = true;
  if (DEBUG) console.info('[VideoQuality] 🚀 Starting playback enforcer...');

  const MAX_ATTEMPTS = 10;
  const INTERVAL_MS = 500;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (isDestroyed || !player || hasKickstarted) {
      kickstartInProgress = false;
      return;
    }

    try {
      const currentState = player.getPlayerState?.();

      if (currentState === STATE_PLAYING) {
        hasKickstarted = true;
        kickstartInProgress = false;
        if (DEBUG) console.info('[VideoQuality] ✅ Playback verified! Kickstart complete.');
        
        requestAnimationFrame(() => {
            const controls = document.querySelector('yt-focus-container[idomkey="controls"]');
            const isControlsVisible = controls && controls.classList.contains('MFDzfe--focused');

            if (isControlsVisible) {
                if (DEBUG) console.info('[VideoQuality] 🎮 Controls are focused. Hiding and dismissing...');

                const hideStyle = document.createElement('style');
                hideStyle.textContent = '.GLc3cc { opacity: 0 !important; transition: opacity 0.1s; }';
                document.head.appendChild(hideStyle);

                sendKey(REMOTE_KEYS.UP);                            
                setTimeout(() => sendKey(REMOTE_KEYS.UP), 250);     
                setTimeout(() => sendKey(REMOTE_KEYS.UP), 500);     

                setTimeout(() => {
                    if (hideStyle.isConnected) hideStyle.remove();
                }, 750);
            }
        });
        
        return;
      }

      if (DEBUG) console.log(`[VideoQuality] 👊 Kick attempt ${i + 1}/${MAX_ATTEMPTS} (State: ${currentState})`);
      player.playVideo?.();

    } catch (e) {
      if (DEBUG) console.warn('[VideoQuality] Kick attempt failed:', e);
    }
	
	// eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
  }

  kickstartInProgress = false;
  if (DEBUG && !hasKickstarted) {
    console.warn('[VideoQuality] ⚠️ Playback enforcer timed out without confirming PLAYING state.');
  }
}

// Max means the best level this video offers (the list is best first), not
// any named level: a 1440p video playing in 720p still needs the upgrade.
function isQualityAlreadyMax() {
  if (!player) return false;
  try {
    const best = (player.getAvailableQualityLevels?.() || []).find((q) => q !== 'auto');
    return !!best && player.getPlaybackQuality?.() === best;
  } catch {
    return false;
  }
}

function setLocalStorageQuality() {
  if (!isForceEnabled()) return false;
  
  const now = Date.now();
  if (now - lastWriteTime < 2000) return false;

  const isOurs = (q) => q && q.quality === 4320 && q.previousQuality === 4320;
  if (isOurs(cachedQualitySettings) && cachedQualityExpiration - now > RENEW_BEFORE_MS) {
    return false; 
  }
  
  try {
    if (!cachedQualitySettings) {
      const stored = window.localStorage.getItem(QUALITY_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.data) {
             cachedQualitySettings = JSON.parse(parsed.data);
             cachedQualityExpiration = Number(parsed.expiration) || 0;
          }
        } catch { /* ignore */ }
      }
    }

    if (isOurs(cachedQualitySettings) && cachedQualityExpiration - now > RENEW_BEFORE_MS) {
        return false; 
    }

    const innerData = { quality: 4320, previousQuality: 4320 };
      
    const qualityObj = {
      data: JSON.stringify(innerData),
      creation: now,
      expiration: now + ONE_YEAR_MS
    };
    
    window.localStorage.setItem(QUALITY_KEY, JSON.stringify(qualityObj));
    cachedQualitySettings = innerData;
    cachedQualityExpiration = qualityObj.expiration;
    lastWriteTime = now;
    
    DEBUG && console.info('[VideoQuality] Set localStorage quality to 4320p');
    return true;
    
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Failed to set localStorage quality:', e);
    return false;
  }
}

/**
 * Switching the option off drops the 4320p record this module wrote, so the
 * app goes back to choosing the quality itself instead of staying pinned.
 * A record the viewer set through YouTube's own menu is left alone.
 */
function clearLocalStorageQuality() {
  try {
    const stored = window.localStorage.getItem(QUALITY_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const data = parsed && parsed.data ? JSON.parse(parsed.data) : null;
      if (data && data.quality === 4320 && data.previousQuality === 4320) {
        window.localStorage.removeItem(QUALITY_KEY);
      }
    }
  } catch { /* ignore */ }
  cachedQualitySettings = null;
  cachedQualityExpiration = 0;
}

function setQualityOnPlayer() {
  if (!player || !isForceEnabled() || isDestroyed) {
    return { success: false, upgraded: false };
  }
  
  try {
    if (!player.setPlaybackQualityRange) {
      return { success: false, upgraded: false };
    }
    
    if (isQualityAlreadyMax()) {
      return { success: true, upgraded: false };
    }
    
    DEBUG && console.log('[VideoQuality] Upgrading quality from:', player.getPlaybackQuality?.());
    
    player.setPlaybackQualityRange('highres', 'highres');
    player.setPlaybackQuality?.('highres');
    
    const afterQuality = player.getPlaybackQuality?.();
    const qualityLabel = player.getPlaybackQualityLabel?.();
    
    DEBUG && console.info('[VideoQuality] ✅ Quality upgraded to:', afterQuality, qualityLabel);
    
    return { 
      success: true, 
      upgraded: true,
      newQuality: qualityLabel || afterQuality
    };
    
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Error setting quality:', e);
    return { success: false, upgraded: false };
  }
}

function notifyIfUpgraded(result) {
  if (result && result.upgraded) {
    setTimeout(() => {
      try {
        const finalQuality = player.getPlaybackQualityLabel?.() || result.newQuality || 'high quality';
        showNotification(`Video quality upgraded to ${finalQuality}`);
        DEBUG && console.info('[VideoQuality] Notification shown:', finalQuality);
      } catch {
        showNotification('Video quality upgraded to high quality');
      }
    }, 500);
  }
}

function interceptAndUpgradeQuality(videoId) {
  if (!player || !isForceEnabled() || isDestroyed) return;
  
  if (videoBeingProcessed === videoId) return;
  
  if (isQualityAlreadyMax()) {
    qualitySetForVideo.add(videoId);
    return;
  }
  
  videoBeingProcessed = videoId;
  DEBUG && console.info('[VideoQuality] 🛑 Intercepting playback to upgrade quality:', videoId);
  
  const currentState = player.getPlayerState?.();
  const wasPlaying = currentState === STATE_PLAYING;
  
  try {
    if (wasPlaying) player.pauseVideo?.();
  } catch { /* ignore */ }
  
  requestAnimationFrame(() => {
    const result = setQualityOnPlayer();
    
    if (result.success) {
      qualitySetForVideo.add(videoId);
    }
    
    requestAnimationFrame(() => {
      if (wasPlaying) {
        try {
          player.playVideo?.();
        } catch { /* ignore */ }
      }
      notifyIfUpgraded(result);
      videoBeingProcessed = null;
    });
  });
}

// --- Show Video Quality on Start ---
// A few seconds after a video starts playing, a toast with the quality it
// plays in (e.g. 1080p60), once per video (NicholasBly/youtube-webos#72). The
// delay lets the adaptive stream (and Force Max Quality) settle first.
const QUALITY_TOAST_DELAY_MS = 4000;
const QUALITY_HEIGHTS = {
  highres: 4320, hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720,
  large: 480, medium: 360, small: 240, tiny: 144
};
let qualityToastVideoId = null;
let qualityToastTimer = null;

function clearQualityToast() {
  if (qualityToastTimer) {
    clearTimeout(qualityToastTimer);
    qualityToastTimer = null;
  }
}

function playingQualityLabel() {
  try {
    const label = player?.getPlaybackQualityLabel?.();
    if (label) return label;
  } catch { /* ignore */ }
  // The picture itself: the shorter side, so a portrait video reads right too.
  const video = getVideo();
  if (video && video.videoHeight) return `${Math.min(video.videoWidth || video.videoHeight, video.videoHeight)}p`;
  try {
    const height = QUALITY_HEIGHTS[player?.getPlaybackQuality?.()];
    if (height) return `${height}p`;
  } catch { /* ignore */ }
  return null;
}

function scheduleQualityToast(actualState) {
  if (actualState !== STATE_PLAYING || !configRead('showQualityOnStart')) return;
  let videoId = null;
  try { videoId = player.getVideoData?.()?.video_id || null; } catch { /* ignore */ }
  if (!videoId || videoId === qualityToastVideoId) return;
  qualityToastVideoId = videoId;
  clearQualityToast();
  qualityToastTimer = setTimeout(() => {
    qualityToastTimer = null;
    if (isDestroyed || !player) return;
    try {
      // Still the same video, and still playing.
      if (player.getVideoData?.()?.video_id !== videoId) return;
      if (player.getPlayerState?.() !== STATE_PLAYING) {
        // Paused or buffering: the next time it plays tries again.
        qualityToastVideoId = null;
        return;
      }
    } catch { return; }
    const label = playingQualityLabel();
    if (label) showNotification(`Playing in ${label}`);
  }, QUALITY_TOAST_DELAY_MS);
}

function handleStateChange(state) {
  if (isDestroyed || !player) return;

  const actualState = (state && state.data !== undefined) ? state.data : state;

  // Publish FIRST. This event is shared infrastructure: watch.js (clock
  // visibility) and sponsorblock.js (overlay cache invalidation, observer
  // re-arm, chain-skip re-arm, high-freq loop teardown) both subscribe to it.
  // It must not be suppressed by an unrelated quality setting.
  window.dispatchEvent(new CustomEvent('yt-player-state-change', {
    detail: { state: actualState, videoId: lastVideoId }
  }));

  scheduleQualityToast(actualState);

  // Everything below is quality forcing only.
  if (!_shouldForce) return;

  try {
    const videoData = player.getVideoData?.();
    const videoId = videoData?.video_id;
    
    if (!videoId) return;
    
    const isNewVideo = videoId !== lastVideoId;
    
    if (isNewVideo) {
      lastVideoId = videoId;
      DEBUG && console.info('[VideoQuality] 🎬 New video:', videoId);
      
      if (actualState === STATE_UNSTARTED) {
          setLocalStorageQuality();
      }
    }
    
    if (qualitySetForVideo.has(videoId)) {
      if (actualState === STATE_PLAYING) ensurePlaybackStarts();
      return;
    }
    
    switch (actualState) {
        // Identical handling: setQualityOnPlayer() already short-circuits when
        // the quality is maxed (returning upgraded:false, making
        // notifyIfUpgraded a no-op), so both cases collapse to one path.
        case STATE_UNSTARTED:
        case STATE_BUFFERING:
            if (isNewVideo && player.getAvailableQualityLevels?.()?.length > 0) {
                if (!isQualityAlreadyMax()) notifyIfUpgraded(setQualityOnPlayer());
                qualitySetForVideo.add(videoId);
            }
            break;

        case STATE_PLAYING:
            if (!isQualityAlreadyMax()) {
                interceptAndUpgradeQuality(videoId);
            } else {
                qualitySetForVideo.add(videoId);
            }
            break;
    }

	ensurePlaybackStarts();
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Error in state change handler:', e);
  }
}

function startStatePolling() {
  if (statePollingInterval) return;
  
  DEBUG && console.info('[VideoQuality] Starting state polling (Fallback)');
  
  statePollingInterval = setInterval(() => {
    if (isDestroyed || !player) {
      stopStatePolling();
      return;
    }
    try {
      const state = player.getPlayerState?.();
      if (state !== lastKnownState) {
        lastKnownState = state;
        handleStateChange(state);
      }
    } catch { /* ignore */ }
  }, 250);
}

function stopStatePolling() {
  if (statePollingInterval) {
    clearInterval(statePollingInterval);
    statePollingInterval = null;
  }
}

export function destroyVideoQuality() {
  DEBUG && console.info('[VideoQuality] Destroying');
  
  isDestroyed = true;
  
  if (initTimer) {
    clearTimeout(initTimer);
    initTimer = null;
  }
  
  stopStatePolling();
  clearQualityToast();
  qualityToastVideoId = null;

  if (player) {
    try {
      player.removeEventListener?.('onStateChange', handleStateChange);
    } catch { /* ignore */ }
  }
  
  player = null;
  lastVideoId = null;
  lastKnownState = null;
  qualitySetForVideo.clear();
  videoBeingProcessed = null;
  _isWatchPageCached = false;
  kickstartInProgress = false;
  // Don't reset hasKickstarted here so it persists for the session
}

export function initVideoQuality() {
  if (initTimer || player) return;
  
  DEBUG && console.info('[VideoQuality] Initializing');
  
  isDestroyed = false;
  _isWatchPageCached = true;
  
  _shouldForce = configRead('forceHighResVideo');
  
  setLocalStorageQuality();
  
  const attach = () => {
    if (isDestroyed) return true;
    
    const p = document.getElementById(SELECTORS.PLAYER_ID);
    if (!p || !p.setPlaybackQualityRange || !p.isConnected) {
      return false;
    }
    
    try {
      player = p;
      let listenerAttached = false;
      
      try {
        if (player.addEventListener) {
            player.addEventListener('onStateChange', handleStateChange);
            listenerAttached = true;
            DEBUG && console.log('[VideoQuality] Native listener attached');
        }
      } catch (e) {
        DEBUG && console.warn('[VideoQuality] Event listener failed, falling back to poll:', e);
      }
      
      if (!listenerAttached) {
          startStatePolling();
      }
      
      DEBUG && console.info('[VideoQuality] ✅ Attached to player');
      
      handleStateChange(player.getPlayerState?.());
      
      return true;
    } catch (e) {
      DEBUG && console.warn('[VideoQuality] Error attaching:', e);
      player = null;
      return false;
    }
  };

  if (attach()) return;

  // Every 200ms for 10s, then - for a player that mounts late, e.g. after a
  // slow start or an ad - once a second for another 50s, then it gives up
  // until the next watch page.
  let attempts = 0;
  const poll = () => {
    if (isDestroyed) {
      clearTimeout(initTimer);
      initTimer = null;
      return;
    }
    if (attach() || attempts++ >= 100) {
      clearTimeout(initTimer);
      initTimer = null;
    } else {
      initTimer = setTimeout(poll, attempts > 50 ? 1000 : 200);
    }
  };
  
  poll();
}

function handleNavigation(event) {
  const isWatch = (event?.detail?.pageType === 'watch') || isWatchPage();
  
  if (isWatch && !_isWatchPageCached) {
    DEBUG && console.info('[VideoQuality] Navigation: Entering watch page');
    setTimeout(initVideoQuality, 0); 
    
  } else if (!isWatch && _isWatchPageCached) {
    DEBUG && console.info('[VideoQuality] Navigation: Leaving watch page');
    destroyVideoQuality();
  }
}

function setupListeners() {
    // Registered once for the session, not per attach: the option is also
    // switched off from the home screen, where the module is detached, and the
    // 4320p record it wrote must go then too.
    configAddChangeListener('forceHighResVideo', (evt) => {
      _shouldForce = !!evt.detail.newValue;
      if (_shouldForce) {
        cachedQualitySettings = null;
        setLocalStorageQuality();
        qualitySetForVideo.clear();
      } else {
        clearLocalStorageQuality();
      }
    });

    window.addEventListener('yt-navigate-finish', handleNavigation);

    // Passed directly: handleNavigation falls back to isWatchPage() when the
    // event carries no pageType, and ytaf-page-update never does.
    window.addEventListener('ytaf-page-update', handleNavigation);
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => handleNavigation());
    } else {
        handleNavigation();
    }
    
    window.addEventListener('beforeunload', destroyVideoQuality);
}

setupListeners();
