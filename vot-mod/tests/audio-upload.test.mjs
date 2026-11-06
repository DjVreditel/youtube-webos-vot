import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function uploader(
  statuses,
  { bytes = 5_295_309, cancelAfterFailure = false } = {},
) {
  const controller = new AbortController(),
    requests = [],
    waits = [],
    events = [];
  let downloads = 0;
  const sandbox = {
    exports: {},
    require: () => ({
      downloadAudioViaSabr: async () => {
        downloads++;
        return new Uint8Array(bytes);
      },
    }),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Error,
    console,
    setTimeout: (cb) => {
      queueMicrotask(cb);
      return 1;
    },
    statuses: statuses.slice(),
    requests,
    waits,
    controller,
    cancelAfterFailure,
  };
  const src = fs.readFileSync(
    process.env.VOT_CLIENT_SOURCE ||
      new URL("../src/vot/client.ts", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(
    ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText +
      `
    generateUUID = () => 'TESTFILE';
    getVtransHeaders = async () => ({});
    waitPoll = async (signal, seconds) => { waits.push(seconds); if(cancelAfterFailure) controller.abort(); if(signal.aborted) throw Object.assign(new Error('aborted'),{name:'AbortError'}); };
    workerRequest = async (method, path, body) => {
      requests.push(body.proto);
      if(!statuses.length) throw new Error('unexpected extra upload');
      const status=statuses.shift(); return {success:status===200,status,data:new ArrayBuffer(0)};
    };
    exports.upload = downloadAndUploadYouTubeAudio;
  `,
    sandbox,
  );
  return {
    requests,
    waits,
    events,
    controller,
    downloads: () => downloads,
    run: () =>
      sandbox.exports.upload(
        "testVideo",
        "job",
        60000,
        {},
        controller.signal,
        undefined,
        (event) => events.push(event),
      ),
  };
}

test("temporary rejection resends the same chunk before advancing, without redownloading audio", async () => {
  const b = uploader([503, 200, 200]);
  await b.run();
  assert.equal(b.downloads(), 1);
  assert.equal(b.requests.length, 3);
  assert.deepEqual(b.requests[0], b.requests[1]);
  assert.notDeepEqual(b.requests[1], b.requests[2]);
  assert.deepEqual(
    b.events.map((e) => [e.chunk, e.attempt, e.httpStatus]),
    [
      [1, 1, 503],
      [1, 2, 200],
      [2, 1, 200],
    ],
  );
});

test("repeated network/server upload failures stop after three attempts", async () => {
  const b = uploader([0, 502, 503]);
  await assert.rejects(b.run(), { name: "AudioUploadError" });
  assert.equal(b.requests.length, 3);
  assert.equal(b.downloads(), 1);
});

test("permanent upload rejection does not retry or send the next chunk", async () => {
  const b = uploader([400]);
  await assert.rejects(b.run(), { name: "AudioUploadError" });
  assert.equal(b.requests.length, 1);
  assert.deepEqual(b.waits, []);
});

test("cancelling during upload backoff prevents further chunks", async () => {
  const b = uploader([503], { cancelAfterFailure: true });
  await assert.rejects(b.run(), { name: "AbortError" });
  assert.equal(b.requests.length, 1);
  const stopped = uploader([]);
  stopped.controller.abort();
  await assert.rejects(stopped.run(), { name: "AbortError" });
  assert.equal(stopped.downloads(), 0);
});
