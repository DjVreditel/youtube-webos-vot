import { configRead } from '../config';
import { getPlayerManager } from '../player_api';
import { PlayerMode } from '../player_api';
import type { PlayerManager, VideoID } from '../player_api';
import { translateVideo } from './client';
import type { VotTranslationStatus } from './types';
import {
  AUDIO_CHUNK_BYTES,
  RANGE_ALIGN_BYTES,
  SYNC_DRIFT_THRESHOLD_S,
  resolveSyncAction,
  shouldRunDriftCheck,
  calcChunkRange
} from './sync-core';

let originalVolumeReduction: number = configRead('votOriginalVolume');

type StatusChangeCallback = (
  status: VotTranslationStatus,
  message?: string
) => void;
type VideoListenerCleanup = () => void;

let currentVideoId: VideoID | null = null;
let lastErrorVideoId: VideoID | null = null;
let abortController: AbortController | null = null;
let videoElement: HTMLVideoElement | null = null;
let statusCallback: StatusChangeCallback | null = null;
let originalVolume: number | null = null;
let videoListenerCleanup: VideoListenerCleanup | null = null;
let currentManager: PlayerManager | null = null;

let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let audioSource: AudioBufferSourceNode | null = null;
let audioBuffer: AudioBuffer | null = null;
let audioBufferStartTime = 0;
let audioPlayCtxStart = 0;
let audioPlayVideoStart = 0;

let currentAudioUrl: string | null = null;
let currentFileSize = 0;
let currentVideoDuration = 0;
let currentChunkEndByte = 0;
let isLoadingChunk = false;
let serverRestartCount = 0;

let prefetchedChunk: AudioChunk | null = null;
let prefetchPromise: Promise<AudioChunk> | null = null;
let prefetchGeneration = 0;
let seekVersion = 0;
let translationGeneration = 0;
let seekAbortController: AbortController | null = null;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let manuallyStoppedVideoId: VideoID | null = null;

let countdownTimerId: ReturnType<typeof setInterval> | null = null;
let countdownRemaining = 0;
let countdownExhausted = false;

const MAX_SERVER_RESTARTS = 3;

function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video.html5-main-video');
}

function setStatus(status: VotTranslationStatus, message?: string) {
  statusCallback?.(status, message);
}

