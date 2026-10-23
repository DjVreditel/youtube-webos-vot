/**
 * Behaviour of thumbnail-quality.js and return-dislike.js: thumbnail URLs are
 * upgraded in the parsed response and verified by probes, and the dislike
 * panel must still be detected by focus and navigate the same way.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyChrome38Downgrade, UA, setUserAgent } = require('./chrome38-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const bundlePath = process.argv[2] || ROOT + '/dist/webOSUserScripts/userScript.js';

function boot(cfg, html, url) {
  const dom = new JSDOM(html, { runScripts: 'outside-only',
    url: url || 'https://www.youtube.com/tv', virtualConsole: new VirtualConsole(),
    pretendToBeVisual: true });
  const win = dom.window;
  setUserAgent(win, UA.webos3);
  win.launchParams = '{}';
  const probed = [];
  win.XMLHttpRequest = class {
    open(m, u) { this._u = u; } send() { probed.push(this._u); if (this.onerror) this.onerror(); }
    setRequestHeader() {} getResponseHeader() { return null; } addEventListener() {}
  };
  let rafQ = [];
  win.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
  win.cancelAnimationFrame = () => {};
  win.fetch = () => Promise.reject(new Error('offline'));
  win.Element.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0 };
  };
  win.Element.prototype.scrollIntoView = function () {};
  // jsdom never loads images, so the module's WebP feature-detect would await a
  // promise that never settles and no upgrade would ever run. Resolve it as
  // "no webp", which is the Chromium 38 answer anyway. Tiles on screen are
  // probed by loading the image (thumbnail-quality.js imageExists), not by a
  // HEAD request, so image loads count as probes too.
  win.Image = class { set src(v) { probed.push(v); setTimeout(() => this.onerror && this.onerror(), 0); } };
  win.localStorage.setItem('ytaf-configuration', win.JSON.stringify(Object.assign({
    enableAdBlock: true, enableLegacyEmojiFix: false, enableSponsorBlock: false,
    enableReturnYouTubeDislike: false, upgradeThumbnails: false, enableAutoLogin: false
  }, cfg)));
  applyChrome38Downgrade(win);
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  return { win, probed, pump: () => { const q = rafQ; rafQ = []; for (const cb of q) cb(0); } };
}

let pass = 0, fail = 0;
const t = (n, ok, extra) => { if (ok) { pass++; console.log('PASS ' + n); }
  else { fail++; console.log('FAIL ' + n + (extra ? '\n     ' + extra : '')); } };
const tick = () => new Promise((r) => setTimeout(r, 0));

setTimeout(async () => {
  // ---- thumbnail-quality: URLs are rewritten in the parsed response ----
  // The module works inside adblock.js's JSON.parse hook, on the response
  // before the app sees it, and verifies unproven rungs with background probes.
  const pad = 'z'.repeat(600);
  const tileResponse = (NS, ids) => NS({
    responseContext: { _pad: pad },
    contents: { anything: { items: ids.map((id) => ({ tileRenderer: { header: { tileHeaderRenderer: {
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', width: 480, height: 360 }] }
    } } } })) } }
  });
  const urlsOf = (out) => out.contents.anything.items.map(
    (it) => it.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url);
  const html = '<!doctype html><html><body class="WEB_PAGE_TYPE_BROWSE"><ytlr-app></ytlr-app></body></html>';

  {
    const { win, probed } = boot({ upgradeThumbnails: true, thumbnailQualityMode: 'eager' }, html);
    await tick();
    const out = win.JSON.parse(tileResponse(win.JSON.stringify, ['abc123XYZ_-']));
    t('eager mode: tile rewritten to maxresdefault',
      urlsOf(out)[0] === 'https://i.ytimg.com/vi/abc123XYZ_-/maxresdefault.jpg', urlsOf(out)[0]);
    await new Promise((r) => setTimeout(r, 1500));
    t('eager mode: the unproven rung is verified', probed.some((u) => /abc123XYZ_-\/maxresdefault/.test(u)),
      'probed: ' + probed.slice(0, 4).join(' | '));
  }

  {
    const { win, probed } = boot({ upgradeThumbnails: true, thumbnailQualityMode: 'safe' }, html);
    await tick();
    const out = win.JSON.parse(tileResponse(win.JSON.stringify, ['safe0000000']));
    t('safe mode: unproven rung is not drawn',
      urlsOf(out)[0] === 'https://i.ytimg.com/vi/safe0000000/hqdefault.jpg', urlsOf(out)[0]);
    await new Promise((r) => setTimeout(r, 1500));
    t('safe mode: a probe asks for the higher rung',
      probed.some((u) => /safe0000000\/maxresdefault/.test(u)), 'probed: ' + probed.slice(0, 4).join(' | '));
    t('safe mode: the rung it already has is never probed',
      !probed.some((u) => /hqdefault/.test(u)), 'probed: ' + probed.join(' | '));
  }

  {
    const { win, probed } = boot({ upgradeThumbnails: false, thumbnailQualityMode: 'eager' }, html);
    await tick();
    const out = win.JSON.parse(tileResponse(win.JSON.stringify, ['off00000000']));
    await new Promise((r) => setTimeout(r, 1500));
    t('switched off: response left alone and nothing probed',
      /off00000000\/hqdefault/.test(urlsOf(out)[0]) && !probed.some((u) => /off00000000/.test(u)),
      urlsOf(out)[0] + ' / probed: ' + probed.join(' | '));
  }

  // ---- return-dislike: panel detection + navigation ----
  {
    const { win, pump } = boot({ enableReturnYouTubeDislike: true },
      '<!doctype html><html><body class="WEB_PAGE_TYPE_WATCH"><ytlr-app>' +
      '<div id="ytlr-player__player-container"><video></video></div></ytlr-app></body></html>',
      'https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ');
    await new Promise((r) => setTimeout(r, 900));
    const d = win.document;
    const ryd = win.returnYouTubeDislike;
    t('RYD instance created', !!ryd);

    // Build a description panel a few levels below <ytlr-app>, as YouTube does.
    const app = d.querySelector('ytlr-app');
    const wrap1 = d.createElement('div'); const wrap2 = d.createElement('div');
    const panel = d.createElement('ytlr-structured-description-content-renderer');
    const items = [];
    for (let i = 0; i < 4; i++) {
      const it = d.createElement('div');
      it.setAttribute('role', 'menuitem');
      it.setAttribute('tabindex', '0');
      const inner = d.createElement('span');       // focus lands on a child
      inner.setAttribute('tabindex', '0');
      it.appendChild(inner);
      panel.appendChild(it); items.push({ it, inner });
    }
    wrap2.appendChild(panel); wrap1.appendChild(wrap2); app.appendChild(wrap1);
    await tick(); pump(); await tick();

    // Focus a descendant: panel must be discovered by ancestor walk.
    items[1].inner.focus();
    await tick();
    t('panel detected by focus (ancestor walk)', ryd.panelElement === panel,
      ryd.panelElement ? ryd.panelElement.tagName : 'null');
    t('panel marked focused', ryd.isPanelFocused === true);
    t('menu item resolved from a focused child',
      ryd.lastFocusedElement === items[1].it,
      ryd.lastFocusedElement ? ryd.lastFocusedElement.getAttribute('role') : 'null');

    // Arrow key navigation still moves within the panel.
    // jsdom makes Event#isTrusted an unforgeable own property, so a dispatched
    // event can never look like a real remote press. Call the handler directly
    // with a plain object for the "real press" cases; the dispatch path is still
    // exercised by the synthetic-marker case below.
    const key = (code, synthetic) => {
      const e = { isTrusted: true, keyCode: code,
                  key: code === 40 ? 'ArrowDown' : code === 38 ? 'ArrowUp' : 'Enter',
                  preventDefault() {}, stopPropagation() {} };
      if (synthetic) e.__ytafSynthetic = true;
      ryd.handleNavigation(e);
      return e;
    };
    const before = ryd.focusedIndex;
    key(40);   // ArrowDown
    await tick();
    t('ArrowDown advances the focused item', ryd.focusedIndex === (before + 1) % 4,
      `${before} -> ${ryd.focusedIndex}`);

    // A key this mod synthesised must be ignored - both via the direct call and
    // through a real dispatched event carrying the marker.
    const idx = ryd.focusedIndex;
    key(40, true);
    await tick();
    t('mod-synthesised ArrowDown is ignored (marker)', ryd.focusedIndex === idx,
      `${idx} -> ${ryd.focusedIndex}`);

    const de = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(de, 'keyCode', { get: () => 40, configurable: true });
    de.__ytafSynthetic = true;
    d.activeElement.dispatchEvent(de);
    await tick();
    t('mod-synthesised ArrowDown ignored through real dispatch',
      ryd.focusedIndex === idx, `${idx} -> ${ryd.focusedIndex}`);

    // Focus leaving the panel clears the flag.
    const outside = d.createElement('div');
    outside.setAttribute('tabindex', '0');
    app.appendChild(outside);
    outside.focus();
    await tick();
    t('focus outside the panel clears isPanelFocused', ryd.isPanelFocused === false);
  }

  // ---- video-quality: Force Max Quality upgrades to the video's best level ----
  // A 1440p video that plays in 720p is not "max" (it used to count as max
  // because 720p is a named level, so nothing was ever upgraded).
  for (const [start, want] of [['hd720', 1], ['hd1440', 0]]) {
    const { win, pump } = boot({ forceHighResVideo: true },
      '<body class="WEB_PAGE_TYPE_WATCH"><div id="ytlr-player__player-container-player"></div></body>',
      'https://www.youtube.com/tv#/watch?v=abc');
    const p = win.document.getElementById('ytlr-player__player-container-player');
    let q = start, set = 0;
    Object.assign(p, {
      setPlaybackQualityRange() { set++; q = 'hd1440'; }, setPlaybackQuality() {},
      getPlaybackQuality: () => q, getPlaybackQualityLabel: () => q,
      getAvailableQualityLevels: () => ['hd1440', 'hd1080', 'hd720', 'auto'],
      getVideoData: () => ({ video_id: 'abc' }), getPlayerState: () => 1,
      pauseVideo() {}, playVideo() {}, isInline: () => false, addEventListener() {}
    });
    win.dispatchEvent(new win.CustomEvent('yt-navigate-finish', { detail: { pageType: 'watch' } }));
    await new Promise((r) => setTimeout(r, 300));
    pump(); pump();
    t(`force max quality from ${start}: ${want ? 'upgrades' : 'leaves it'}`, set === want, `set=${set}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 500);
