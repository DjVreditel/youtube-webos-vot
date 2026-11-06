import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function player({ pendingMetadata = false } = {}) {
  const requests = [], statuses = [], storage = new Map(), intervals = new Map();
  let nextTimer = 0;
  const listeners = {};
  const manager = {
    currentVideoID: null, playerMode: 2,
    player: { getVideoData: () => ({ defaultAudioLanguage: 'en' }) },
    addEventListener: (type, callback) => { (listeners[type] ??= []).push(callback); }
  };
  let releaseMetadata = () => { throw new Error('No pending metadata request'); };
  const video = { duration: pendingMetadata ? NaN : 120, readyState: pendingMetadata ? 0 : 4,
    currentTime: 10, paused: false, seeking: false, playbackRate: 1 };
  const deps = {
    '../config': { configRead: key => ({ votOriginalVolume: 0.2, votTranslationVolume: 1,
      votToLang: 'ru', votFromLang: 'en', votLivelyVoice: false, enableVot: true })[key] },
    './player': { getPlayerManager: async () => manager, PlayerMode: { PREVIEW: 0, SHORTS: 1, NORMAL: 2 } },
    './client': { translateVideo: (...args) => new Promise((resolve, reject) => {
      requests.push({ args, signal: args[4], waiting: args[5], fail: reject, finish: () => resolve({
        translated: true, url: `https://audio.example/${args[0]}.mp3`, usedLivelyVoice: false
      }) });
    }) },
    './original-volume': { OriginalVolume: class { stop() {} start() {} } },
    './langs': { isSourceLang: lang => ['auto', 'en'].includes(lang), isTargetLang: lang => lang === 'ru' },
    './source-language': { resolveSourceLanguage: (_id, configured, detected) => configured !== 'auto' ? configured : detected || 'auto' },
    './video-metadata': { waitForVideoMetadata: (getVideo, signal) => {
      const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (signal.aborted) return Promise.reject(aborted());
      if (!pendingMetadata) return Promise.resolve(getVideo());
      return new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(aborted());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        releaseMetadata = duration => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          video.duration = duration;
          video.readyState = 4;
          resolve(getVideo());
        };
      });
    } },
    './diagnostics': { createTranslationTrace: () => ({ event() {}, fail() {} }) },
    './cobalt-audio': { needsAudioShim: () => false },
    './sync-core': { calcChunkRange: () => ({ startByte: 0, endByte: 999 }) }
  };
  const sandbox = {
    exports: {}, require: name => deps[name] || {}, AbortController, Error,
    console: { log() {}, debug() {}, warn() {}, error() {} },
    document: { querySelector: () => video, body: { classList: { contains: () => true } } },
    setInterval: callback => { const id = ++nextTimer; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id), setTimeout: () => ++nextTimer, clearTimeout() {},
    window: {
      addEventListener() {},
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      AudioContext: class {
        state = 'running';
        createGain() { return { gain: {}, connect() {} }; }
        resume() { return Promise.resolve(); }
        suspend() { return Promise.resolve(); }
        close() { return Promise.resolve(); }
      }
    }
  };
  const source = fs.readFileSync(process.env.VOT_TRANSLATION_SOURCE || new URL('../src/vot/translation.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText;
  vm.runInNewContext(js + `
    getFileSize = async () => 1000;
    fetchRangedChunk = async () => ({buffer:{duration:120},bufferStartTime:0,endByte:1000});
    attachVideoListeners = () => {};
    startAudioFrom = () => {};
    reduceOriginalVolume = () => {};
  `, sandbox);
  sandbox.exports.setStatusCallback((status, message) => statuses.push({ status, message }));
  return {
    requests, statuses, intervals, manager,
    init: () => sandbox.exports.initVotTranslation(),
    manualStop: () => sandbox.exports.stopTranslationManually(),
    markStopped: id => sandbox.exports.setManuallyStopped(id),
    active: () => sandbox.exports.isTranslationActive() || sandbox.exports.isTranslationInProgress(),
    emitVideo: (id, mode = 2) => {
      manager.currentVideoID = id; manager.playerMode = mode;
      return Promise.all((listeners.newVideo ?? []).map(callback => callback({ detail: id })));
    },
    releaseMetadata: duration => releaseMetadata(duration),
    observeStatus: callback => sandbox.exports.setStatusCallback((status, message) => {
      statuses.push({ status, message });
      callback(status);
    }),
    start: id => sandbox.exports.startTranslation(id),
    stop: () => sandbox.exports.stopTranslation(),
    tick: () => [...intervals.values()].forEach(callback => callback()),
    last: () => statuses.at(-1)
  };
}

test('cancelled-request progress cannot replace a newer playing status or restart its timer', async () => {
  const b = player(), old = b.start('abcdefghijk');
  await flush();
  const next = b.start('lmnopqrstuv');
  await flush();
  assert.equal(b.requests[0].signal.aborted, true);
  b.requests[1].finish(); await next;
  assert.equal(b.last().status, 'playing');
  for (const args of [[40], [0, '', true], [0, 'upload 1/2'], [0, 'lively-fallback']]) {
    b.requests[0].waiting(...args); b.tick();
    assert.equal(b.last().status, 'playing');
    assert.equal(b.intervals.size, 0);
  }
  b.requests[0].finish(); await old;
  assert.equal(b.last().status, 'playing');
});

test('an obsolete resolved request cannot cancel the current request countdown', async () => {
  const b = player(), old = b.start('abcdefghijk');
  await flush();
  const next = b.start('lmnopqrstuv'); await flush();
  b.requests[1].waiting(45); b.tick();
  assert.equal(b.last().message, '~44s');
  assert.equal(b.intervals.size, 1);
  b.requests[0].finish(); await old;
  assert.equal(b.intervals.size, 1);
  b.tick(); assert.equal(b.last().message, '~43s');
  b.requests[1].finish(); await next;
});

test('progress after the same request finishes cannot put playing audio back into waiting', async () => {
  const b = player(), ready = b.start('abcdefghijk'); await flush();
  b.requests[0].waiting(30); b.tick();
  assert.equal(b.last().status, 'waiting');
  b.requests[0].finish(); await ready;
  assert.equal(b.last().status, 'playing');
  assert.equal(b.intervals.size, 0);
  b.requests[0].waiting(35); b.tick();
  assert.equal(b.last().status, 'playing');
  assert.equal(b.intervals.size, 0);
});

test('a queued countdown callback cannot overwrite playing after its interval was cleared', async () => {
  const b = player(), ready = b.start('abcdefghijk'); await flush();
  b.requests[0].waiting(30);
  const queuedTick = [...b.intervals.values()][0];
  b.requests[0].finish(); await ready;
  assert.equal(b.last().status, 'playing');
  queuedTick();
  assert.equal(b.last().status, 'playing');
  assert.equal(b.intervals.size, 0);
});

test('duplicate start for an active video does not invalidate its pending request', async () => {
  const b = player(), ready = b.start('abcdefghijk'); await flush();
  await b.start('abcdefghijk');
  assert.equal(b.requests.length, 1);
  b.requests[0].waiting(20); b.tick();
  assert.equal(b.last().message, '~19s');
  b.requests[0].finish(); await ready;
  assert.equal(b.last().status, 'playing');
});

test('translation waits for metadata and sends the actual full video duration', async () => {
  const b = player({ pendingMetadata: true }), ready = b.start('abcdefghijk');
  await flush();
  assert.equal(b.requests.length, 0);
  b.releaseMetadata(3395.881); await flush();
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].args[1], 'en');
  assert.equal(b.requests[0].args[2], 'ru');
  assert.equal(b.requests[0].args[3], 3395.881);
  b.requests[0].finish(); await ready;
  assert.equal(b.last().status, 'playing');
});

