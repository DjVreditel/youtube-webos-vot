import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

function code(name) {
  return ts.transpileModule(
    fs.readFileSync(new URL(`../src/vot/${name}.ts`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
}

test('translation entry is mounted beside Settings, survives controls replacement and never floats over video', () => {
  const dom = new JSDOM(
    '<body><yt-focus-container idomkey="controls"><ytlr-player-actions-container><ytlr-button-renderer><button aria-label="Настройки">gear</button></ytlr-button-renderer></ytlr-player-actions-container></yt-focus-container></body>',
    { runScripts: 'outside-only' }
  );
  const w = dom.window;
  w.exports = {};
  w.require = () => ({ default: 'data:image/png;base64,test' });
  w.eval(code('controls-button'));
  let opened = 0;
  const dispose = w.exports.installTranslationButton(() => opened++);
  let button = w.document.querySelector('.ytaf-vot-controls-button');
  assert.equal(button.textContent, '');
  assert.ok(button.querySelector('img'));
  assert.equal(
    button.parentElement.nextElementSibling.firstElementChild.getAttribute(
      'aria-label'
    ),
    'Настройки приложения VOT'
  );
  assert.equal(button.parentElement.nextElementSibling.textContent, '');
  assert.equal(
    button.parentElement.nextElementSibling.nextElementSibling.tagName,
    'YTLR-BUTTON-RENDERER'
  );
  button.click();
  assert.equal(opened, 1);
  const gear = w.document.querySelector('[aria-label="Настройки"]');
  gear.focus();
  gear.dispatchEvent(
    new w.KeyboardEvent('keydown', { keyCode: 37, bubbles: true })
  );
  assert.equal(
    w.document.activeElement.getAttribute('aria-label'),
    'Настройки приложения VOT'
  );
  w.document.activeElement.dispatchEvent(
    new w.KeyboardEvent('keydown', { keyCode: 37, bubbles: true })
  );
  assert.equal(w.document.activeElement, button);
  button.dispatchEvent(
    new w.KeyboardEvent('keydown', { keyCode: 13, bubbles: true })
  );
  assert.equal(opened, 2);
  assert.equal(w.document.activeElement, gear);
  button.focus();
  button.dispatchEvent(
    new w.KeyboardEvent('keydown', { keyCode: 39, bubbles: true })
  );
  assert.equal(
    w.document.activeElement.getAttribute('aria-label'),
    'Настройки приложения VOT'
  );
  w.document.activeElement.dispatchEvent(
    new w.KeyboardEvent('keydown', { keyCode: 39, bubbles: true })
  );
  assert.equal(w.document.activeElement, gear);
  const controls = w.document.querySelector('yt-focus-container');
  controls.style.display = 'none';
  assert.ok(controls.contains(button));
  controls.innerHTML =
    '<ytlr-player-actions-container><button aria-label="Settings">gear</button></ytlr-player-actions-container>';
  w.dispatchEvent(new w.Event('ytaf-page-update'));
  button = w.document.querySelector('.ytaf-vot-controls-button');
  assert.equal(
    button.parentElement.nextElementSibling.nextElementSibling.getAttribute(
      'aria-label'
    ),
    'Settings'
  );
  w.dispatchEvent(new w.Event('ytaf-page-update'));
  assert.equal(
    w.document.querySelectorAll('.ytaf-vot-controls-button').length,
    2
  );
  dispose();
  assert.equal(w.document.querySelector('.ytaf-vot-controls-button'), null);
  w.close();
});

test('both menus return native focus; Up/Down from a custom button reach YouTube once', () => {
  const dom = new JSDOM(
    '<body><ytlr-player-actions-container><button aria-label="Settings">gear</button></ytlr-player-actions-container></body>',
    { runScripts: 'outside-only' }
  );
  const w = dom.window;
  w.exports = {};
  w.require = () => ({ default: 'data:image/png;base64,test' });
  w.eval(code('controls-button'));
  const gear = w.document.querySelector('[aria-label="Settings"]');
  let appOpened = 0,
    translationOpened = 0;
  w.ytaf_showOptionsPanel = (show) => {
    assert.equal(show, true);
    assert.equal(w.document.activeElement, gear);
    appOpened++;
  };
  const dispose = w.exports.installTranslationButton(() => {
    assert.equal(w.document.activeElement, gear);
    translationOpened++;
  });
  const buttons = [...w.document.querySelectorAll('.ytaf-vot-controls-button')];
  buttons[1].focus();
  buttons[1].dispatchEvent(
    new w.KeyboardEvent('keydown', {
      keyCode: 13,
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(appOpened, 1);
  buttons[0].focus();
  buttons[0].click();
  assert.equal(translationOpened, 1);
  const nativeKeys = [];
  gear.addEventListener('keydown', (event) => nativeKeys.push(event.keyCode));
  for (const keyCode of [38, 40]) {
    buttons[0].focus();
    buttons[0].dispatchEvent(
      new w.KeyboardEvent('keydown', {
        keyCode,
        bubbles: true,
        cancelable: true
      })
    );
    assert.equal(w.document.activeElement, gear);
  }
  assert.deepEqual(nativeKeys, [38, 40]);
  w.document.body.focus();
  w.dispatchEvent(new w.Event('ytaf-options-closed'));
  assert.equal(w.document.activeElement, gear);
  dispose();
  w.close();
});

test('focus redraw restores the same icons before the next frame without a timer or page event', async () => {
  const markup =
    '<button aria-label="Like">like</button><button aria-label="Dislike">dislike</button><ytlr-button-renderer><button aria-label="Settings">gear</button></ytlr-button-renderer>';
  const dom = new JSDOM(
    `<body><ytlr-player-actions-container>${markup}</ytlr-player-actions-container></body>`,
    { runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  w.exports = {};
  w.require = () => ({ default: 'data:image/png;base64,test' });
  w.eval(code('controls-button'));
  let opened = 0;
  const dispose = w.exports.installTranslationButton(() => opened++);
  try {
    const host = w.document.querySelector('ytlr-player-actions-container');
    const originals = [...host.querySelectorAll('.ytaf-vot-controls-button')];
    const images = originals.map((button) => button.firstElementChild);
    for (let i = 0; i < 8; i++) {
      // Mimic YouTube reconciling the row when focus moves between native items.
      host.innerHTML = markup;
      const focused = host.querySelector(
        `[aria-label="${i % 2 ? 'Like' : 'Dislike'}"]`
      );
      focused.focus();
      await Promise.resolve(); // MutationObserver delivery, not the 1000ms fallback.
      assert.deepEqual(
        [...host.querySelectorAll('.ytaf-vot-controls-button')],
        originals
      );
      assert.equal(
        w.document.activeElement,
        focused,
        'repair must not steal native focus'
      );
      originals.forEach((button, index) =>
        assert.equal(button.firstElementChild, images[index])
      );
    }
    await new Promise((resolve) => w.requestAnimationFrame(resolve));
    assert.equal(host.querySelectorAll('.ytaf-vot-controls-button').length, 2);
    originals[0].click();
    assert.equal(opened, 1, 'reattaching does not duplicate click listeners');
    dispose();
    host.innerHTML = markup;
    await Promise.resolve();
    assert.equal(
      host.querySelector('.ytaf-vot-controls-button'),
      null,
      'disposed observer stays disconnected'
    );
  } finally {
    dispose();
    w.close();
  }
});

test('partial reconciliation repairs a missing icon and rebinds a replaced native Settings target', async () => {
  const dom = new JSDOM(
    '<body><ytlr-player-actions-container><ytlr-button-renderer><button aria-label="Settings">gear</button></ytlr-button-renderer></ytlr-player-actions-container></body>',
    { runScripts: 'outside-only' }
  );
  const w = dom.window;
  w.exports = {};
  w.require = () => ({ default: 'data:image/png;base64,test' });
  w.eval(code('controls-button'));
  const dispose = w.exports.installTranslationButton(() => {});
  try {
    const buttons = [
      ...w.document.querySelectorAll('.ytaf-vot-controls-button')
    ];
    const image = buttons[0].firstElementChild;
    image.remove();
    const renderer = w.document.querySelector('ytlr-button-renderer');
    renderer.innerHTML = '<button aria-label="Settings">new gear</button>';
    await Promise.resolve();
    assert.equal(buttons[0].firstElementChild, image);
    const gear = renderer.firstElementChild;
    gear.focus();
    gear.dispatchEvent(
      new w.KeyboardEvent('keydown', { keyCode: 37, bubbles: true })
    );
    assert.equal(w.document.activeElement, buttons[1]);
    buttons[1].dispatchEvent(
      new w.KeyboardEvent('keydown', { keyCode: 39, bubbles: true })
    );
    assert.equal(w.document.activeElement, gear);
  } finally {
    dispose();
    w.close();
  }
});

class Media extends EventTarget {
  _volume = 0.8;
  _muted = false;
  get volume() {
    return this._volume;
  }
  set volume(value) {
    this._volume = value;
    this.dispatchEvent(new Event('volumechange'));
  }
  get muted() {
    return this._muted;
  }
  set muted(value) {
    this._muted = value;
    this.dispatchEvent(new Event('volumechange'));
  }
}

function audio() {
  const exports = {};
  const timers = new Set();
  new Function(
    'exports',
    'setInterval',
    'clearInterval',
    code('original-volume')
  )(
    exports,
    (fn) => {
      timers.add(fn);
      return fn;
    },
    (fn) => timers.delete(fn)
  );
  let current = new Media();
  let volume = 80;
  const player = {
    getVolume: () => volume,
    setVolume: (v) => {
      volume = v;
      current.volume = v / 100;
    }
  };
  const guard = new exports.OriginalVolume(
    () => current,
    () => player
  );
  return {
    guard,
    timers,
    player,
    media: () => current,
    setMedia: (media) => {
      current = media;
    },
    reset: () => {
      volume = 100;
      current.volume = 1;
    },
    volume: () => volume
  };
}

test('YouTube automatic volume reset is corrected without changing the selected video level', () => {
  const b = audio();
  b.guard.start(0.15);
  assert.equal(b.media().volume, 0.15);
  b.reset();
  assert.equal(b.volume(), 15);
  assert.equal(b.media().volume, 0.15);
  b.guard.setLevel(0.4);
  assert.equal(b.volume(), 40);
  b.guard.stop();
  assert.equal(b.media().volume, 0.8);
  assert.equal(b.volume(), 80);
  assert.equal(b.timers.size, 0);
});

test('audio-track media replacement is rebound; zero mutes only YouTube and is reversible', () => {
  const b = audio();
  const previous = b.media();
  b.guard.start(0.15);
  b.setMedia(new Media());
  b.guard.refresh();
  assert.equal(previous.volume, 0.8);
  assert.equal(b.media().volume, 0.15);
  b.guard.setLevel(0);
  assert.equal(b.media().muted, true);
  assert.equal(b.volume(), 0);
  b.reset();
  assert.equal(b.media().volume, 0);
  assert.equal(b.media().muted, true);
  b.guard.setLevel(0.3);
  assert.equal(b.media().muted, false);
  assert.equal(b.media().volume, 0.3);
  b.guard.stop();
  assert.equal(b.media().volume, 0.8);
  assert.equal(b.media().muted, false);
});

test('missing or failing player volume API does not stop translation volume control', () => {
  const b = audio();
  b.player.getVolume = () => {
    throw Error('player rebuilding');
  };
  b.player.setVolume = () => {
    throw Error('player rebuilding');
  };
  b.guard.start(0.15);
  b.guard.setLevel(0);
  assert.equal(b.media().muted, true);
  b.guard.stop();
  assert.equal(b.media().volume, 0.8);
  assert.equal(b.media().muted, false);
});
