import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function size(error) {
  const deps = {
    "../config": { configRead: () => 0 },
    "./original-volume": { OriginalVolume: class {} },
  };
  const sandbox = {
    exports: {},
    require: (name) => deps[name] || {},
    error,
    ArrayBuffer,
    Error,
  };
  const source = fs.readFileSync(
    process.env.VOT_TRANSLATION_SOURCE ||
      new URL("../src/vot/translation.ts", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText +
      `
    wholeFileAudio=true;
    fetchWholeFile=async()=>{if(error)throw error;return new ArrayBuffer(123);};
    exports.getFileSize=getFileSize;
  `,
    sandbox,
  );
  return sandbox.exports.getFileSize(
    "https://audio.example/cache.mp3",
    new AbortController().signal,
  );
}

test("network failures and server errors do not masquerade as an expired cached translation", async () => {
  for (const error of [
    new Error("Audio fetch: timeout"),
    new Error("Audio fetch: network error"),
    Object.assign(new Error("HTTP 503"), { httpStatus: 503 }),
  ]) {
    await assert.rejects(size(error), (e) => e === error);
  }
});

test("expired or revoked audio URLs still trigger normal cache refresh", async () => {
  for (const httpStatus of [401, 403, 404, 410])
    assert.equal(
      await size(Object.assign(new Error("expired"), { httpStatus })),
      0,
    );
  assert.equal(await size(), 123);
});
