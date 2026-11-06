import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { JSDOM, VirtualConsole } from 'jsdom';

function boot({ pendingPlayer = false } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM('<!doctype html><button id="player">Player</button>', {
    url: 'https://www.youtube.com/tv', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  const win = dom.window;
  const config = { votFromLang: 'auto', votToLang: 'ru', votLivelyVoice: false,
    votSubtitles: 'off', votTranslationVolume: 0.9, votOriginalVolume: 0.15, enableVot: true };
  let statusCallback;
  let authCalls = 0;
  let active = false, inProgress = false;
  const calls = { starts: [], stops: 0 };
  let resolvePlayer;
  const manager = { currentVideoID: 'test' };
  const playerPromise = pendingPlayer ? new Promise(resolve => { resolvePlayer = resolve; }) : Promise.resolve(manager);
  const mocks = {
    './vot.css': {},
    './controls-button': { installTranslationButton: () => () => {} },
    '../config': { configRead: (key) => config[key], configWrite: (key, value) => { config[key] = value; } },
    './translation': { isTranslationActive: () => active, isTranslationInProgress: () => inProgress,
      setManuallyStopped() {},
      startTranslation: async id => { calls.starts.push(id); active = true; statusCallback('playing'); },
      stopTranslation: async () => { calls.stops++; active = false; inProgress = false; statusCallback('idle'); },
      stopTranslationManually: async () => { calls.stops++; active = false; inProgress = false; statusCallback('idle'); },
      setStatusCallback: (cb) => { statusCallback = cb; }, setVolumeTranslation() {}, setOriginalVolumeReduction() {} },
    './player': { getPlayerManager: () => playerPromise },
    './auth': { isAuthServerConfigured: () => true, startDeviceAuth: () => { authCalls++; return new Promise(() => {}); } },
    './langs': { SOURCE_LANGS: [['auto', 'Auto'], ['en', 'English']], TARGET_LANGS: [['ru', 'Russian'], ['en', 'English'], ['kk', 'Kazakh']] },
    './subtitles': { SUBTITLE_MODES: [['off', 'Выкл'], ['translated', 'Переведённые']], onSubtitlesStatus() {}, subtitlesStatus: () => '' }
  };
  win.exports = {};
  win.require = (name) => {
    assert.ok(Object.hasOwn(mocks, name), name);
    return mocks[name];
  };
  const source = fs.readFileSync(process.env.VOT_UI_SOURCE || new URL('../src/vot/ui.ts', import.meta.url), 'utf8');
  win.eval(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText);
  win.document.getElementById('player').focus();
  win.exports.initVotPanel();
  const rows = () => [...win.document.querySelectorAll('.ytaf-vot-row')];
  const selected = () => rows().findIndex((el) => el.classList.contains('ytaf-vot-row--focused'));
  const keydown = (code, repeat = false) => win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', {
    keyCode: code, repeat, bubbles: true, cancelable: true
  }));
  const keyup = code => win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keyup', {
    keyCode: code, bubbles: true, cancelable: true
  }));
  const key = code => { keydown(code); keyup(code); };
  return { win, config, rows, selected, key, keydown, keyup, errors, calls, api: win.exports,
    setActive: value => { active = value; statusCallback(value ? 'playing' : 'idle'); },
    resolvePlayer: () => resolvePlayer(manager),
    playing: () => statusCallback('playing'), authCalls: () => authCalls,
    close: () => { assert.deepEqual(errors, []); win.close(); } };
}

test('pointer-opened menu owns arrow keys and changes the selected setting once', () => {
  const b = boot();
  b.playing();
  assert.equal(b.api.isVotUiFocused(), false);
  b.win.document.querySelector('.ytaf-vot-seg--menu').click();
  assert.equal(b.api.isVotUiFocused(), true);
  let leaked = 0;
  b.win.addEventListener('keydown', () => leaked++);
  b.key(40);
  assert.equal(b.selected(), 1);
  b.key(39);
  assert.equal(b.config.votToLang, 'en');
  assert.equal(leaked, 0);
  b.close();
});

test('pointer can select and activate each row, including QR login', () => {
  const b = boot();
  b.playing();
  b.win.document.querySelector('.ytaf-vot-seg--menu').click();
  b.rows()[3].dispatchEvent(new b.win.MouseEvent('mouseenter'));
  assert.equal(b.selected(), 3);
  b.rows()[3].querySelector('.ytaf-vot-row-value').click();
  assert.equal(b.config.votSubtitles, 'translated');
  b.rows()[6].click();
  assert.equal(b.config.enableVot, false);
  b.rows()[7].click();
  assert.equal(b.authCalls(), 1);
  b.close();
});

