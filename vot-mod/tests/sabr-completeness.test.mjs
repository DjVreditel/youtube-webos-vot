import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as core from '../src/vot/sabr-core.js';

const v = (num, value) => ({ num, wire: 0, value });
const b = (num, value) => ({ num, wire: 2, value });
const videoId = 'abcdefghijk';
function media(num, start, duration, init = false) {
  const header = core.encodeFields([
    v(1, 1), b(2, new TextEncoder().encode(videoId)), v(3, 140),
    v(8, Number(init)), v(9, num), v(11, start), v(12, duration),
  ]);
  // Each fixture part is short enough for the one-byte UMP length encoding.
  return [20, header.length, ...header, 21, 2, 1, init ? 99 : num, 22, 1, 1];
}
function downloader(responses, { abortOnFetch = 0 } = {}) {
  const controller = new AbortController();
  let calls = 0;
  class FakeXHR { open() {} send() {} }
  const sandbox = {
    exports: {}, require: () => core, Uint8Array, ArrayBuffer,
    TextEncoder, TextDecoder, console, setTimeout, XMLHttpRequest: FakeXHR,
    window: { fetch: async () => {
      calls++;
      if (calls === abortOnFetch) controller.abort();
      const response = responses[calls - 1] ?? [];
      return { ok: true, arrayBuffer: async () => new Uint8Array(response).buffer };
    } },
  };
  const source = fs.readFileSync(process.env.VOT_SABR_SOURCE || new URL('../src/vot/sabr.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText, sandbox);
  sandbox.exports.installSabrCapture();
  const xhr = new FakeXHR();
  xhr.open('POST', 'https://example.test/videoplayback?sabr=1&id=target&rn=1');
  xhr.send(core.encodeFields([v(23, 140), b(16, core.encodeFields([v(1, 140)]))]));
  return {
    controller, calls: () => calls,
    run: () => sandbox.exports.downloadAudioViaSabr(videoId, 60_000, controller.signal),
  };
}

test('incomplete audio followed by three empty responses is rejected', async () => {
  const d = downloader([[...media(0, 0, 0, true), ...media(1, 0, 10_000)]]);
  await assert.rejects(d.run(), /incomplete audio/i);
  assert.equal(d.calls(), 4);
});

test('a later segment reaching the end does not conceal a missing middle segment', async () => {
  const d = downloader([[...media(0, 0, 0, true), ...media(1, 0, 10_000), ...media(3, 50_000, 10_000)]]);
  await assert.rejects(d.run(), /incomplete audio/i);
});

test('consecutive segment numbers cannot conceal a timestamp gap', async () => {
  const d = downloader([[...media(0, 0, 0, true), ...media(1, 0, 10_000), ...media(2, 20_000, 40_000)]]);
  await assert.rejects(d.run(), /incomplete audio/i);
});

test('complete audio tolerates small initial offset and segment rounding', async () => {
  const d = downloader([[...media(0, 0, 0, true), ...media(1, 25, 29_975), ...media(2, 30_020, 29_950)]]);
  assert.deepEqual(Array.from(await d.run()), [99, 1, 2]);
  assert.equal(d.calls(), 1);
});

test('repeated old segments cannot turn an incomplete download into success', async () => {
  const initial = [...media(0, 0, 0, true), ...media(1, 0, 10_000)];
  const d = downloader([initial, ...Array.from({ length: 400 }, () => media(1, 0, 10_000))]);
  await assert.rejects(d.run(), /incomplete audio/i);
  assert.equal(d.calls(), 4);
});

test('cancellation during a response is preserved even when it contains complete audio', async () => {
  const d = downloader([[...media(0, 0, 0, true), ...media(1, 0, 60_000)]], { abortOnFetch: 1 });
  await assert.rejects(d.run(), /aborted/i);
  assert.equal(d.calls(), 1);
});

test('request limit cannot return a steadily progressing but incomplete source', async () => {
  const responses = Array.from({ length: 400 }, (_, i) => media(i + 1, i * 100, 100));
  responses[0] = [...media(0, 0, 0, true), ...responses[0]];
  const d = downloader(responses);
  await assert.rejects(d.run(), /incomplete audio/i);
  assert.equal(d.calls(), 400);
});

test('an out-of-order segment is accepted once a later response fills the gap', async () => {
  const d = downloader([
    [...media(0, 0, 0, true), ...media(1, 0, 10_000), ...media(3, 50_000, 10_000)],
    media(2, 10_000, 40_000),
  ]);
  assert.deepEqual(Array.from(await d.run()), [99, 1, 2, 3]);
  assert.equal(d.calls(), 2);
});