test('stopping while metadata is pending prevents any later translation request', async () => {
  const b = player({ pendingMetadata: true }), ready = b.start('abcdefghijk');
  await flush();
  assert.equal(b.requests.length, 0);
  await b.stop(); await ready;
  b.releaseMetadata(3395.881); await flush();
  assert.equal(b.requests.length, 0);
  assert.equal(b.last().status, 'idle');
  assert.equal(b.intervals.size, 0);
});


test('stop immediately after start cancels startup before any translation request', async () => {
  const b = player();
  const starting = b.start('abcdefghijk');
  await b.stop(); await flush();
  assert.equal(b.requests.length, 0);
  await starting;
  assert.equal(b.active(), false);
  assert.equal(b.last().status, 'idle');
});

test('manual stop uses the translated video even if player metadata is temporarily missing', async () => {
  const b = player(); await b.init();
  const ready = b.emitVideo('abcdefghijk'); await flush();
  b.requests[0].finish(); await ready;
  assert.equal(b.last().status, 'playing');
  b.manager.currentVideoID = null;
  await b.manualStop();
  await b.emitVideo('abcdefghijk'); await flush();
  assert.equal(b.active(), false);
  assert.equal(b.requests.length, 1);
  assert.equal(b.last().status, 'idle');
});

test('preview events do not clear a manual stop for the same full-screen video', async () => {
  const b = player(); await b.init();
  const ready = b.emitVideo('abcdefghijk'); await flush();
  b.requests[0].finish(); await ready;
  // Match the old UI API so this regression also runs against the old source.
  b.markStopped('abcdefghijk'); await b.stop();
  await b.emitVideo('lmnopqrstuv', 0);
  await b.emitVideo('abcdefghijk'); await flush();
  assert.equal(b.active(), false);
  assert.equal(b.last().status, 'idle');
});

