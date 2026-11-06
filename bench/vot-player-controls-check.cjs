const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const dom = new JSDOM(
  '<body class="WEB_PAGE_TYPE_WATCH"><ytlr-app></ytlr-app><yt-focus-container idomkey="controls"><ytlr-player-actions-container><button aria-label="Settings">gear</button></ytlr-player-actions-container></yt-focus-container></body>',
  {
    runScripts: 'outside-only',
    url: 'https://www.youtube.com/tv',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  }
);
const w = dom.window;
w.launchParams = '{}';
w.XMLHttpRequest = class {
  open() {}
  send() {}
  setRequestHeader() {}
  getResponseHeader() {
    return null;
  }
  addEventListener() {}
};
w.localStorage.setItem(
  'ytaf-configuration',
  JSON.stringify({
    enableVot: false,
    enableSponsorBlock: false,
    enableReturnYouTubeDislike: false,
    enableLegacyEmojiFix: false,
    upgradeThumbnails: false
  })
);
w.eval(fs.readFileSync('dist/webOSUserScripts/userScript.js', 'utf8'));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  try {
    await delay(1200);
    const gear = w.document.querySelector('[aria-label="Settings"]');
    const buttons = [
      ...w.document.querySelectorAll('.ytaf-vot-controls-button')
    ];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].textContent, '');
    assert.equal(buttons[1].textContent, '');
    assert.ok(
      buttons[0].querySelector('img').src.startsWith('data:image/png;base64,')
    );
    assert.ok(
      buttons[1].querySelector('img').src.startsWith('data:image/png;base64,')
    );
    assert.notEqual(
      buttons[0].querySelector('img').src,
      buttons[1].querySelector('img').src
    );
    w.document.body.dispatchEvent(
      new w.MouseEvent('mousemove', {
        bubbles: true,
        clientX: 600,
        clientY: 350
      })
    );
    assert.equal(w.document.querySelector('#ytaf-pointer-btn'), null);
    buttons[1].click();
    assert.equal(
      w.document.querySelector('.ytaf-ui-container').style.display,
      'block'
    );
    await delay(550);
    w.ytaf_showOptionsPanel(false);
    assert.equal(w.document.activeElement, gear);
    buttons[0].click();
    assert.equal(
      w.document.querySelector('.ytaf-vot-menu').style.display,
      'block'
    );
    const key = (code) =>
      w.document.activeElement.dispatchEvent(
        new w.KeyboardEvent('keydown', {
          keyCode: code,
          bubbles: true,
          cancelable: true
        })
      );
    // The second click must close even after the pointer has left the panel.
    gear.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true }));
    buttons[0].click();
    assert.equal(
      w.document.querySelector('.ytaf-vot-root').style.display,
      'none'
    );
    buttons[0].click();
    const close = w.document.querySelector(
      '[aria-label="Закрыть меню перевода"]'
    );
    close.dispatchEvent(new w.MouseEvent('mouseenter'));
    key(13); // Magic Remote OK on the cross must not activate the last settings row.
    assert.equal(
      w.document.querySelector('.ytaf-vot-root').style.display,
      'none'
    );
    assert.equal(w.document.activeElement, gear);
    buttons[0].click();
    close.click();
    assert.equal(
      w.document.querySelector('.ytaf-vot-root').style.display,
      'none'
    );
    buttons[0].click();
    key(461);
    key(461);
    assert.equal(w.document.activeElement, gear);
    const arrows = [];
    gear.addEventListener('keydown', (e) => arrows.push(e.keyCode));
    key(38);
    key(40);
    assert.deepEqual(arrows, [38, 40]);
    assert.equal(w.document.querySelector('#ytaf-pointer-btn'), null);
    console.log(
      'Compiled bundle: icon entries, toggle after pointer exit, close by pointer/remote OK, native focus and arrows PASS'
    );
  } finally {
    w.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
