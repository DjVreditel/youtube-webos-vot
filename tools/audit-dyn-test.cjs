// Dynamic test harness: runs the shipped userScript.js inside Chromium on a
// synthetic https://www.youtube.com/tv page. Every request is intercepted
// (nothing reaches the real network), logged with its headers and body, and
// searched for the synthetic credentials planted in cookies, localStorage
// and request headers.
// Usage: node tools/audit-dyn-test.cjs <userScript.js> <webOS-year> <out.json>
// Optional: CFG='{"enableTrackingBlock":true}' presets the app settings.
// Needs Playwright (not a dependency of this repo); see SECURITY_AUDIT.md.
const { chromium } = require('playwright');
const fs = require('fs');

const [bundle, year, outFile] = process.argv.slice(2);

// `host` is `domain` or one of its subdomains. A bare suffix test would also
// match evilyoutube.com, and a leak to it would pass as first-party.
const onDomain = (host, domain) => host === domain || host.endsWith('.' + domain);
const SPONSORBLOCK_HOSTS = ['sponsor.ajay.app', 'sponsorblock.inf.re'];

const SECRETS = {
  SID: 'SYNTHSID0000cookie1111',
  SAPISID: 'SYNTHSAPISID2222cookie',
  LOGIN_INFO: 'SYNTHLOGININFO3333',
  ACCESS: 'ya29.SYNTHACCESSTOKEN4444',
  REFRESH: '1//SYNTHREFRESHTOKEN5555',
  VISITOR: 'SYNTHVISITOR6666'
};