test('manual stop cancels waiting and stale progress; a different full-screen video can auto-start', async () => {
  const b = player(); await b.init();
  const waiting = b.emitVideo('abcdefghijk'); await flush();
  b.requests[0].waiting(30); b.tick();
  await b.manualStop();
  assert.equal(b.requests[0].signal.aborted, true);
  b.requests[0].waiting(40); b.requests[0].finish(); await waiting; b.tick();
  await b.emitVideo('abcdefghijk');
  assert.equal(b.last().status, 'idle');
  assert.equal(b.intervals.size, 0);
  const next = b.emitVideo('lmnopqrstuv'); await flush();
  assert.equal(b.requests.length, 2);
  b.requests[1].finish(); await next;
  assert.equal(b.last().status, 'playing');
});

test('a separate manual start can enable translation again after manual stop', async () => {
  const b = player(); await b.init();
  const ready = b.emitVideo('abcdefghijk'); await flush();
  b.requests[0].finish(); await ready;
  await b.manualStop();
  b.markStopped(null); await b.start('abcdefghijk');
  assert.equal(b.last().status, 'playing');
  assert.equal(b.active(), true);
});

test('manual stop during server-restart cleanup prevents the pending retry', async () => {
  const b = player(); await b.init();
  const pending = b.emitVideo('abcdefghijk'); await flush();
  // Wait for the error handler to begin cleanup, then stop in its await gap.
  // Merely stopping immediately after reject would exercise the earlier abort
  // guard and would miss the restart-continuation race this test protects.
  const cleanup = new Promise(resolve => b.observeStatus(status => {
    if (status === 'idle') resolve();
  }));
  const userStop = cleanup.then(async () => {
    // Use the established API so the test also exercises the preceding source.
    b.markStopped('abcdefghijk');
    await b.stop();
  });
  b.requests[0].fail(Object.assign(new Error('restart requested'), { name: 'ServerRestartNeeded' }));
  await userStop; await flush();
  assert.equal(b.requests.length, 1);
  assert.equal(b.active(), false);
  assert.equal(b.last().status, 'idle');
  await pending;
});