function startCountdown(remaining: number) {
  if (countdownExhausted) {
    setStatus('retrying');
    return;
  }
  if (remaining > countdownRemaining) {
    countdownRemaining = remaining;
  }
  if (countdownTimerId !== null) return;
  countdownTimerId = setInterval(() => {
    if (countdownRemaining > 0) {
      countdownRemaining--;
      setStatus('waiting', `~${countdownRemaining}s`);
    } else {
      countdownExhausted = true;
      setStatus('retrying');
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownTimerId !== null) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
  countdownRemaining = 0;
  countdownExhausted = false;
}

function createAudioContext(): AudioContext {
  const win = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? win.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API not supported on this device');
  return new Ctor();
}

function getAudioCurrentTime(): number {
  if (!audioCtx || !audioSource) return 0;
  const elapsed =
    audioCtx.state === 'running'
      ? (audioCtx.currentTime - audioPlayCtxStart) *
        audioSource.playbackRate.value
      : 0;
  return audioPlayVideoStart + elapsed;
}

function stopAudioSource() {
  if (!audioSource) return;
  audioSource.onended = null;
  try {
    audioSource.stop();
  } catch {}
  audioSource.disconnect();
  audioSource = null;
}

// Refetch guard: when the CBR byte estimate keeps producing a chunk that
// still doesn't cover the target time, stop refetching and play best-effort
const MAX_OUT_OF_CHUNK_RETRIES = 2;
let outOfChunkTarget = -1;
let outOfChunkRetries = 0;

function startAudioFrom(videoTime: number) {
  if (!audioCtx || !audioBuffer || !gainNode) return;

  const action = resolveSyncAction(
    videoTime,
    audioBufferStartTime,
    audioBuffer.duration
  );
  let offset = videoTime - audioBufferStartTime;

  if (action === 'load-chunk') {
    // The target lies outside the loaded chunk — e.g. SponsorBlock/adblock
    // skipped past it. Clamp-playing the chunk tail here used to end the
    // source instantly, chain onended -> sequential next chunk -> clamp
    // again: the audible looping bug. Fetch the right chunk instead.
    const sameTarget = Math.abs(videoTime - outOfChunkTarget) < 1;
    outOfChunkRetries = sameTarget ? outOfChunkRetries + 1 : 0;
    outOfChunkTarget = videoTime;
    if (outOfChunkRetries <= MAX_OUT_OF_CHUNK_RETRIES) {
      void loadChunkAt(videoTime);
      return;
    }
    // Positioning keeps missing this time — play the nearest edge of what
    // we have rather than refetching forever
    offset = Math.max(0, Math.min(offset, audioBuffer.duration - 0.5));
  } else {
    outOfChunkRetries = 0;
  }

  stopAudioSource();

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gainNode);
  source.playbackRate.value = videoElement?.playbackRate ?? 1;
  source.onended = () => {
    if (source === audioSource) void continuePlayback();
  };

  audioPlayCtxStart = audioCtx.currentTime;
  audioPlayVideoStart = videoTime;
  source.start(0, offset);
  audioSource = source;
}

type AudioChunk = {
  buffer: AudioBuffer;
  bufferStartTime: number;
  endByte: number;
};

function fetchRangedChunk(
  url: string,
  signal: AbortSignal,
  startByte: number,
  endByte: number,
  fileSize: number
): Promise<AudioChunk> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || !audioCtx) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 90_000;
    if (fileSize > AUDIO_CHUNK_BYTES) {
      xhr.setRequestHeader('Range', `bytes=${startByte}-${endByte}`);
    }

    xhr.onload = () => {
      if (xhr.status !== 200 && xhr.status !== 206) {
        reject(new Error(`Audio fetch failed: HTTP ${xhr.status}`));
        return;
      }
      if (!audioCtx) {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        return;
      }

      const raw = xhr.response as ArrayBuffer;
      const safe =
        raw.byteLength > AUDIO_CHUNK_BYTES
          ? raw.slice(0, AUDIO_CHUNK_BYTES)
          : raw;

      audioCtx.decodeAudioData(
        safe,
        (decoded) => {
          if (signal.aborted || !audioCtx) {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            return;
          }
          let chunkStartTime = 0;
          if (startByte > 0 && decoded.duration > 0) {
            const bytesPerSec = safe.byteLength / decoded.duration;
            chunkStartTime = startByte / bytesPerSec;
          }
          const actualEndByte = startByte + safe.byteLength;
          console.debug(
            '[VOT] chunk decoded, duration:',
            decoded.duration.toFixed(1),
            'start:',
            chunkStartTime.toFixed(1)
          );
          resolve({
            buffer: decoded,
            bufferStartTime: chunkStartTime,
            endByte: actualEndByte
          });
        },
        () => reject(new Error('Audio decode failed'))
      );
    };
    xhr.onerror = () => reject(new Error('Audio fetch: network error'));
    xhr.ontimeout = () => reject(new Error('Audio fetch: timeout'));

    const onAbort = () => {
      xhr.abort();
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    // Detach on settle: the signal lives for the whole session and would
    // otherwise retain every chunk's xhr (and its ArrayBuffer) via closure
    xhr.onloadend = () => signal.removeEventListener('abort', onAbort);

    xhr.send();
    console.debug(
      '[VOT] audio XHR started, startByte:',
      startByte,
      'fileSize:',
      fileSize
    );
  });
}

