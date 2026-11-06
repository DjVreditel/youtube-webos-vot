import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

function boot(userAgent = 'Cobalt/23.lts.6') {
  const dom = new JSDOM('<body class="WEB_PAGE_TYPE_BROWSE"><div id="ytlr-player__player-container-player"><video></video></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'userAgent', { value: userAgent });
  let inline = false, ready = 4, tick = () => {}, timers = 0;
  const player = w.document.getElementById('ytlr-player__player-container-player');
  const video = player.querySelector('video');
  player.isInline = () => inline;
  Object.defineProperty(video, 'readyState', { get: () => ready });
  w.setInterval = cb => { tick = cb; timers++; return timers; };
  w.clearInterval = () => { timers--; };
  const source = fs.readFileSync(new URL('../src/vot/oled-preview.ts', import.meta.url), 'utf8');
  w.exports = {};
  w.eval(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
  } }).outputText);
  return {
    w, player, video, set: w.exports.setOledPageEnabled,
    inline: value => { inline = value; }, ready: value => { ready = value; },
    active: () => w.document.documentElement.classList.contains('oled-page-active'),
    tick: () => tick(), timers: () => timers,
    close: () => { w.dispatchEvent(new w.Event('beforeunload')); w.close(); }
  };
}

test('OLED page backgrounds yield to inline video, including paused frames, then return', () => {
  const b = boot();
  try {
    b.set(true); assert.equal(b.active(), true);
    b.inline(true); b.tick(); assert.equal(b.active(), false);
    // jsdom's video is paused by default: a paused preview must stay visible.
    assert.equal(b.video.paused, true);
    b.inline(false); b.tick(); assert.equal(b.active(), true);
    assert.equal(b.timers(), 1);
  } finally { b.close(); }
});

test('media events handle first frame and empty playback without waiting for polling', () => {
  const b = boot();
  try {
    b.inline(true); b.ready(0); b.set(true); assert.equal(b.active(), true);
    b.ready(2); b.video.dispatchEvent(new b.w.Event('loadeddata'));
    assert.equal(b.active(), false);
    b.ready(0); b.video.dispatchEvent(new b.w.Event('emptied'));
    assert.equal(b.active(), true);
    b.ready(4); b.tick(); assert.equal(b.active(), false);
    b.video.remove(); b.tick(); assert.equal(b.active(), true);
  } finally { b.close(); }
});

test('watch and Shorts keep OLED page styles even during transient inline state', () => {
  const b = boot();
  try {
    b.inline(true); b.set(true); assert.equal(b.active(), false);
    for (const page of ['WATCH', 'SHORTS']) {
      b.w.document.body.className = `WEB_PAGE_TYPE_${page}`;
      b.w.dispatchEvent(new b.w.Event('ytaf-page-update'));
      assert.equal(b.active(), true);
    }
    b.w.document.body.className = 'WEB_PAGE_TYPE_BROWSE';
    b.w.dispatchEvent(new b.w.Event('ytaf-page-update'));
    assert.equal(b.active(), false);
  } finally { b.close(); }
});

test('user disabling OLED during preview stays disabled after leaving it', () => {
  const b = boot();
  try {
    b.inline(true); b.set(true); b.set(false); b.inline(false); b.tick();
    assert.equal(b.active(), false);
    b.set(true); assert.equal(b.active(), true);
    assert.equal(b.timers(), 1);
  } finally { b.close(); }
});

test('non-Cobalt apps retain their existing OLED behavior and add no timer', () => {
  const b = boot('Mozilla/5.0 Chrome/38.0.2125.122 WebAppManager');
  try {
    b.inline(true); b.set(true); assert.equal(b.active(), true);
    assert.equal(b.timers(), 0);
    b.set(false); assert.equal(b.active(), false);
  } finally { b.close(); }
});
