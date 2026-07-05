import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_CHUNK_BYTES,
  RANGE_ALIGN_BYTES,
  MIN_PLAYABLE_TAIL_S,
  isTimeInChunk,
  resolveSyncAction,
  shouldRunDriftCheck,
  calcChunkRange
} from '../src/vot/sync-core.js';

// Typical chunk: starts at 100s, ~32.8s of decoded audio
const START = 100;
const DUR = 32.8;

test('in-chunk position plays at offset', () => {
  assert.equal(resolveSyncAction(110, START, DUR), 'play-offset');
  assert.equal(resolveSyncAction(START, START, DUR), 'play-offset');
});

test('SponsorBlock skip far past the chunk must load a new chunk (loop bug)', () => {
  // The original bug: 250s with a 100..132.8s chunk got clamped to the
  // last 0.1s of the chunk and chained into an audible loop
  assert.equal(resolveSyncAction(250, START, DUR), 'load-chunk');
});

test('seek before the chunk start must load a new chunk', () => {
  assert.equal(resolveSyncAction(50, START, DUR), 'load-chunk');
});

test('landing in the unplayable tail counts as out of chunk', () => {
  const nearEnd = START + DUR - MIN_PLAYABLE_TAIL_S / 2;
  assert.equal(resolveSyncAction(nearEnd, START, DUR), 'load-chunk');
});

test('exact chunk end is out of chunk', () => {
  assert.equal(resolveSyncAction(START + DUR, START, DUR), 'load-chunk');
});

test('empty/zero-duration chunk never plays', () => {
  assert.equal(isTimeInChunk(0, 0, 0), false);
  assert.equal(resolveSyncAction(0, 0, 0), 'load-chunk');
  assert.equal(resolveSyncAction(0, 0, NaN), 'load-chunk');
});

test('drift check runs only during normal playback', () => {
  const base = {
    ctxRunning: true,
    paused: false,
    seeking: false,
    seekPending: false
  };
  assert.equal(shouldRunDriftCheck(base), true);
});

test('drift check is muted mid-seek (adblock/SponsorBlock skip in flight)', () => {
  // Correcting while video.seeking restarted audio from the stale chunk
  assert.equal(
    shouldRunDriftCheck({
      ctxRunning: true,
      paused: false,
      seeking: true,
      seekPending: false
    }),
    false
  );
});

test('drift check is muted while a chunk fetch is pending', () => {
  assert.equal(
    shouldRunDriftCheck({
      ctxRunning: true,
      paused: false,
      seeking: false,
      seekPending: true
    }),
    false
  );
});

test('drift check is muted when paused or suspended', () => {
  assert.equal(
    shouldRunDriftCheck({
      ctxRunning: false,
      paused: false,
      seeking: false,
      seekPending: false
    }),
    false
  );
  assert.equal(
    shouldRunDriftCheck({
      ctxRunning: true,
      paused: true,
      seeking: false,
      seekPending: false
    }),
    false
  );
});

test('calcChunkRange: small file fits in one chunk from byte 0', () => {
  const { startByte, endByte } = calcChunkRange(10, 60, 100_000);
  assert.equal(startByte, 0);
  assert.equal(endByte, 99_999);
});

test('calcChunkRange: positions proportionally with alignment back-off', () => {
  const fileSize = 10 * AUDIO_CHUNK_BYTES;
  const { startByte, endByte } = calcChunkRange(300, 600, fileSize);
  const approx = Math.floor((300 / 600) * fileSize);
  assert.equal(startByte, approx - RANGE_ALIGN_BYTES);
  assert.equal(endByte, startByte + AUDIO_CHUNK_BYTES - 1);
});

test('calcChunkRange: never negative near time 0', () => {
  const { startByte } = calcChunkRange(0, 600, 10 * AUDIO_CHUNK_BYTES);
  assert.equal(startByte, 0);
});

test('calcChunkRange: clamps endByte at end of file', () => {
  const fileSize = 3 * AUDIO_CHUNK_BYTES;
  const { endByte } = calcChunkRange(599, 600, fileSize);
  assert.equal(endByte, fileSize - 1);
});

test('calcChunkRange: unknown duration falls back to file start', () => {
  const { startByte } = calcChunkRange(300, 0, 10 * AUDIO_CHUNK_BYTES);
  assert.equal(startByte, 0);
});