async function continuePlayback() {
  if (!currentAudioUrl || !audioCtx || !gainNode || !abortController) {
    void stopTranslation();
    return;
  }

  if (currentChunkEndByte >= currentFileSize - RANGE_ALIGN_BYTES) {
    void stopTranslation();
    return;
  }

  if (isLoadingChunk) return;
  isLoadingChunk = true;

  const localSeekVersion = seekVersion;
  const { signal } = abortController;
  const startByte = currentChunkEndByte;
  const endByte = Math.min(
    currentFileSize - 1,
    startByte + AUDIO_CHUNK_BYTES - 1
  );

  try {
    let chunk: AudioChunk;
    if (prefetchedChunk !== null) {
      chunk = prefetchedChunk;
      prefetchedChunk = null;
      prefetchPromise = null;
    } else if (prefetchPromise !== null) {
      const p = prefetchPromise;
      prefetchPromise = null;
      prefetchGeneration++;
      chunk = await p;
    } else {
      prefetchGeneration++;
      chunk = await fetchRangedChunk(
        currentAudioUrl,
        signal,
        startByte,
        endByte,
        currentFileSize
      );
    }

    if (signal.aborted || !audioCtx || seekVersion !== localSeekVersion) return;

    audioBuffer = null;
    audioBuffer = chunk.buffer;
    audioBufferStartTime = chunk.bufferStartTime;
    currentChunkEndByte = chunk.endByte;

    if (videoElement) {
      startAudioFrom(videoElement.currentTime);
      if (videoElement.paused) audioCtx.suspend().catch(() => {});
    }

    void prefetchNextChunk();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    console.error('[VOT] next chunk error:', err);
    void stopTranslation();
  } finally {
    isLoadingChunk = false;
  }
}

function getFileSize(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('HEAD', url, true);
    xhr.timeout = 10_000;
    xhr.onload = () => {
      const size = parseInt(xhr.getResponseHeader('Content-Length') ?? '0', 10);
      resolve(Number.isNaN(size) ? 0 : size);
    };
    xhr.onerror = () => resolve(0);
    xhr.ontimeout = () => resolve(0);
    const onAbort = () => {
      xhr.abort();
      resolve(0);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => signal.removeEventListener('abort', onAbort);
    xhr.send();
  });
}

async function prefetchNextChunk() {
  if (prefetchedChunk !== null || prefetchPromise !== null) return;
  if (!currentAudioUrl || !abortController) return;
  if (currentChunkEndByte >= currentFileSize - RANGE_ALIGN_BYTES) return;

  const myGeneration = ++prefetchGeneration;
  const { signal } = abortController;
  const startByte = currentChunkEndByte;
  const endByte = Math.min(
    currentFileSize - 1,
    startByte + AUDIO_CHUNK_BYTES - 1
  );

  const promise = fetchRangedChunk(
    currentAudioUrl,
    signal,
    startByte,
    endByte,
    currentFileSize
  );
  prefetchPromise = promise;

  try {
    const chunk = await promise;
    if (
      !signal.aborted &&
      myGeneration === prefetchGeneration &&
      prefetchPromise === promise
    ) {
      prefetchedChunk = chunk;
      prefetchPromise = null;
    }
  } catch {
    if (prefetchPromise === promise) prefetchPromise = null;
  }
}

/**
 * Fetch and activate the chunk covering seekTime, then start playback from
 * the current video position. Single entry point for every "audio must jump
 * somewhere outside the loaded chunk" case: user seeks, SponsorBlock/adblock
 * skips, drift corrections landing out of range.
 */
async function loadChunkAt(seekTime: number) {
  if (!audioCtx || !videoElement || !currentAudioUrl || !abortController)
    return;

  seekAbortController?.abort();
  const localSeekVersion = ++seekVersion;

  prefetchedChunk = null;
  prefetchPromise = null;
  prefetchGeneration++;

  stopAudioSource();

  const seekCtrl = new AbortController();
  seekAbortController = seekCtrl;
  const { startByte, endByte } = calcChunkRange(
    seekTime,
    currentVideoDuration,
    currentFileSize
  );

  try {
    const chunk = await fetchRangedChunk(
      currentAudioUrl,
      seekCtrl.signal,
      startByte,
      endByte,
      currentFileSize
    );
    if (
      seekCtrl.signal.aborted ||
      !audioCtx ||
      !videoElement ||
      seekVersion !== localSeekVersion
    )
      return;
    audioBuffer = chunk.buffer;
    audioBufferStartTime = chunk.bufferStartTime;
    currentChunkEndByte = chunk.endByte;
    startAudioFrom(videoElement.currentTime);
    if (videoElement.paused) audioCtx.suspend().catch(() => {});
    void prefetchNextChunk();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    console.error('[VOT] seek chunk error:', err);
  } finally {
    if (seekAbortController === seekCtrl) seekAbortController = null;
  }
}