test('remote-opened menu supports arrows, OK and Back without leaving the video', () => {
  const b = boot();
  b.api.showVotPanel(true);
  b.key(40);
  assert.equal(b.selected(), 0);
  b.key(39);
  assert.equal(b.config.votFromLang, 'en');
  b.key(37);
  assert.equal(b.config.votFromLang, 'auto');
  for (let i = 0; i < 6; i++) b.key(40);
  b.key(13);
  assert.equal(b.config.enableVot, false);
  b.key(461);
  assert.equal(b.win.document.querySelector('.ytaf-vot-menu').style.display, 'none');
  b.key(461);
  assert.equal(b.api.isVotUiFocused(), false);
  assert.equal(b.win.document.activeElement.id, 'player');
  b.close();
});

test('translation status updates do not reopen a closed panel or steal menu focus', () => {
  const b = boot();
  b.playing();
  assert.equal(b.win.document.querySelector('.ytaf-vot-root').style.display, 'none');
  b.api.showVotPanel(true);
  b.key(40);
  b.key(40);
  b.playing();
  assert.equal(b.selected(), 1);
  assert.equal(b.win.document.activeElement, b.rows()[1]);
  b.key(461);
  b.key(461);
  b.playing();
  assert.equal(b.win.document.querySelector('.ytaf-vot-root').style.display, 'none');
  b.api.showVotPanel(true);
  assert.equal(b.api.isVotUiFocused(), true);
  b.close();
});

test('moving the Magic Remote pointer into YouTube releases menu selection and OK', () => {
  const b = boot();
  b.api.showVotPanel(true); b.key(40);
  b.rows()[6].dispatchEvent(new b.win.MouseEvent('mouseenter'));
  const player = b.win.document.getElementById('player');
  player.dispatchEvent(new b.win.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(b.api.isVotUiFocused(), false);
  assert.equal(b.selected(), -1);
  assert.equal(b.win.document.activeElement, player);
  let nativeOK = 0;
  player.addEventListener('keydown', () => nativeOK++);
  b.key(13);
  assert.equal(nativeOK, 1);
  assert.equal(b.config.enableVot, true);
  b.rows()[6].dispatchEvent(new b.win.MouseEvent('mouseenter'));
  b.key(13);
  assert.equal(b.config.enableVot, false);
  b.close();
});

test('native focus and Down after the last row can leave the menu without being pulled back', async () => {
  const b = boot();
  b.api.showVotPanel(true); b.key(40);
  b.win.document.getElementById('player').focus();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(b.api.isVotUiFocused(), false);
  assert.equal(b.win.document.activeElement.id, 'player');
  b.api.showVotPanel(true); b.key(40);
  for (let i = 0; i < b.rows().length; i++) b.key(40);
  assert.equal(b.api.isVotUiFocused(), false);
  assert.equal(b.win.document.activeElement.id, 'player');
  b.close();
});

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('a held remote OK stops once; a separate OK press can intentionally restart', async () => {
  const b = boot();
  b.setActive(true); b.api.showVotPanel(true);
  b.keydown(13); await flush();
  assert.equal(b.calls.stops, 1);
  assert.match(b.win.document.querySelector('.ytaf-vot-seg--main').textContent, /Перевести видео/);
  b.keydown(13, true); b.keydown(13); await flush();
  assert.deepEqual(b.calls.starts, []);
  b.keyup(13);
  b.key(13); await flush();
  assert.deepEqual(b.calls.starts, ['test']);
  b.close();
});

test('native clicks accompanying remote OK do not undo stop, while a new pointer click works', async () => {
  const b = boot();
  b.setActive(true); b.api.showVotPanel(true);
  const main = b.win.document.querySelector('.ytaf-vot-seg--main');
  b.keydown(13); await flush();
  main.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  b.keyup(13);
  main.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  await flush();
  assert.equal(b.calls.stops, 1);
  assert.deepEqual(b.calls.starts, []);
  main.dispatchEvent(new b.win.MouseEvent('mousedown', { bubbles: true }));
  main.click(); await flush();
  assert.deepEqual(b.calls.starts, ['test']);
  b.close();
});

test('stop does not wait for player lookup when audio is already active', async () => {
  const b = boot({ pendingPlayer: true });
  b.setActive(true);
  b.win.document.querySelector('.ytaf-vot-seg--main').click();
  await flush();
  assert.equal(b.calls.stops, 1);
  assert.deepEqual(b.calls.starts, []);
  b.close();
});

test('a second intentional toggle cancels an unresolved start instead of starting after lookup', async () => {
  const b = boot({ pendingPlayer: true });
  const main = b.win.document.querySelector('.ytaf-vot-seg--main');
  main.click(); await flush();
  main.click(); await flush();
  assert.equal(b.calls.stops, 1);
  b.resolvePlayer(); await flush();
  assert.deepEqual(b.calls.starts, []);
  assert.match(main.textContent, /Перевести видео/);
  b.close();
});

test('navigation recovers OK ownership when the remote omitted the preceding release', async () => {
  const b = boot();
  b.setActive(true); b.api.showVotPanel(true);
  b.keydown(13); await flush();
  assert.equal(b.calls.stops, 1);
  b.key(39); b.key(37);
  b.key(13); await flush();
  assert.deepEqual(b.calls.starts, ['test']);
  b.close();
});
