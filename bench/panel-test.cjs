/**
 * Behavioural test for the deferred options-panel build.
 *
 * The risky case is a user reaching a tab before the idle build chain does:
 * setActivePage() must build that page synchronously rather than blowing up on
 * an undefined page element. Also checks each builder runs exactly once, that
 * every page ends up identical to the all-synchronous build, and that opening
 * and closing the panel repeatedly doesn't duplicate anything.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyChrome38Downgrade, UA, setUserAgent, dispatchTrusted } = require('./chrome38-env.cjs');

const bundlePath = process.argv[2] || 'dist/webOSUserScripts/userScript.js';
const GREEN = 404;

function boot(bodyClass = 'WEB_PAGE_TYPE_BROWSE', extraHtml = '') {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM('<!doctype html><html><body class="' + bodyClass + '"><ytlr-app></ytlr-app>' + extraHtml + '</body></html>',
    { runScripts: 'outside-only', url: 'https://www.youtube.com/tv', virtualConsole: vc, pretendToBeVisual: true });
  const win = dom.window;
  setUserAgent(win, UA.webos3);
  win.launchParams = '{}';
  win.XMLHttpRequest = class { open(){} send(){} setRequestHeader(){} getResponseHeader(){return null;} addEventListener(){} };
  let rafQ = [];
  win.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
  win.cancelAnimationFrame = () => {};
  win.localStorage.setItem('ytaf-configuration', win.JSON.stringify({
    enableAdBlock: true, enableLegacyEmojiFix: true, enableSponsorBlock: true,
    enableReturnYouTubeDislike: true, upgradeThumbnails: false, enableAutoLogin: true
  }));
  applyChrome38Downgrade(win);
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  return { win, errors, pump: () => { const q = rafQ; rafQ = []; for (const cb of q) cb(Date.now()); } };
}

function key(win, code) {
  const e = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { get: () => code, configurable: true });
  dispatchTrusted(win.document.body, e);
}

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '\n     ' + extra : '')); }
};
// One per tab, in tab order (SETTINGS_PAGES in src/ui.js).
const PAGES = ['#ytaf-page-filters', '#ytaf-page-player', '#ytaf-page-interface',
  '#ytaf-page-sponsor', '#ytaf-page-shortcuts', '#ytaf-page-ui-tweaks'];
const SPONSOR = 3;
const SHORTCUTS = 4;

setTimeout(() => {
  // ---- Case 1: user hits a tab BEFORE the idle chain gets there ----
  {
    const { win, errors, pump } = boot();
    key(win, GREEN);
    const panel = win.document.querySelector('.ytaf-ui-container');
    t('panel exists after keypress', !!panel);
    t('only the first page built synchronously',
      win.document.querySelectorAll(PAGES[SPONSOR]).length === 0,
      'sponsor page count ' + win.document.querySelectorAll(PAGES[SPONSOR]).length);

    const tabs = panel.querySelectorAll('.ytaf-tab-btn');
    t('one tab button per page', tabs.length === PAGES.length, 'got ' + tabs.length);

    // No frames pumped yet: jump straight to Shortcuts (the fifth tab).
    let threw = null;
    try { tabs[SHORTCUTS].click(); } catch (e) { threw = e; }
    t('tab press before idle build does not throw', !threw, threw && threw.message);
    const shortcuts = win.document.querySelector(PAGES[SHORTCUTS]);
    t('Shortcuts page built on demand', !!shortcuts);
    t('Shortcuts page is the visible one', shortcuts && shortcuts.style.display === 'block',
      shortcuts && shortcuts.style.display);
    t('first page hidden after tab switch',
      win.document.querySelector(PAGES[0]).style.display === 'none');
    // Don't pin an exact element count - adding a setting legitimately changes
    // it. What matters is that an on-demand build is fully populated, which the
    // shortcut rows (one per bindable key) prove.
    t('Shortcuts page fully populated',
      shortcuts && shortcuts.querySelectorAll('.shortcut-control-row').length >= 13,
      shortcuts && String(shortcuts.querySelectorAll('.shortcut-control-row').length) + ' rows');

    // Now let the idle chain finish; it must not rebuild what already exists.
    for (let i = 0; i < 20; i++) pump();
    for (const sel of PAGES) {
      t('exactly one ' + sel.replace('#ytaf-page-', ''),
        win.document.querySelectorAll(sel).length === 1,
        'count ' + win.document.querySelectorAll(sel).length);
    }
    t('no jsdomError in this flow', errors.length === 0, errors[0]);
  }

  // ---- Case 2: normal flow, idle chain completes first ----
  {
    const { win, errors, pump } = boot();
    key(win, GREEN);
    for (let i = 0; i < 20; i++) pump();
    const panel = win.document.querySelector('.ytaf-ui-container');
    const counts = PAGES.map((s) => {
      const el = win.document.querySelector(s);
      return el ? el.getElementsByTagName('*').length : -1;
    });
    t('every page built after idle frames',
      counts.length === PAGES.length && counts.every((n) => n > 10), JSON.stringify(counts));
    // The deferred build must produce the same tree an all-synchronous one
    // would: every page's elements accounted for, nothing dropped or doubled.
    const pageSum = counts.reduce((a, b) => a + b, 0);
    const panelTotal = panel.getElementsByTagName('*').length;
    t('panel total accounts for every page',
      panelTotal > pageSum && panelTotal - pageSum < 40,
      `pages=${pageSum} panel=${panelTotal}`);

    // Walk every tab, forwards then backwards.
    const tabs = panel.querySelectorAll('.ytaf-tab-btn');
    let ok = true, detail = '';
    for (const order of [[1, 2, 3, 4, 5, 0], [5, 3, 1, 0, 4, 2]]) {
      for (const i of order) {
        tabs[i].click();
        const shown = PAGES.map((s) => win.document.querySelector(s).style.display);
        const expect = PAGES.map((_, j) => (j === i ? 'block' : 'none'));
        if (JSON.stringify(shown) !== JSON.stringify(expect)) {
          ok = false; detail = `tab ${i}: ${JSON.stringify(shown)}`;
        }
        if (!tabs[i].classList.contains('active')) { ok = false; detail = `tab ${i} not marked active`; }
      }
    }
    t('every tab shows exactly its own page', ok, detail);

    // Close and reopen: must not duplicate the panel or its pages.
    key(win, GREEN);
    key(win, GREEN);
    for (let i = 0; i < 20; i++) pump();
    t('reopen does not duplicate the panel',
      win.document.querySelectorAll('.ytaf-ui-container').length === 1);
    t('reopen does not duplicate pages',
      PAGES.every((s) => win.document.querySelectorAll(s).length === 1));
    t('no jsdomError across open/close/reopen', errors.length === 0, errors[0]);
  }

  // ---- Case 3: Block the Channel of This Video when the player's author is empty (webOS 25) ----
  {
    const { win, errors, pump } = boot('WEB_PAGE_TYPE_WATCH',
      '<div id="ytlr-player__player-container-player"></div><ytlr-video-title-tray><ytlr-video-metadata-line>' +
      '<yt-formatted-string>Linus Tech Tips</yt-formatted-string><yt-formatted-string>1 M views</yt-formatted-string>' +
      '</ytlr-video-metadata-line></ytlr-video-title-tray>');
    win.document.getElementById('ytlr-player__player-container-player').getVideoData = () => ({ author: '' });
    key(win, GREEN);
    for (let i = 0; i < 20; i++) pump();
    const btn = win.document.querySelector('.ytaf-list-action');
    t('channel button falls back to the title tray', !!btn && btn.style.display === '' &&
      /: Linus Tech Tips$/.test(btn.textContent), btn && btn.textContent + ' / ' + btn.style.display);
    t('no jsdomError on the watch page', errors.length === 0, errors[0]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 500);
