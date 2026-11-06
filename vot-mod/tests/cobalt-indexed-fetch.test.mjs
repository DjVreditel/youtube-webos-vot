import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as sync from '../src/vot/sync-core.js';

function chunks() {
  const index = { offsets: Array.from({ length: 800 }, (_, i) => i * 1000),
    times: Array.from({ length: 800 }, (_, i) => i), duration: 800 };
  const deps = { '../config': { configRead: () => 0 }, './original-volume': { OriginalVolume: class {} },
    './sync-core': { ...sync, mp3FrameIndex: () => index } };
  const box = { exports: {}, require: name => deps[name] || {}, ArrayBuffer, Uint8Array, Error, console: { debug() {} } };
  const source = fs.readFileSync(new URL('../src/vot/translation.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText + `
    wholeFileAudio = true;
    audioCtx = { decodeAudioData(data, done) { done({ duration: data.byteLength / 1000 }); } };
    fetchWholeFile = async () => new ArrayBuffer(800000);
    exports.chunk = fetchRangedChunk;
  `, box);
  return (start, end, time) => box.exports.chunk('https://audio.example', new AbortController().signal, start, end, 800000, time);
}

test('Cobalt seeks use indexed audio time even when video metadata gave byte zero', async () => {
  const chunk = await chunks()(0, 524287, 400);
  assert.ok(chunk.bufferStartTime > 300);
  assert.ok(chunk.bufferStartTime <= 400 && chunk.bufferStartTime + chunk.buffer.duration > 400);
});

test('sequential Cobalt prefetch preserves its explicit byte range', async () => {
  const chunk = await chunks()(50000, 149999);
  assert.equal(chunk.bufferStartTime, 50);
  assert.equal(chunk.endByte, 150000);
});

test('seeking past translated audio ends instead of repeatedly playing its tail', async () => {
  await assert.rejects(chunks()(0, 524287, 800), { name: 'TranslationAudioEnded' });
});
