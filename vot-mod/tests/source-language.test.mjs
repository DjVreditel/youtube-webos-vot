import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const KEY = 'ytaf-vot-source-languages-v1';
const VIDEO_A = 'abcdefghijk';
const VIDEO_B = 'lmnopqrstuv';
const TTL = 30 * 24 * 60 * 60 * 1000;

function languageCache() {
  const storage = new Map();
  let now = 1_000_000;
  const source = fs.readFileSync(new URL('../src/vot/source-language.ts', import.meta.url), 'utf8');
  const sandbox = {
    exports: {},
    require: () => ({ isSourceLang: code => ['auto', 'en', 'ru', 'de'].includes(code) }),
    Date: class extends Date { static now() { return now; } },
    window: { localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    } }
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText, sandbox);
  return {
    resolve: sandbox.exports.resolveSourceLanguage,
    storage, sandbox,
    advance: ms => { now += ms; },
    now: () => now
  };
}

test('missing metadata reuses an observed language only for the same video', () => {
  const b = languageCache();
  assert.equal(b.resolve(VIDEO_A, 'auto', 'en'), 'en');
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'en');
  assert.equal(b.resolve(VIDEO_B, 'auto', ''), 'auto');
  assert.equal(b.resolve(VIDEO_A, 'auto', 'de'), 'de');
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'de');
});

test('manual selection wins without contaminating the per-video metadata cache', () => {
  const b = languageCache();
  b.resolve(VIDEO_A, 'auto', 'en');
  const before = b.storage.get(KEY);
  assert.equal(b.resolve(VIDEO_A, 'ru', 'de'), 'ru');
  assert.equal(b.resolve(VIDEO_B, 'ru', ''), 'ru');
  assert.equal(b.storage.get(KEY), before);
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'en');
  assert.equal(b.resolve(VIDEO_B, 'auto', ''), 'auto');
});

test('auto and unsupported metadata are never remembered as known source languages', () => {
  const b = languageCache();
  assert.equal(b.resolve(VIDEO_A, 'auto', 'auto'), 'auto');
  assert.equal(b.resolve(VIDEO_A, 'unsupported', 'zz'), 'auto');
  assert.equal(b.storage.has(KEY), false);
  assert.equal(b.resolve('invalid-id', 'auto', 'en'), 'en');
  assert.equal(b.storage.has(KEY), false);
  b.resolve(VIDEO_A, 'auto', 'en');
  assert.equal(b.resolve(VIDEO_A, 'auto', 'auto'), 'en');
  assert.equal(b.resolve(VIDEO_A, 'auto', 'zz'), 'en');
});

test('remembered languages expire after thirty days without extending on reuse', () => {
  const b = languageCache();
  b.resolve(VIDEO_A, 'auto', 'en');
  b.advance(TTL - 1);
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'en');
  b.advance(1);
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'auto');
});

test('the cache keeps the one hundred newest observations', () => {
  const b = languageCache();
  for (let i = 0; i < 105; i++) {
    b.resolve(String(i).padStart(11, '0'), 'auto', 'en');
    b.advance(1);
  }
  const saved = JSON.parse(b.storage.get(KEY));
  assert.equal(Object.keys(saved).length, 100);
  assert.equal(b.resolve('00000000000', 'auto', ''), 'auto');
  assert.equal(b.resolve('00000000104', 'auto', ''), 'en');
  const simultaneous = languageCache();
  for (let i = 0; i < 105; i++) simultaneous.resolve(String(i).padStart(11, '0'), 'auto', 'en');
  assert.equal(Object.keys(JSON.parse(simultaneous.storage.get(KEY))).length, 100);
  assert.equal(simultaneous.resolve('00000000104', 'auto', ''), 'en');
});

test('malformed or unavailable storage cannot break language selection', () => {
  const b = languageCache();
  b.storage.set(KEY, JSON.stringify({
    [VIDEO_A]: { language: 'auto', observedAt: b.now() },
    [VIDEO_B]: { language: 'en', observedAt: b.now() + 1 },
    'bad': { language: 'en', observedAt: b.now() }
  }));
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'auto');
  assert.equal(b.resolve(VIDEO_B, 'auto', ''), 'auto');
  b.storage.set(KEY, '{broken');
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'auto');
  b.sandbox.window.localStorage = {
    getItem() { throw new Error('unavailable'); },
    setItem() { throw new Error('full'); }
  };
  assert.equal(b.resolve(VIDEO_A, 'auto', 'en'), 'en');
  assert.equal(b.resolve(VIDEO_A, 'auto', ''), 'auto');
  assert.equal(b.resolve(VIDEO_A, 'ru', ''), 'ru');
});
