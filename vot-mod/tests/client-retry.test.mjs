import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function client(replies, uploadError) {
  const requests = [];
  const waits = [];
  const uploads = [],
    fallbacks = [];
  const sandbox = {
    exports: {},
    require: () => ({}),
    console: { debug() {}, warn() {} },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    AbortController,
    Date,
    replies: replies.slice(),
    requests,
    waits,
    uploads,
    fallbacks,
    uploadError,
  };
  const source = fs.readFileSync(
    process.env.VOT_CLIENT_SOURCE ||
      new URL("../src/vot/client.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(
    compiled +
      `
    getSession = async () => ({uuid: 'test-session'});
    downloadAndUploadYouTubeAudio = async (id, job) => { uploads.push(job); if(uploadError) throw uploadError; };
    sendFailAudioJs = async () => { fallbacks.push('fail-audio-js'); };
    sendFallbackAudioNotify = async () => { fallbacks.push('empty-audio'); };
    waitPoll = async (signal, seconds) => { waits.push(seconds); if(signal.aborted) throw Object.assign(new Error('aborted'),{name:'AbortError'}); };
    sendTranslationRequest = async (body) => {
      const reader = new ProtoReader(body); let bypass = false;
      while(reader.position < reader.length) { const {field,type}=reader.readTag(); if(field===17) bypass=reader.readInt32()===1; else reader.skip(type); }
      requests.push(bypass);
      const response = replies.shift(); if(!response) throw new Error('unexpected extra request');
      const bytes = new ProtoWriter().string(20,response.unknown||'').int32(4,response.status).string(1,response.url||'').string(7,response.job||'').string(9,response.message||'').int32(12,response.retry||0).int32(5,response.remaining||0).finish();
      return {success:true,status:200,data:bytes.buffer};
    };
  `,
    sandbox,
  );
  return {
    requests,
    waits,
    uploads,
    fallbacks,
    run: (signal) =>
      sandbox.exports.translateVideo(
        "testVideo",
        "en",
        "ru",
        60,
        signal || new AbortController().signal,
      ),
  };
}

test("successful cache-bypass response is used instead of discarded", async () => {
  const b = client([
    { status: 0, retry: 1 },
    { status: 1, url: "https://example.test/translation.mp3" },
  ]);
  assert.equal((await b.run()).url, "https://example.test/translation.mp3");
  assert.deepEqual(b.requests, [false, true]);
});

test("a new server audio job is uploaded; repeated polls of the same job are not", async () => {
  const b = client([
    { status: 6, job: "a" },
    { status: 6, job: "a" },
    { status: 6, job: "b" },
    { status: 1, url: "https://example.test/audio.mp3" },
  ]);
  await b.run();
  assert.deepEqual(b.uploads, ["a", "b"]);
});

test("repeated fresh audio jobs are bounded to protect the TV", async () => {
  const b = client(["a", "b", "c", "d"].map((job) => ({ status: 6, job })));
  await assert.rejects(b.run(), /повторно запрашивает/);
  assert.equal(b.uploads.length, 3);
});

test("a rejected upload is not reported as a missing source or replaced by empty audio", async () => {
  const error = Object.assign(new Error("upload refused"), {
    name: "AudioUploadError",
  });
  const b = client([{ status: 6, job: "a" }], error);
  await assert.rejects(b.run(), { name: "AudioUploadError" });
  assert.deepEqual(b.fallbacks, []);
});

test("subsequent polls keep bypassing the cached error", async () => {
  const b = client([
    { status: 0, retry: 1 },
    { status: 5, remaining: 5 },
    { status: 1, url: "https://example.test/translation.mp3" },
  ]);
  assert.equal((await b.run()).translated, true);
  assert.deepEqual(b.requests, [false, true, true]);
});

test("the photographed temporary error has bounded retries even without shouldRetry", async () => {
  const message = "Возникла ошибка при переводе, попробуйте позже";
  const b = client(Array.from({ length: 4 }, () => ({ status: 0, message })));
  await assert.rejects(b.run(), new RegExp(message));
  assert.equal(b.requests.length, 4);
  assert.deepEqual(b.waits, [2, 4, 6]);
});

test("permanent refusal and cancellation do not repeatedly request translation", async () => {
  const b = client([{ status: 0, message: "This video is not supported" }]);
  await assert.rejects(b.run(), /not supported/);
  assert.equal(b.requests.length, 1);
  const cancelled = client([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cancelled.run(controller.signal), {
    name: "AbortError",
  });
  assert.equal(cancelled.requests.length, 0);
});

test("unknown response fields do not corrupt the following status and URL", async () => {
  const b = client([
    {
      status: 1,
      url: "https://example.test/audio.mp3",
      unknown: "future API metadata",
    },
  ]);
  assert.equal((await b.run()).url, "https://example.test/audio.mp3");
  assert.deepEqual(b.requests, [false]);
  assert.deepEqual(b.waits, []); // A ready server-cached result never enters polling.
});
