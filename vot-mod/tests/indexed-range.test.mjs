import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_CHUNK_BYTES, RANGE_ALIGN_BYTES, calcChunkRange,
  calcIndexedChunkRange, mp3FrameIndex, mp3TimeAt
} from '../src/vot/sync-core.js';

// Valid MPEG-1 Layer III frame headers with a tenfold bitrate change. Payloads
// are synthetic zeros: these tests exercise the real index parser, not audio.
function vbrFile() {
  const frames = [];
  for (const [bitrate, header] of [[32, 0x10], [320, 0xe0]]) {
    for (let i = 0; i < 700; i++) {
      const frame = new Uint8Array(Math.floor(144000 * bitrate / 44100));
      frame.set([0xff, 0xfb, header, 0xc4]);
      frames.push(frame);
    }
  }
  const file = new Uint8Array(12 + frames.reduce((sum, frame) => sum + frame.length, 0));
  file.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0]);
  let offset = 12;
  for (const frame of frames) { file.set(frame, offset); offset += frame.length; }
  return file;
}

function covers(index, range, time) {
  return !!range && mp3TimeAt(index, range.startByte) <= time &&
    mp3TimeAt(index, range.endByte + 1) > time;
}

test('indexed seeking covers VBR targets that the proportional byte estimate misses', () => {
  const file = vbrFile(), index = mp3FrameIndex(file);
  assert.equal(index.offsets.length, 1400);
  assert.equal(covers(index, calcChunkRange(9, index.duration, file.length), 9), false);
  for (const time of [0, 9, 18, 27, 35, index.duration - 0.001]) {
    const range = calcIndexedChunkRange(index, time, file.length);
    assert.ok(covers(index, range, time), `range must cover ${time}s`);
    const startFrame = index.offsets.indexOf(range.startByte);
    assert.ok(startFrame >= 0, 'start is a complete frame');
    const targetFrame = index.times.findLastIndex(start => start <= time);
    assert.ok(index.offsets[targetFrame] - range.startByte <= RANGE_ALIGN_BYTES);
    assert.ok(range.startByte <= index.offsets[targetFrame]);
    assert.ok(range.endByte - range.startByte + 1 <= AUDIO_CHUNK_BYTES);
    assert.ok(range.endByte < file.length);
  }
});

test('indexed seeking uses audio time when the video duration is unknown or wrong', () => {
  const file = vbrFile(), index = mp3FrameIndex(file), target = 35;
  for (const duration of [0, NaN, 1000]) {
    assert.equal(covers(index, calcChunkRange(target, duration, file.length), target), false);
  }
  // No video-duration argument exists in the indexed path.
  assert.ok(covers(index, calcIndexedChunkRange(index, target, file.length), target));
});

test('indexed range respects first-frame metadata and clamps the end to the file', () => {
  const file = vbrFile(), index = mp3FrameIndex(file);
  assert.equal(calcIndexedChunkRange(index, 0, file.length).startByte, 12);
  assert.equal(calcIndexedChunkRange(index, index.duration - 0.001, file.length).endByte, file.length - 1);
  const tiny = { offsets: [12, 116], times: [0, 0.026], duration: 0.052 };
  assert.deepEqual(calcIndexedChunkRange(tiny, 0.03, 220), { startByte: 12, endByte: 219 });
});

test('invalid, empty and ended audio targets never replay the last chunk', () => {
  const index = { offsets: [0, 100], times: [0, 1], duration: 2 };
  for (const time of [-1, NaN, Infinity, 2, 3]) {
    assert.equal(calcIndexedChunkRange(index, time, 200), null);
  }
  assert.equal(calcIndexedChunkRange({ offsets: [], times: [], duration: 0 }, 0, 200), null);
  assert.equal(calcIndexedChunkRange({ ...index, times: [0] }, 0, 200), null);
  for (const size of [0, -1, NaN, Infinity, 3.5]) {
    assert.equal(calcIndexedChunkRange(index, 0, size), null);
  }
  assert.equal(calcIndexedChunkRange(index, 1.5, 50), null);
});
