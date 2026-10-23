/**
 * Per-account settings (perAccountSettings).
 *
 * Each account's own settings live in `ytaf-configuration::<profile>`; the
 * device settings stay in `ytaf-configuration`. Checks a new account starts
 * from the shared settings, a token refresh keeps the profile, switching
 * account on the selector swaps the settings live, an unrecognised identity
 * falls back to the shared settings and reports only field names, and that
 * with the option off nothing but the shared store is written.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyChrome38Downgrade, UA, setUserAgent, dispatchTrusted } = require('./chrome38-env.cjs');

const bundlePath = process.argv[2] || 'dist/webOSUserScripts/userScript.js';
const GREEN = 404;
const CONFIG_KEY = 'ytaf-configuration';
const IDENTITY_KEY = 'yt.leanback.default::last-identity-used';
const RYD = 'Return YouTube Dislike';

function boot(shared, identity, extraStorage = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM('<!doctype html><html><body class="WEB_PAGE_TYPE_BROWSE"><ytlr-app></ytlr-app></body></html>',
    { runScripts: 'outside-only', url: 'https://www.youtube.com/tv', virtualConsole: vc, pretendToBeVisual: true });
  const win = dom.window;
  setUserAgent(win, UA.webos3);
  win.launchParams = '{}';
  win.XMLHttpRequest = class { open(){} send(){} setRequestHeader(){} getResponseHeader(){return null;} addEventListener(){} };
  win.fetch = () => Promise.reject(new Error('offline'));
  let rafQ = [];
  win.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
  win.cancelAnimationFrame = () => {};
  const NS = win.JSON.stringify;
  win.localStorage.setItem(CONFIG_KEY, NS(Object.assign({
    enableAdBlock: true, enableLegacyEmojiFix: false, enableSponsorBlock: false,
    enableReturnYouTubeDislike: false, upgradeThumbnails: false, enableAutoLogin: false
  }, shared)));
  if (identity) win.localStorage.setItem(IDENTITY_KEY, NS({ data: identity }));
  for (const [k, v] of Object.entries(extraStorage)) win.localStorage.setItem(k, NS(v));
  applyChrome38Downgrade(win);
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  const pump = () => { for (let i = 0; i < 10; i++) { const q = rafQ; rafQ = []; for (const cb of q) cb(Date.now()); } };
  return { win, NS, errors, pump };
}

function key(win, code) {
  const e = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { get: () => code, configurable: true });
  dispatchTrusted(win.document.body, e);
}

function checkbox(win, text) {
  for (const label of win.document.querySelectorAll('.ytaf-ui-container label')) {
    const span = label.querySelector('.label-text');
    if (span && span.textContent === text) return label.querySelector('input');
  }
  return null;
}

function toggle(win, input) {
  input.checked = !input.checked;
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

const profileKeys = (win) => {
  const out = [];
  for (let i = 0; i < win.localStorage.length; i++) {
    const k = win.localStorage.key(i);
    if (k.indexOf(CONFIG_KEY + '::') === 0) out.push(k);
  }
  return out.sort();
};
const read = (win, k) => JSON.parse(win.localStorage.getItem(k));

async function chooseAccount(win, identity) {
  win.document.body.className = 'WEB_PAGE_TYPE_ACCOUNT_SELECTOR';
  await wait(20);
  win.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ data: identity }));
  win.document.body.className = 'WEB_PAGE_TYPE_BROWSE';
  await wait(20);
}

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '\n     ' + extra : '')); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT_A = { identityType: 'SIGNED_IN', obfuscatedGaiaId: '1111', accessToken: 'tok-a1' };
const ACCOUNT_B = { identityType: 'SIGNED_IN', obfuscatedGaiaId: '2222', accessToken: 'tok-b1' };

(async () => {
  // ---- Option off: one shared store, as before ----
  {
    const { win, errors } = boot({ perAccountSettings: false }, ACCOUNT_A);
    key(win, GREEN);
    toggle(win, checkbox(win, RYD));
    await wait(300);
    t('off: no profile store is written', profileKeys(win).length === 0, profileKeys(win).join());
    t('off: change lands in the shared store', read(win, CONFIG_KEY).enableReturnYouTubeDislike === true);
    t('off: no errors', errors.length === 0, errors.join(' | '));
  }

  // ---- Option on: new account seeded from the shared settings ----
  {
    const { win, errors, pump } = boot({ perAccountSettings: true, enableReturnYouTubeDislike: true }, ACCOUNT_A);
    await wait(300);
    const keys = profileKeys(win);
    t('on: a profile store is created for the account', keys.length === 1, keys.join());
    const profileA = keys[0];
    t('on: profile name carries no account id or token',
      profileA && profileA.indexOf('1111') === -1 && win.localStorage.getItem(profileA).indexOf('tok-') === -1);
    const storedA = read(win, profileA);
    t('on: new profile starts from the shared settings', storedA.enableReturnYouTubeDislike === true);
    t('on: device settings stay out of the profile',
      !('enableAutoLogin' in storedA) && !('perAccountSettings' in storedA) && !('forceVideoCodec' in storedA));

    key(win, GREEN);
    pump();
    const status = win.document.querySelector('.ytaf-profile-status');
    t('on: panel says the account has its own settings', status && /own settings/.test(status.textContent), status && status.textContent);

    // Account B picks its own value.
    await chooseAccount(win, ACCOUNT_B);
    t('switch: B starts from the shared settings', checkbox(win, RYD).checked === true);
    toggle(win, checkbox(win, RYD));
    await wait(300);
    const keys2 = profileKeys(win);
    t('switch: B gets a store of its own', keys2.length === 2, keys2.join());
    const profileB = keys2.find((k) => k !== profileA);
    t('switch: B\'s change lands in B\'s store', read(win, profileB).enableReturnYouTubeDislike === false);
    t('switch: A\'s store is untouched', read(win, profileA).enableReturnYouTubeDislike === true);
    t('switch: shared store keeps its own value', read(win, CONFIG_KEY).enableReturnYouTubeDislike === true);

    // Back to A, with a refreshed token: same profile, A's value back live.
    await chooseAccount(win, Object.assign({}, ACCOUNT_A, { accessToken: 'tok-a2' }));
    t('switch back: A\'s value is applied live', checkbox(win, RYD).checked === true);
    t('token refresh: no third profile', profileKeys(win).length === 2, profileKeys(win).join());

    await chooseAccount(win, ACCOUNT_B);
    t('switch: B\'s value is applied live', checkbox(win, RYD).checked === false);
    t('on: no errors', errors.length === 0, errors.join(' | '));
  }

  // ---- Existing profile wins over the shared settings at startup ----
  {
    const first = boot({ perAccountSettings: true }, ACCOUNT_A);
    await wait(300);
    const profileA = profileKeys(first.win)[0];
    const { win } = boot({ perAccountSettings: true, enableReturnYouTubeDislike: false }, ACCOUNT_A,
      { [profileA]: { enableReturnYouTubeDislike: true } });
    key(win, GREEN);
    t('startup: the account\'s stored value is loaded', checkbox(win, RYD).checked === true);
  }

  // ---- Identity with no id: shared settings, field names reported ----
  {
    const { win, errors, pump } = boot({ perAccountSettings: true }, { identityType: 'SIGNED_IN', accessToken: 'secret-token' });
    await wait(300);
    t('unknown: no profile store', profileKeys(win).length === 0, profileKeys(win).join());
    key(win, GREEN);
    pump();
    const status = win.document.querySelector('.ytaf-profile-status');
    const text = status ? status.textContent : '';
    t('unknown: panel reports the field names', /not recognised/.test(text) && /identityType, accessToken/.test(text), text);
    t('unknown: panel shows no field values', text.indexOf('secret-token') === -1);
    t('unknown: no errors', errors.length === 0, errors.join(' | '));
  }

  // ---- Guest mode gets its own profile; turning the option on keeps values ----
  {
    const { win } = boot({ perAccountSettings: false, enableReturnYouTubeDislike: true },
      { identityType: 'UNAUTHENTICATED_IDENTITY_TYPE_GUEST' });
    key(win, GREEN);
    toggle(win, checkbox(win, 'Separate Settings for Each Account'));
    await wait(300);
    t('turn on: guest profile created', profileKeys(win).join() === CONFIG_KEY + '::guest', profileKeys(win).join());
    t('turn on: current values carried into the profile', read(win, CONFIG_KEY + '::guest').enableReturnYouTubeDislike === true);
    t('turn on: flag saved in the shared store', read(win, CONFIG_KEY).perAccountSettings === true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
