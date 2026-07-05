/**
 * Pure decision logic for keeping the translation audio in sync with the
 * video. No DOM / Web Audio here — everything is unit-testable in Node
 * (vot-mod/tests/sync-core.test.mjs), so seek/skip regressions are caught
 * without a TV.
 */

export const AUDIO_CHUNK_BYTES = 512 * 1024;
export const RANGE_ALIGN_BYTES = 32 * 1024;
export const SYNC_DRIFT_THRESHOLD_S = 3;
// A scheduled tail shorter than this ends almost instantly, chaining
// onended -> next chunk -> repeat: the audible "looping" bug
export const MIN_PLAYABLE_TAIL_S = 0.05;

/**
 * @param {number} videoTime
 * @param {number} chunkStartTime
 * @param {number} chunkDuration
 * @returns {boolean} true when videoTime lies inside the loaded chunk and
 *   far enough from its end to be worth playing
 */
export function isTimeInChunk(videoTime, chunkStartTime, chunkDuration) {
  if (!(chunkDuration > 0)) return false;
  const offset = videoTime - chunkStartTime;
  return offset >= 0 && offset < chunkDuration - MIN_PLAYABLE_TAIL_S;
}

/**
 * Decide how to sync audio to the given video position.
 * 'play-offset' — the loaded chunk covers it, start the source at offset;
 * 'load-chunk'  — position is outside the chunk (e.g. SponsorBlock/adblock
 *                 skipped past it), the correct chunk must be fetched.
 * @param {number} videoTime
 * @param {number} chunkStartTime
 * @param {number} chunkDuration
 * @returns {'play-offset' | 'load-chunk'}
 */
export function resolveSyncAction(videoTime, chunkStartTime, chunkDuration) {
  return isTimeInChunk(videoTime, chunkStartTime, chunkDuration)
    ? 'play-offset'
    : 'load-chunk';
}

/**
 * Drift correction must stay quiet while a seek is being processed: during
 * `video.seeking` currentTime has already jumped but `seeked` hasn't fired,
 * and while a chunk fetch is in flight the drift is expected. Correcting at
 * those moments restarts audio from a stale chunk and used to cause loops.
 * @param {{ctxRunning: boolean, paused: boolean, seeking: boolean,
 *          seekPending: boolean}} state
 * @returns {boolean}
 */
export function shouldRunDriftCheck(state) {
  return (
    state.ctxRunning && !state.paused && !state.seeking && !state.seekPending
  );
}

/**
 * Byte range of the chunk covering videoTime (CBR approximation).
 * @param {number} videoTime
 * @param {number} videoDuration
 * @param {number} fileSize
 * @returns {{startByte: number, endByte: number}}
 */
export function calcChunkRange(videoTime, videoDuration, fileSize) {
  let startByte = 0;
  if (fileSize > AUDIO_CHUNK_BYTES && videoDuration > 0) {
    const approxByte = Math.floor((videoTime / videoDuration) * fileSize);
    startByte = Math.max(0, approxByte - RANGE_ALIGN_BYTES);
  }
  const endByte =
    fileSize > 0
      ? Math.min(fileSize - 1, startByte + AUDIO_CHUNK_BYTES - 1)
      : startByte + AUDIO_CHUNK_BYTES - 1;
  return { startByte, endByte };
}
