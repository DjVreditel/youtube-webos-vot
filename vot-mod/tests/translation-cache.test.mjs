import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function translation({ lively = false, deliveredLively = lively } = {}) {
  const storage = new Map();
  const requests = [],
    downloads = [],
    stale = new Set();
  let now = Date.now();
  const config = {
    votOriginalVolume: 0.15,
    votToLang: "ru",
    votFromLang: "en",
    votLivelyVoice: lively,
  };
  const deps = {
    "../config": { configRead: (key) => config[key] },
    "./client": {
      translateVideo: async (...args) => {
        requests.push(args);
        return {
          translated: true,
          url: `https://audio.example/${requests.length}.mp3`,
          usedLivelyVoice: deliveredLively,
        };
      },
    },
    "./original-volume": {
      OriginalVolume: class {
        stop() {}
      },
    },
    "./langs": {
      isSourceLang: (lang) => ["en", "de"].includes(lang),
      isTargetLang: (lang) => lang === "ru",
    },
    "./cobalt-audio": { needsAudioShim: () => false },
    "./video-metadata": { waitForVideoMetadata: async getVideo => getVideo() },
    "./source-language": { resolveSourceLanguage: (_id, chosen, detected) => chosen !== "auto" ? chosen : (detected || "auto") },
    "./diagnostics": {
      createTranslationTrace: () => ({ event() {}, fail() {} }),
    },
  };
  const sandbox = {
    exports: {},
    require: (name) => deps[name] || {},
    console: { log() {}, warn() {}, error() {} },
    AbortController,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    document: { querySelector: () => ({ duration: 60, currentTime: 0 }) },
    window: {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      AudioContext: class {
        state = "running";
        createGain() {
          return { gain: {}, connect() {} };
        }
        close() {
          return Promise.resolve();
        }
      },
    },
    downloads,
    stale,
  };
  const source = fs.readFileSync(
    new URL("../src/vot/translation.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(
    js +
      `
    getFileSize = async (url) => {
      downloads.push(url);
      if (stale.has(url)) return 0;
      throw new Error('test stops at the audio download boundary');
    };
  `,
    sandbox,
  );
  return {
    requests,
    downloads,
    stale,
    config,
    storage,
    run: (id) => sandbox.exports.startTranslation(id),
    advance: (ms) => {
      now += ms;
    },
  };
}

test("reopening a translated video downloads the cached URL without another translation request", async () => {
  const b = translation();
  await b.run("videoA");
  await b.run("videoA");
  assert.equal(b.requests.length, 1);
  assert.deepEqual(b.downloads, [
    "https://audio.example/1.mp3",
    "https://audio.example/1.mp3",
  ]);
  assert.equal(b.requests[0][10], false); // server cache permitted on the cold lookup
});

test("lively voice reuses its own cache; a standard fallback cannot occupy that slot", async () => {
  const warm = translation({ lively: true });
  await warm.run("videoA");
  await warm.run("videoA");
  assert.equal(warm.requests.length, 1);
  const fallback = translation({ lively: true, deliveredLively: false });
  await fallback.run("videoA");
  await fallback.run("videoA");
  assert.equal(fallback.requests.length, 2);
  fallback.config.votLivelyVoice = false;
  await fallback.run("videoA");
  assert.equal(fallback.requests.length, 2);
});

test("different videos and languages have independent cache entries; local URLs expire after two hours", async () => {
  const b = translation();
  await b.run("videoA");
  await b.run("videoB");
  b.config.votFromLang = "de";
  await b.run("videoA");
  assert.equal(b.requests.length, 3);
  b.config.votFromLang = "en";
  await b.run("videoA");
  assert.equal(b.requests.length, 3);
  b.advance(2 * 60 * 60 * 1000 + 1);
  await b.run("videoA");
  assert.equal(b.requests.length, 4);
  assert.ok(b.requests.every((args) => args[10] === false));
});

test("a stale local URL is replaced through the normal server cache before forcing regeneration", async () => {
  const b = translation();
  await b.run("videoA");
  b.stale.add("https://audio.example/1.mp3");
  await b.run("videoA");
  assert.equal(b.requests.length, 2);
  assert.equal(b.requests[1][10], false);
  assert.deepEqual(b.downloads, [
    "https://audio.example/1.mp3",
    "https://audio.example/1.mp3",
    "https://audio.example/2.mp3",
  ]);
});
