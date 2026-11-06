const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const chrome =
  process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-layout-'));
const sourceRoot = 'vot-mod/src/vot/';
const source = process.env.VOT_LAYOUT_SOURCE
  ? fs.readFileSync(process.env.VOT_LAYOUT_SOURCE, 'utf8')
  : fs.readFileSync(sourceRoot + 'controls-button.ts', 'utf8');
const css = process.env.VOT_LAYOUT_CSS
  ? fs.readFileSync(process.env.VOT_LAYOUT_CSS, 'utf8')
  : fs.readFileSync(sourceRoot + 'vot.css', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const prefix = fs
  .readFileSync('cobalt-port/inject/prefix.js', 'utf8')
  .replace('if (!/(^|\\.)youtube\\.com$/.test(location.hostname)) return;', '');
const suffix = fs.readFileSync('cobalt-port/inject/suffix.js', 'utf8');
const assets = {};
for (const f of ['yandex-sign.png', 'menu-sliders.png'])
  assets['./' + f] =
    'data:image/png;base64,' +
    fs.readFileSync(sourceRoot + f).toString('base64');
const row = (kind) =>
  `<div class="pill ${kind}"><ytlr-player-actions-container><ytlr-button-renderer><ytlr-button class="native" tabindex="0" aria-label="Subtitles"><yt-icon>CC</yt-icon></ytlr-button></ytlr-button-renderer><ytlr-button-renderer><ytlr-button class="native" tabindex="0" aria-label="Settings"><yt-icon>⚙</yt-icon></ytlr-button></ytlr-button-renderer></ytlr-player-actions-container></div>`;
const html = `<!doctype html><meta charset="utf-8"><style>
body{background:#222;color:white;font:16px/1.2 Arial;margin:0}.pill{display:inline-block;margin:20px;background:#555;border-radius:40px;padding:0 10px;white-space:nowrap}
yt-focus-container,ytlr-player-actions-container{display:block}ytlr-button-renderer{display:inline-block;vertical-align:baseline}
.native{display:inline-block;box-sizing:border-box;width:56px;height:56px;padding:14px;line-height:28px;vertical-align:baseline}yt-icon{display:inline-block;width:28px;height:28px;vertical-align:middle;font-size:20px;line-height:28px;text-align:center}
.flex ytlr-player-actions-container{display:flex;align-items:center}
${css}</style><body>${row('inline')}<pre id="result"></pre><script>
window.exports={};window.require=f=>({default:(${JSON.stringify(assets)})[f]});
const before=document.querySelector('.pill').getBoundingClientRect().height;
${prefix}\n${code}\nwindow.disposeControls=exports.installTranslationButton(()=>{});\n${suffix}
const measure=()=>{const native=document.querySelector('[aria-label="Settings"] yt-icon').getBoundingClientRect();const buttons=[...document.querySelectorAll('.ytaf-vot-controls-button')];return {height:document.querySelector('.pill').getBoundingClientRect().height,glyphs:buttons.map(b=>{const r=b.firstElementChild.getBoundingClientRect();return {centreDelta:Math.abs(r.top+r.height/2-native.top-native.height/2),sizeDelta:Math.abs(r.width-native.width)};})};};
setTimeout(()=>{const inline=measure();disposeControls();document.querySelector('.pill').className='pill flex';const flexBefore=document.querySelector('.pill').getBoundingClientRect().height;window.disposeControls=exports.installTranslationButton(()=>{});setTimeout(()=>{const flex=measure();document.querySelector('#result').textContent=JSON.stringify({before,inline,flexBefore,flex});disposeControls();},1100);},1100);
</script>`;
try {
  const fixture = path.join(dir, 'fixture.html');
  fs.writeFileSync(fixture, html);
  const result = spawnSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + path.join(dir, 'profile'),
      '--window-size=1920,1080',
      '--virtual-time-budget=2500',
      '--dump-dom',
      'file://' + fixture
    ],
    { encoding: 'utf8', timeout: 25000, maxBuffer: 5e6 }
  );
  const match = result.stdout?.match(/<pre id="result">(.*?)<\/pre>/s);
  assert.ok(match, 'Browser did not return layout measurements');
  const measurements = JSON.parse(match[1]);
  console.log(JSON.stringify(measurements));
  for (const [before, after] of [
    [measurements.before, measurements.inline],
    [measurements.flexBefore, measurements.flex]
  ]) {
    assert.ok(
      Math.abs(before - after.height) < 0.5,
      `Toolbar height changed from ${before} to ${after.height}`
    );
    assert.equal(after.glyphs.length, 2);
    for (const glyph of after.glyphs) {
      assert.ok(glyph.centreDelta < 0.5, 'Icon vertical alignment');
      assert.ok(glyph.sizeDelta < 0.5, 'Icon size');
    }
  }
  console.log(
    'Toolbar height, icon size and alignment: inline and flex layouts PASS'
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