const PAGE = `<!doctype html><html><head><title>YouTube</title></head>
<body class="WEB_PAGE_TYPE_BROWSE"><ytlr-app><ytlr-tv-surface-content>
<div id="ytlr-player__player-container"><video id="v1"></video></div>
</ytlr-tv-surface-content></ytlr-app></body></html>`;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const browser = await (process.env.CHROMIUM_PATH
    ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
    : chromium.launch());
  const ua = `Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager webOS.TV-${year}`;
  const context = await browser.newContext({ userAgent: ua });
  await context.addCookies([
    { name: 'SID', value: SECRETS.SID, domain: '.youtube.com', path: '/', secure: true, httpOnly: true },
    { name: 'SAPISID', value: SECRETS.SAPISID, domain: '.youtube.com', path: '/', secure: true },
    { name: 'LOGIN_INFO', value: SECRETS.LOGIN_INFO, domain: '.youtube.com', path: '/', secure: true, httpOnly: true },
    { name: 'VISITOR_INFO1_LIVE', value: SECRETS.VISITOR, domain: '.youtube.com', path: '/', secure: true }
  ]);

  const requests = [];
  const luna = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    let headers = {};
    try { headers = await req.allHeaders(); } catch {}
    requests.push({ method: req.method(), url, headers, body: req.postData() || null, type: req.resourceType() });
    const host = new URL(url).hostname;
    if (url.startsWith('https://www.youtube.com/tv')) return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    if (onDomain(host, 'ytimg.com') || onDomain(host, 'cdnjs.cloudflare.com') || onDomain(host, 'gstatic.com')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (host === 'returnyoutubedislikeapi.com') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"dislikes":4242}' });
    if (SPONSORBLOCK_HOSTS.includes(host)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[{"videoID":"dQw4w9WgXcQ","segments":[{"category":"sponsor","actionType":"skip","segment":[1,5],"UUID":"x"}]}]' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });

  const page = await context.newPage();
  const consoleLog = [];
  page.on('console', (m) => consoleLog.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  page.on('pageerror', (e) => consoleLog.push(`pageerror: ${e.message}`.slice(0, 300)));

  // Stub of the webOS Luna bridge: records every service call the app makes.
  await page.exposeFunction('__lunaRecord', (uri, params) => { luna.push({ uri, params }); });
  await page.addInitScript(() => {
    window.PalmServiceBridge = function () {
      this.call = (uri, params) => { window.__lunaRecord(uri, params); };
      this.cancel = () => {};
    };
    window.launchParams = JSON.stringify({ contentTarget: 'v=dQw4w9WgXcQ' });
  });

  await page.goto('https://www.youtube.com/tv#/');
  await page.evaluate((s) => {
    // The leanback client's own records (shapes as the app reads them) plus
    // synthetic token entries, so any code reading storage would carry them.
    localStorage.setItem('yt.leanback.default::last-identity-used', JSON.stringify({ data: { identityType: 'SIGNED_IN', accessToken: s.ACCESS } }));
    localStorage.setItem('yt.leanback.default::recurring_actions', JSON.stringify({ data: { data: { 'startup-screen-account-selector-with-guest': { lastFired: 0 } } } }));
    localStorage.setItem('yt.leanback.synthetic::refresh-token', JSON.stringify({ data: s.REFRESH }));
    if (s.CFG) localStorage.setItem('ytaf-configuration', s.CFG);
  }, Object.assign({ CFG: process.env.CFG || '' }, SECRETS));
  await page.addScriptTag({ path: bundle });

  // YouTube-like traffic issued by the page after the hooks are in place.
  await page.evaluate(async (s) => {
    const auth = { Authorization: 'Bearer ' + s.ACCESS, 'X-Goog-AuthUser': '0' };
    const body = JSON.stringify({ context: { client: { clientName: 'TVHTML5' } }, playbackContext: { contentPlaybackContext: { vis: 0 } }, videoId: 'dQw4w9WgXcQ' });
    await fetch('https://www.youtube.com/youtubei/v1/player?key=x', { method: 'POST', headers: auth, body }).catch(() => {});
    await fetch('https://www.youtube.com/youtubei/v1/log_event?alt=json', { method: 'POST', headers: auth, body: '{"events":[]}' }).catch(() => {});
    await new Promise((r) => { const x = new XMLHttpRequest(); x.open('POST', 'https://www.youtube.com/api/stats/qoe?docid=1'); x.setRequestHeader('Authorization', 'Bearer ' + s.ACCESS); x.onloadend = r; x.send('qoe'); });
    await new Promise((r) => { const x = new XMLHttpRequest(); x.open('GET', 'https://www.youtube.com/youtubei/v1/browse'); x.onloadend = r; x.send(); });
    // A large player response through the hooked JSON.parse.
    JSON.parse(JSON.stringify({ responseContext: {}, trackingParams: 'TP', playerAds: [{}], adPlacements: [{}], streamingData: {}, videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'x'.repeat(600) } }));
    await fetch('https://www.youtube.com/wake_cast_core').catch(() => {});
    location.hash = '#/watch?v=dQw4w9WgXcQ';
  }, SECRETS);

  // Green key opens the settings panel; also exercise relaunch.
  await page.waitForTimeout(4000);
  await page.keyboard.press('F1').catch(() => {});
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 404, which: 404, bubbles: true })));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { contentTarget: 'v=abcdefghijk' } })));
  await page.waitForTimeout(12000);

  const state = await page.evaluate(() => ({
    storageKeys: Object.keys(localStorage),
    config: localStorage.getItem('ytaf-configuration'),
    panel: !!document.querySelector('.ytaf-ui-container, #ytaf-ui, [class*="ytaf-ui"]'),
    href: location.href
  }));

  const secretVals = Object.values(SECRETS);
  console.log('webOS cast wake requests:', requests.filter(r=>r.url.includes('wake_cast_core')).length);
  const leaks = [];
  for (const r of requests) {
    const host = new URL(r.url).hostname;
    const firstParty = onDomain(host, 'youtube.com');
    const hay = r.url + '\n' + JSON.stringify(r.headers) + '\n' + (r.body || '');
    for (const v of secretVals) if (hay.includes(v)) leaks.push({ host, firstParty, secret: v, url: r.url });
  }
  fs.writeFileSync(outFile, JSON.stringify({ ua, requests, luna, leaks, state, consoleLog }, null, 1));
  const summary = {};
  for (const r of requests) { const h = new URL(r.url).host; summary[h] = (summary[h] || 0) + 1; }
  console.log('hosts:', summary);
  console.log('third-party requests:');
  for (const r of requests) {
    const h = new URL(r.url).hostname;
    if (!onDomain(h, 'youtube.com')) console.log(' ', r.method, r.url, '| cookie:', r.headers.cookie ? 'YES' : 'no', '| referer:', r.headers.referer || '-', '| auth:', r.headers.authorization ? 'YES' : 'no');
  }
  console.log('youtube.com requests:');
  for (const r of requests) if (onDomain(new URL(r.url).hostname, 'youtube.com')) console.log(' ', r.method, r.url.slice(0, 110), '| body:', (r.body || '').slice(0, 80));
  console.log('luna calls:', JSON.stringify(luna));
  console.log('credential occurrences:', JSON.stringify(leaks));
  console.log('state:', JSON.stringify(state).slice(0, 600));
  console.log('page errors:', consoleLog.filter((l) => l.startsWith('pageerror')).slice(0, 5));
  await browser.close();
})();