function attachVideoListeners() {
  if (!videoElement || !audioCtx) return;
  const el = videoElement;

  // Drift correction must stay quiet mid-seek and while a chunk fetch is
  // in flight — correcting then restarts audio from a stale chunk
  const driftCheckAllowed = () =>
    !!audioCtx &&
    !!videoElement &&
    shouldRunDriftCheck({
      ctxRunning: audioCtx.state === 'running',
      paused: videoElement.paused,
      seeking: videoElement.seeking,
      seekPending: seekAbortController !== null
    });

  const correctDriftIfNeeded = () => {
    if (!driftCheckAllowed() || !videoElement) return;
    const drift = Math.abs(getAudioCurrentTime() - videoElement.currentTime);
    if (drift > SYNC_DRIFT_THRESHOLD_S) {
      startAudioFrom(videoElement.currentTime);
    }
  };

  const onPlay = () => {
    if (!audioCtx || !videoElement) return;
    if (currentManager && currentManager.playerMode !== PlayerMode.NORMAL)
      return;
    if (audioCtx.state === 'suspended') {
      audioCtx
        .resume()
        .then(() => correctDriftIfNeeded())
        .catch(() => {});
      return;
    }
    correctDriftIfNeeded();
  };

  const onPause = () => {
    audioCtx?.suspend().catch(() => {});
  };

  const onStop = () => {
    void stopTranslation();
  };

  const onSeeked = () => {
    if (!audioCtx || !videoElement || !currentAudioUrl || !abortController)
      return;

    const seekTime = videoElement.currentTime;

    if (
      audioBuffer &&
      resolveSyncAction(
        seekTime,
        audioBufferStartTime,
        audioBuffer.duration
      ) === 'play-offset'
    ) {
      // Seek within the current chunk: keep the prefetched next chunk —
      // resetting it would re-download the same byte range on every seek
      seekAbortController?.abort();
      seekAbortController = null;
      seekVersion++;
      startAudioFrom(seekTime);
      if (videoElement.paused) audioCtx.suspend().catch(() => {});
      void prefetchNextChunk();
      return;
    }

    void loadChunkAt(seekTime);
  };

  const onRateChange = () => {
    if (audioSource && videoElement) {
      audioSource.playbackRate.value = videoElement.playbackRate;
    }
  };

  const syncId = setInterval(correctDriftIfNeeded, 5000);
  syncIntervalId = syncId;

  el.addEventListener('play', onPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('ended', onStop);
  el.addEventListener('emptied', onStop);
  el.addEventListener('seeked', onSeeked);
  el.addEventListener('ratechange', onRateChange);

  videoListenerCleanup = () => {
    el.removeEventListener('play', onPlay);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('ended', onStop);
    el.removeEventListener('emptied', onStop);
    el.removeEventListener('seeked', onSeeked);
    el.removeEventListener('ratechange', onRateChange);
    clearInterval(syncId);
    syncIntervalId = null;
  };
}

function reduceOriginalVolume() {
  if (!videoElement) return;
  originalVolume = videoElement.volume;
  videoElement.volume = originalVolume * originalVolumeReduction;
}

function restoreOriginalVolume() {
  if (videoElement && originalVolume !== null) {
    videoElement.volume = originalVolume;
  }
  originalVolume = null;
}

export function setVolumeTranslation(volume: number) {
  if (gainNode) {
    gainNode.gain.value = Math.min(1, Math.max(0, volume));
  }
}

export function setOriginalVolumeReduction(factor: number) {
  originalVolumeReduction = Math.min(1, Math.max(0, factor));
  if (originalVolume !== null && videoElement) {
    videoElement.volume = originalVolume * originalVolumeReduction;
  }
}

export function setStatusCallback(cb: StatusChangeCallback) {
  statusCallback = cb;
}

// Translated-audio URLs stay valid ~2h (same TTL the VOT userscript uses);
// caching them locally makes re-opening a translated video instant
const TRANSLATION_URL_TTL_MS = 2 * 60 * 60 * 1000;
const TRANSLATION_CACHE_KEY = 'ytaf-vot-url-cache';
const TRANSLATION_CACHE_MAX = 30;

type CachedUrl = { url: string; expiresAt: number };

function readUrlCache(): Record<string, CachedUrl> {
  try {
    const raw = window.localStorage.getItem(TRANSLATION_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CachedUrl>) : {};
  } catch {
    return {};
  }
}

function writeUrlCache(cache: Record<string, CachedUrl>) {
  try {
    const now = Date.now();
    let entries = Object.entries(cache).filter(([, v]) => v.expiresAt > now);
    if (entries.length > TRANSLATION_CACHE_MAX) {
      entries.sort((a, b) => b[1].expiresAt - a[1].expiresAt);
      entries = entries.slice(0, TRANSLATION_CACHE_MAX);
    }
    window.localStorage.setItem(
      TRANSLATION_CACHE_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // localStorage full/unavailable — cache is best-effort
  }
}

function getCachedTranslationUrl(key: string): string | null {
  const entry = readUrlCache()[key];
  return entry && entry.expiresAt > Date.now() ? entry.url : null;
}

function putCachedTranslationUrl(key: string, url: string) {
  const cache = readUrlCache();
  cache[key] = { url, expiresAt: Date.now() + TRANSLATION_URL_TTL_MS };
  writeUrlCache(cache);
}

function dropCachedTranslationUrl(key: string) {
  const cache = readUrlCache();
  delete cache[key];
  writeUrlCache(cache);
}

export function isTranslationActive(): boolean {
  return audioCtx !== null;
}

export function isTranslationInProgress(): boolean {
  return abortController !== null;
}

export async function startTranslation(videoId: VideoID, _isRestart = false) {
  console.log('[VOT] startTranslation called with', videoId);

  const myGeneration = ++translationGeneration;

  lastErrorVideoId = null;
  if (!_isRestart) serverRestartCount = 0;

  if (
    currentVideoId === videoId &&
    (audioCtx !== null || abortController !== null)
  ) {
    console.log('[VOT] early return: already running for this video');
    return;
  }

  await stopTranslation();

  if (translationGeneration !== myGeneration) return;

  currentVideoId = videoId;
  abortController = new AbortController();
  const { signal } = abortController;

  setStatus('loading');
  console.log('[VOT] status set to loading, calling translateVideo');

  try {
    const toLang = configRead('votToLang');
    const lively: boolean = configRead('votLivelyVoice');
    // Lively voice is en->ru only and the server ignores it when the source
    // language is 'auto', so force 'en' when lively is requested
    const fromLang =
      lively && configRead('votFromLang') === 'auto'
        ? 'en'
        : configRead('votFromLang');
    console.log('[VOT] langs:', fromLang, '->', toLang, 'lively:', lively);

    const cacheKey = `${videoId}_${fromLang}_${toLang}_${lively}`;

    const requestTranslationUrl = async (): Promise<string | null> => {
      const rawDuration = getVideoElement()?.duration;
      const result = await translateVideo(
        videoId,
        fromLang,
        toLang,
        // duration is NaN until video metadata loads — NaN passes `??`
        rawDuration !== undefined && Number.isFinite(rawDuration)
          ? rawDuration
          : 343,
        signal,
        (remainingTime, message, isRetry) => {
          if (isRetry) {
            stopCountdown();
            setStatus('retrying');
            return;
          }
          if (message === 'lively-fallback') {
            stopCountdown();
            setStatus('waiting', 'lively N/A → standard voice');
            return;
          }
          if (message && message.startsWith('upload')) {
            stopCountdown();
            setStatus('waiting', message);
            return;
          }
          startCountdown(remainingTime);
        },
        lively,
        String(configRead('votAccountToken') ?? '')
      );

      stopCountdown();
      if (signal.aborted) return null;

      if (!result.translated || !result.url) {
        setStatus('error', 'Translation not available');
        return null;
      }
      // Cache under the voice actually delivered: a lively request that
      // fell back to the standard voice must not poison the lively slot
      putCachedTranslationUrl(
        `${videoId}_${fromLang}_${toLang}_${result.usedLivelyVoice}`,
        result.url
      );
      // Surface which voice the server actually returned — the only
      // reliable signal on the TV that lively did or didn't take
      setStatus(
        'waiting',
        result.usedLivelyVoice ? 'lively voice' : 'standard voice'
      );
      return result.url;
    };

    let fromCache = false;
    let audioUrl = lively ? null : getCachedTranslationUrl(cacheKey);
    if (audioUrl) {
      fromCache = true;
      console.log('[VOT] using cached translation URL');
    } else {
      audioUrl = await requestTranslationUrl();
      if (!audioUrl) return;
    }

    videoElement = getVideoElement();
    if (!videoElement) {
      setStatus('error', 'Video element not found');
      return;
    }

    console.log('[VOT] creating AudioContext...');
    audioCtx = createAudioContext();
    console.log('[VOT] AudioContext created, state:', audioCtx.state);

    gainNode = audioCtx.createGain();
    gainNode.gain.value = configRead('votTranslationVolume');
    gainNode.connect(audioCtx.destination);

    setStatus('loading');

    const videoDuration = videoElement.duration || 0;
    const videoTime = videoElement.currentTime;

    console.log('[VOT] fetching file size...');
    let fileSize = await getFileSize(audioUrl, signal);
    console.log('[VOT] file size:', fileSize);

    if (signal.aborted) return;

    if (fileSize === 0 && fromCache) {
      // Cached URL expired server-side — request a fresh one
      console.warn('[VOT] cached translation URL is stale, re-requesting');
      dropCachedTranslationUrl(cacheKey);
      audioUrl = await requestTranslationUrl();
      if (!audioUrl) return;
      fileSize = await getFileSize(audioUrl, signal);
      if (signal.aborted) return;
    }

    const { startByte, endByte } = calcChunkRange(
      videoTime,
      videoDuration,
      fileSize
    );
    const chunk = await fetchRangedChunk(
      audioUrl,
      signal,
      startByte,
      endByte,
      fileSize
    );

    if (signal.aborted) return;

    audioBuffer = chunk.buffer;
    audioBufferStartTime = chunk.bufferStartTime;
    currentAudioUrl = audioUrl;
    currentFileSize = fileSize;
    currentVideoDuration = videoDuration;
    currentChunkEndByte = chunk.endByte;

    reduceOriginalVolume();
    attachVideoListeners();

    await audioCtx.resume();
    startAudioFrom(videoElement.currentTime);

    if (videoElement.paused) {
      audioCtx.suspend().catch(() => {});
    }

    void prefetchNextChunk();

    serverRestartCount = 0;
    setStatus('playing');
  } catch (err) {
    // Superseded by a newer start/stop: shared state (currentVideoId,
    // abortController) already belongs to the next translation — don't
    // stop it or restart on our stale error
    if (signal.aborted) return;
    if (err instanceof Error && err.name === 'AbortError') return;

    const failedId = currentVideoId;
    const needsRestart =
      err instanceof Error && err.name === 'ServerRestartNeeded';
    await stopTranslation();

    if (
      needsRestart &&
      failedId &&
      configRead('enableVot') &&
      serverRestartCount < MAX_SERVER_RESTARTS
    ) {
      serverRestartCount++;
      console.log(
        '[VOT] server restart attempt',
        serverRestartCount,
        'of',
        MAX_SERVER_RESTARTS
      );
      setStatus('loading');
      await startTranslation(failedId, true);
      return;
    }

    serverRestartCount = 0;
    lastErrorVideoId = failedId;
    console.error('[VOT]', err);
    setStatus('error', err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function stopTranslation() {
  abortController?.abort();
  abortController = null;

  stopCountdown();

  videoListenerCleanup?.();
  videoListenerCleanup = null;

  if (syncIntervalId !== null) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }

  prefetchedChunk = null;
  prefetchPromise = null;

  seekAbortController?.abort();
  seekAbortController = null;

  if (audioSource) {
    audioSource.onended = null;
    try {
      audioSource.stop();
    } catch {}
    audioSource.disconnect();
    audioSource = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  gainNode = null;
  audioBuffer = null;
  audioBufferStartTime = 0;
  audioPlayCtxStart = 0;
  audioPlayVideoStart = 0;
  currentAudioUrl = null;
  currentFileSize = 0;
  currentVideoDuration = 0;
  currentChunkEndByte = 0;
  isLoadingChunk = false;
  seekVersion = 0;

  restoreOriginalVolume();
  currentVideoId = null;
  videoElement = null;
  setStatus('idle');
}

function isSameLanguageVideo(manager: PlayerManager): boolean {
  const toLang = configRead('votToLang');
  const fromLang = configRead('votFromLang');

  if (fromLang !== 'auto' && fromLang === toLang) return true;

  const videoData = manager.player.getVideoData();

  const rawLang = videoData.defaultAudioLanguage;
  if (rawLang) {
    const videoLang = rawLang.split('-')[0]?.toLowerCase() ?? '';
    if (videoLang === toLang) return true;
  }

  const firstTrackLang = videoData.audioTracks?.[0]?.language
    ?.split('-')[0]
    ?.toLowerCase();
  return firstTrackLang === toLang;
}

export function setManuallyStopped(videoId: VideoID | null) {
  manuallyStoppedVideoId = videoId;
}

let votTranslationInitialized = false;

export async function initVotTranslation() {
  if (votTranslationInitialized) return;
  votTranslationInitialized = true;

  // The PlayerManager 'noVideo' event does not fire when the user closes
  // the watch page (the player emits no state change), so a translation
  // stuck in Waiting kept polling/uploading forever. The reliable signal is
  // the WEB_PAGE_TYPE_WATCH class on <body> (upstream screensaver-fix uses
  // the same) — when it disappears while a translation is running, stop.
  const WATCH_CLASS = 'WEB_PAGE_TYPE_WATCH';
  let leftWatchTimer: ReturnType<typeof setTimeout> | null = null;
  const bodyClassObs = new MutationObserver(() => {
    if (document.body.classList.contains(WATCH_CLASS)) {
      if (leftWatchTimer !== null) {
        clearTimeout(leftWatchTimer);
        leftWatchTimer = null;
      }
      return;
    }
    if (!isTranslationActive() && !isTranslationInProgress()) return;
    if (leftWatchTimer !== null) return;
    // Debounce: page-transition flicker must not kill an active translation
    leftWatchTimer = setTimeout(() => {
      leftWatchTimer = null;
      if (
        !document.body.classList.contains(WATCH_CLASS) &&
        (isTranslationActive() || isTranslationInProgress())
      ) {
        console.log('[VOT] left watch page — stopping translation');
        void stopTranslation();
      }
    }, 1500);
  });
  bodyClassObs.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });

  const manager = await getPlayerManager();
  currentManager = manager;
  let noVideoTimer: ReturnType<typeof setTimeout> | null = null;

  manager.addEventListener('newVideo', async (evt) => {
    const videoId = evt.detail;

    if (noVideoTimer !== null) {
      clearTimeout(noVideoTimer);
      noVideoTimer = null;
    }

    if (
      videoId === currentVideoId &&
      (audioCtx !== null || abortController !== null)
    ) {
      if (
        audioCtx?.state === 'suspended' &&
        videoElement &&
        !videoElement.paused
      ) {
        const ctx = audioCtx;
        ctx
          .resume()
          .then(() => {
            if (audioCtx !== ctx || !videoElement) return;
            const drift = Math.abs(
              getAudioCurrentTime() - videoElement.currentTime
            );
            if (drift > SYNC_DRIFT_THRESHOLD_S)
              startAudioFrom(videoElement.currentTime);
          })
          .catch(() => {});
      }
      return;
    }

    if (manuallyStoppedVideoId !== null && videoId !== manuallyStoppedVideoId) {
      manuallyStoppedVideoId = null;
    }

    if (!configRead('enableVot')) {
      await stopTranslation();
      return;
    }

    if (manager.playerMode !== PlayerMode.NORMAL) {
      await stopTranslation();
      return;
    }

    if (videoId === lastErrorVideoId) return;
    if (videoId === manuallyStoppedVideoId) return;

    if (isSameLanguageVideo(manager)) return;

    await startTranslation(videoId);
  });

  manager.addEventListener('noVideo', () => {
    if (noVideoTimer !== null) clearTimeout(noVideoTimer);
    audioCtx?.suspend().catch(() => {});

    const debounceMs = isTranslationActive() ? 2000 : 5000;
    noVideoTimer = setTimeout(async () => {
      noVideoTimer = null;
      if (isTranslationInProgress() && !isTranslationActive()) {
        lastErrorVideoId = currentVideoId;
      }
      await stopTranslation();
    }, debounceMs);
  });
}
