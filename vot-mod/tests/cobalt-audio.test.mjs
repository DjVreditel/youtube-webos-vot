import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsAudioShim, wrapAudioContext, resample, decodeMp3 } from '../src/vot/cobalt-audio.js';

const RATE = 48000;

function decodedBuffer(seconds) {
  return { length: seconds * RATE, __ytafChannels: [new Float32Array(seconds * RATE)] };
}

function fakeNative() {
  const native = {
    currentTime: 0,
    sampleRate: RATE,
    destination: {},
    starts: [],
    createBuffer(channels, length) {
      return { length, copyToChannel() {} };
    },
    createBufferSource() {
      const source = {
        stopped: false,
        connect() {},
        disconnect() {},
        start(when, offset) {
          assert.equal(offset, undefined);
          native.starts.push(source.buffer.length / RATE);
        },
        stop() {
          source.stopped = true;
        }
      };
      native.last = source;
      return source;
    }
  };
  return native;
}

test('resample interpolates to the target rate', () => {
  const output = resample(new Float32Array([0, 1, 0, -1]), 2, 4);
  assert.equal(output.length, 8);
  assert.equal(output[1], 0.5);
  assert.equal(resample(new Float32Array([1]), 3, 3).length, 1);
});

test('garbage input is rejected instead of producing a silent buffer', async () => {
  await assert.rejects(decodeMp3(new Uint8Array(4096).fill(7).buffer, RATE));
});

test('only contexts without suspend or gain need the shim', () => {
  assert.equal(needsAudioShim({ suspend() {}, createGain() {} }), false);
  assert.equal(needsAudioShim({ createGain() {} }), true);
});

test('offsets become trimmed buffers, pause freezes the clock and resume continues', async () => {
  const native = fakeNative();
  const context = wrapAudioContext(native, () => native.currentTime, 0);
  const source = context.createBufferSource();
  source.buffer = decodedBuffer(20);
  source.start(0, 10);
  native.currentTime = 4;
  await context.suspend();
  assert.equal(context.state, 'suspended');
  assert.ok(native.last.stopped);
  native.currentTime = 30;
  assert.equal(context.currentTime, 4);
  await context.resume();
  assert.equal(context.currentTime, 4);
  assert.deepEqual(native.starts, [10, 6]);
});

test('a source started while suspended begins on resume', async () => {
  const native = fakeNative();
  const context = wrapAudioContext(native, () => native.currentTime, 0);
  await context.suspend();
  const source = context.createBufferSource();
  source.buffer = decodedBuffer(20);
  source.start(0, 3);
  assert.deepEqual(native.starts, []);
  await context.resume();
  assert.deepEqual(native.starts, [17]);
});

test('natural end calls onended once, a manual stop does not', () => {
  const native = fakeNative();
  const context = wrapAudioContext(native, () => native.currentTime, 0);
  let ended = 0;
  const source = context.createBufferSource();
  source.buffer = decodedBuffer(5);
  source.onended = () => ended++;
  source.start(0, 0);
  native.last.onended();
  assert.equal(ended, 1);
  const other = context.createBufferSource();
  other.buffer = decodedBuffer(5);
  other.onended = () => ended++;
  other.start(0, 0);
  other.stop();
  assert.equal(ended, 1);
});

test('gain scales the samples and a change restarts at the current position', () => {
  const native = fakeNative();
  const copied = [];
  native.createBuffer = (channels, length) => ({ length, copyToChannel: (samples) => copied.push(samples) });
  const context = wrapAudioContext(native, () => native.currentTime, 0);
  const gain = context.createGain();
  gain.gain.value = 0.5;
  const source = context.createBufferSource();
  source.buffer = { length: 4 * RATE, __ytafChannels: [new Float32Array(4 * RATE).fill(1)] };
  source.start(0, 0);
  assert.equal(copied.at(-1)[0], 0.5);
  native.currentTime = 1;
  gain.gain.value = 0.25;
  assert.equal(copied.at(-1)[0], 0.25);
  assert.equal(copied.at(-1).length, 3 * RATE);
  assert.equal(gain.gain.value, 0.25);
});

test('a trimmed start is prepared ahead and the old source stops only once it begins', async () => {
  const native = fakeNative();
  const sources = [];
  const create = native.createBufferSource;
  native.createBufferSource = () => {
    const source = create();
    sources.push(source);
    return source;
  };
  let time = 0;
  const context = wrapAudioContext(native, () => time, 0.03);
  const first = context.createBufferSource();
  first.buffer = decodedBuffer(20);
  first.start(0, 0);
  assert.deepEqual(native.starts, [20]);
  const second = context.createBufferSource();
  second.buffer = decodedBuffer(20);
  second.start(0, 2);
  first.stop();
  assert.equal(sources[0].stopped, false);
  assert.deepEqual(native.starts, [20]);
  time = 0.03;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(native.starts[1].toFixed(2), '17.97');
  assert.equal(sources[0].stopped, true);
  assert.equal(context.currentTime, 0.03);
});

test('a late start is replaced by one at the right position without a gap', async () => {
  const native = fakeNative();
  const sources = [];
  const create = native.createBufferSource;
  native.createBufferSource = () => {
    const source = create();
    sources.push(source);
    return source;
  };
  let time = 0;
  const context = wrapAudioContext(native, () => time, 0.03);
  const source = context.createBufferSource();
  source.buffer = decodedBuffer(20);
  source.start(0, 2);
  time = 0.1;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(native.starts.length, 1);
  assert.equal(sources[0].stopped, false);
  time = 0.13;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(native.starts[1].toFixed(2), '17.87');
  assert.equal(sources[0].stopped, true);
  assert.equal(sources[1].stopped, false);
});
