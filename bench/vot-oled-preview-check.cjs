const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const dom = new JSDOM('<body class="WEB_PAGE_TYPE_BROWSE"><ytlr-app><ytlr-surface-page></ytlr-surface-page><div id="ytlr-player__player-container-player"><video></video></div></ytlr-app></body>', {
  runScripts: 'outside-only', url: 'https://www.youtube.com/tv',
  pretendToBeVisual: true, virtualConsole: new VirtualConsole()
});
const w = dom.window;
Object.defineProperty(w.navigator, 'userAgent', { value: 'Cobalt/23.lts.6' });
w.launchParams = '{}';
w.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} getResponseHeader() { return null; } addEventListener() {} };
w.localStorage.setItem('ytaf-configuration', JSON.stringify({
  enableOledCareMode: true, enableVot: false, enableSponsorBlock: false,
  enableReturnYouTubeDislike: false, enableLegacyEmojiFix: false, upgradeThumbnails: false
}));
const player = w.document.getElementById('ytlr-player__player-container-player');
const video = player.querySelector('video');
const surface = w.document.querySelector('ytlr-surface-page');
let inline = false;
player.isInline = () => inline;
Object.defineProperty(video, 'readyState', { value: 4 });

try {
  w.eval(fs.readFileSync('dist/webOSUserScripts/userScript.js', 'utf8'));
  const background = () => w.getComputedStyle(surface).backgroundColor;
  assert.equal(background(), 'rgb(0, 0, 0)');
  inline = true;
  video.dispatchEvent(new w.Event('loadeddata'));
  assert.equal(background(), 'rgba(0, 0, 0, 0)');
  assert.ok(w.document.documentElement.classList.contains('oled-theme-active'));
  assert.equal(JSON.parse(w.localStorage.getItem('ytaf-configuration')).enableOledCareMode, true);
  w.document.body.className = 'WEB_PAGE_TYPE_WATCH';
  w.dispatchEvent(new w.Event('ytaf-page-update'));
  assert.equal(background(), 'rgb(0, 0, 0)');
  console.log('Compiled OLED styles: black browse background, transparent preview and restored watch background PASS');
} finally {
  w.dispatchEvent(new w.Event('beforeunload'));
  w.close();
}
