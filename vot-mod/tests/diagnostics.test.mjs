import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const KEY = "ytaf-vot-last-error-v1";
function diagnostics() {
  const storage = new Map();
  let now = 1000;
  const sandbox = {
    exports: {},
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    window: {
      localStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
    },
  };
  const source = fs.readFileSync(
    new URL("../src/vot/diagnostics.ts", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    sandbox,
  );
  return {
    storage,
    sandbox,
    trace: () => sandbox.exports.createTranslationTrace("abcdefghijk"),
    advance: (ms) => (now += ms),
  };
}

test("last failure is bounded and excludes tokens, response bodies and signed URLs", () => {
  const b = diagnostics(),
    t = b.trace();
  for (let i = 0; i < 40; i++)
    t.event({
      stage: "response",
      status: 0,
      httpStatus: 200,
      attempt: i,
      token: "SECRET",
      url: "https://audio/?token=SECRET",
      body: "SECRET",
    });
  t.fail(new Error("https://audio/?token=SECRET"));
  const raw = b.storage.get(KEY),
    saved = JSON.parse(raw);
  assert.equal(saved.events.length, 24);
  assert.equal(saved.events[0].attempt, 16);
  assert.equal(saved.videoId, "abcdefghijk");
  assert.equal(raw.includes("SECRET"), false);
  assert.ok(raw.length < 8000);
});

test("success and cancellation retain the previous failure for intermittent-error diagnosis", () => {
  const b = diagnostics(),
    a = b.trace();
  a.event({ stage: "response", status: 0 });
  a.fail(new Error("failed"));
  const saved = b.storage.get(KEY),
    next = b.trace();
  next.event({ stage: "ready" });
  next.fail(Object.assign(new Error("cancelled"), { name: "AbortError" }));
  assert.equal(b.storage.get(KEY), saved);
});

test("old failure records expire and unavailable storage never interrupts playback", () => {
  const b = diagnostics();
  b.trace().fail(new Error("failed"));
  b.advance(8 * 24 * 60 * 60 * 1000);
  b.trace();
  assert.equal(b.storage.has(KEY), false);
  b.sandbox.window.localStorage = {
    getItem() {
      throw Error("disabled");
    },
    setItem() {
      throw Error("full");
    },
  };
  assert.doesNotThrow(() => b.trace().fail(new Error("failed")));
});
