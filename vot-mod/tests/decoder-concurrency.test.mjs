import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { decodeMp3 } from '../src/vot/cobalt-audio.js';

function fixture(name) {
  return new Uint8Array(
    fs.readFileSync(
      new URL(`fixtures/audio-stutter/${name}.mp3`, import.meta.url)
    )
  ).buffer;
}

function sameAudio(actual, expected) {
  assert.equal(actual.length, expected.length, 'channel count');
  actual.forEach((samples, channel) => {
    assert.equal(
      samples.length,
      expected[channel].length,
      `channel ${channel} sample count`
    );
    assert.ok(
      samples.every((value, index) => value === expected[channel][index]),
      `channel ${channel} PCM differs`
    );
  });
}

test('overlapping MP3 decodes preserve every sample of both audio chunks', async () => {
  const inputs = [fixture('tone-440'), fixture('tone-880')];
  const expected = [
    await decodeMp3(inputs[0], 48000),
    await decodeMp3(inputs[1], 48000)
  ];
  const actual = await Promise.all(
    inputs.map((data) => decodeMp3(data, 48000))
  );
  actual.forEach((channels, index) => sameAudio(channels, expected[index]));
});

test('a rejected MP3 decode does not poison the queued valid audio chunk', async () => {
  const input = fixture('tone-440');
  const expected = await decodeMp3(input, 48000);
  const failure = assert.rejects(
    decodeMp3(new Uint8Array(4096).fill(7).buffer, 48000),
    /mp3 decode failed/
  );
  const good = decodeMp3(input, 48000);
  await failure;
  sameAudio(await good, expected);
});

test('an exception in a later decoding slice frees its allocation and releases the queue', async () => {
  const heap = new ArrayBuffer(8192);
  const module = {
    HEAPU8: new Uint8Array(heap),
    HEAP16: new Int16Array(heap),
    HEAP32: new Int32Array(heap)
  };
  const allocations = [],
    freed = [];
  let initialized = 0,
    frame = 0,
    fail = false;
  Object.assign(module, {
    _malloc() {
      const pointer = 512 + allocations.length * 128;
      allocations.push(pointer);
      return pointer;
    },
    _free(pointer) {
      freed.push(pointer);
    },
    _mp3_init() {
      frame = 0;
      fail = false;
    },
    _mp3_decode(pointer) {
      if (frame === 0) fail = module.HEAPU8[pointer] === 1;
      if (++frame === 26 && fail) throw new Error('synthetic decoder failure');
      module.HEAP32.set([1, 1, 48000], 8);
      module.HEAP16[128] = 1024;
      return 1;
    },
    _mp3_frame() {
      return 8 * 4;
    },
    _mp3_pcm() {
      return 128 * 2;
    }
  });
  const source = fs
    .readFileSync(
      new URL('../src/vot/cobalt-audio.js', import.meta.url),
      'utf8'
    )
    .replace(/^import createMinimp3.*;\s*/m, '')
    .replace(/^export /gm, '');
  const sandbox = {
    createMinimp3() {
      initialized++;
      return Promise.resolve(module);
    },
    Uint8Array,
    Float32Array,
    Promise,
    Error,
    setTimeout,
    console
  };
  vm.runInNewContext(source + '\nthis.decode = decodeMp3;', sandbox);
  const rejected = assert.rejects(
    sandbox.decode(new Uint8Array(60).fill(1).buffer, 48000),
    /synthetic decoder failure/
  );
  const good = sandbox.decode(new Uint8Array(60).fill(2).buffer, 48000);
  await rejected;
  assert.equal((await good)[0].length, 60);
  assert.equal(initialized, 1);
  assert.deepEqual(freed, allocations);
});
