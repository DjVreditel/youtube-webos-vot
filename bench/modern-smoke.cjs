/**
 * Loads the MODERN bundle in a webOS 23-shaped window and asserts it survives
 * evaluation and the settings panel opens.
 *
 * This exists because the suite only ever smoke-tested the legacy bundle, and a
 * modern-only crash shipped once ("Cannot add property trackFocus, object is
 * not extensible", from the spatial-navigation shim that 0.8.6 removed).
 *
 * No Chromium 38 downgrade here - the point is to exercise the code paths that
 * ONLY run on a modern engine (no polyfills.js, no emoji-font.js, no
 * buffer-limit).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { UA, setUserAgent, dispatchTrusted } = require('./chrome38-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const bundlePath = process.argv[2] || ROOT + '/dist/webOSUserScripts/userScript.js';

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(
  `<!doctype html><html><body class="WEB_PAGE_TYPE_BROWSE"><ytlr-app>
     <div id="ytlr-player__player-container"><video></video></div>
   </ytlr-app></body></html>`,
  { runScripts: 'outside-only', url: 'https://www.youtube.com/tv',
    virtualConsole: vc, pretendToBeVisual: true });
const win = dom.window;
setUserAgent(win, UA.webos23);   // webOS 23+ -> modern code paths
win.launchParams = JSON.stringify({});
win.webOS = { deviceInfo: (cb) => cb({ modelName: 'sim' }), platformBack: () => {} };
win.XMLHttpRequest = class { open(){} send(){} setRequestHeader(){} getResponseHeader(){return null;} addEventListener(){} };
if (!win.requestAnimationFrame) win.requestAnimationFrame = (cb) => win.setTimeout(() => cb(Date.now()), 16);
if (!win.cancelAnimationFrame) win.cancelAnimationFrame = (id) => win.clearTimeout(id);

let threw = null;
try { win.eval(fs.readFileSync(bundlePath, 'utf8')); } catch (e) { threw = e; }

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '\n     ' + extra : '')); }
};

setTimeout(() => {
  t('modern bundle loads without throwing', !threw,
    threw && (threw.message + ' | ' + (threw.stack || '').split('\n')[1]));
  t('no "not extensible" error', !(threw && /not extensible/.test(threw.message)), threw && threw.message);
  t('no jsdomError during load', errors.length === 0, errors[0]);
  t('JSON.parse hooked', win.JSON.parse.toString().indexOf('native code') === -1);
  t('JSON.stringify hooked', win.JSON.stringify.toString().indexOf('native code') === -1);
  t('no spatial-navigation shim shipped', !win.__spatialNavigation__);

  // The green key opens the settings panel, which moves focus by itself.
  const green = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(green, 'keyCode', { get: () => 404, configurable: true });
  let keyThrew = null;
  try { dispatchTrusted(win.document.body, green); } catch (e) { keyThrew = e; }
  t('green key opens the settings panel without throwing',
    !keyThrew && !!win.document.querySelector('.ytaf-ui-container'), keyThrew && keyThrew.message);
  t('no error while opening the panel', errors.length === 0, errors[0]);

  // The legacy-only modules must be aliased out of this build.
  const src = fs.readFileSync(bundlePath, 'utf8');
  t('polyfills.js excluded from modern build', src.indexOf('Array.from requires an array-like') === -1);
  t('no bare require() in modern bundle', !/(?:^|[^.\w$])require\s*\(/.test(src));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 600);
