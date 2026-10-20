import { configRead } from './config.js';
import { isSearchPage, COLOR_CODE_MAP, SYNTHETIC_KEY_FLAG } from './utils.js';

/**
 * Type in Search with a Keyboard.
 *
 * On the search page, a USB or Bluetooth keyboard's printable keys go into the
 * search query. YouTube TV holds the query behind its on-screen keyboard, with
 * no text field to write into, so typing is done by pressing that keyboard's
 * keys for the viewer: the key whose label is the character typed, and the
 * space, backspace and search keys for Space, Backspace and Enter.
 *
 * Some builds of the TV app already take printable keys natively. Which one
 * this TV runs is not known up front, so the first character is a probe: it
 * goes to YouTube untouched, and if the query changed, the app types by itself
 * and this module stays out of the way for the rest of the session. If it did
 * not, that character (and any typed while waiting) is typed on the on-screen
 * keyboard, and each way of pressing a key is tried until the query changes.
 * If none changes it, typing is left alone until the next search page visit.
 *
 * What counts as typing, so the remote keeps working as before:
 *   - letters, space and punctuation are text on the search page;
 *   - digits only within a few seconds of another typed character: on their
 *     own, the remote's number keys are shortcuts;
 *   - Enter submits only right after typing (the remote's OK is the same key
 *     code), Backspace deletes only what was typed here;
 *   - arrows, OK, Back, the colour keys and anything with Ctrl/Alt/Meta are
 *     never touched, nor are keys aimed at a text field or the settings panel.
 *
 * Every lookup fails safe: no on-screen key, no change - the key goes to
 * YouTube exactly as before.
 */

const LOG_PREFIX = '[KeyboardSearch]';
const DEBUG = false;

// A digit or an Enter counts as keyboard input this long after a typed key.
const TYPING_WINDOW_MS = 3000;
// How long the query gets to show a character before it counts as untouched.
// Generous: a slow TV that types natively but late would otherwise be typed
// for twice.
const SETTLE_MS = 400;

const KEY_SELECTOR = 'yt-keyboard-key, ytlr-keyboard-key';
const KEY_CLASS_SELECTOR = '[class*="ytKeyboardKey"], [class*="ytLrKeyboardKey"]';
const QUERY_SELECTORS = ['ytlr-search-text-box', 'ytlr-search-bar'];

// The on-screen keyboard's labels are in the UI language; the icon class names
// are not, so they are the fallback.
const SPACE_LABEL = /^(?:space|space ?bar|espace|espacio|espaço|leerzeichen|spazio|spatie|spacja|mezera|medzera|szóköz|spațiu|razmak|presledek|пробел|пробіл|интервал|boşluk|mellanslag|mellemrum|välilyönti|mellomrom|διάστημα|スペース|공백|空格)$/i;
const BACKSPACE_LABEL = /^(?:backspace|delete|del|⌫)$/i;
const SEARCH_LABEL = /^(?:search|suchen|rechercher|buscar|pesquisar|cerca|zoeken|szukaj|hledat|hľadať|keresés|căutare|traži|pretraži|ara|sök|søg|haku|søk|поиск|пошук|търсене|αναζήτηση|検索|검색|搜索)$/i;
const SPACE_ICON = /space/i;
const BACKSPACE_ICON = /backspace|delete|erase/i;
const SEARCH_ICON = /search|magnif/i;

// US layout, only for engines without KeyboardEvent.key (Chrome < 51).
const PUNCTUATION = { 186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 192: '`', 219: '[', 220: '\\', 221: ']', 222: '\'' };

const KEY_BACKSPACE = 8;
const KEY_ENTER = 13;

// 'unknown' until the first character settles it: 'native' (YouTube types by
// itself), 'osk' (we press on-screen keys) or 'none' (nothing worked).
let mode = 'unknown';
let pressStrategy = 0;
let lastTypedAt = 0;
let typedCount = 0;
let probe = null;
const swallowedKeyUps = [];

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function onScreenKeys() {
  let keys = Array.prototype.slice.call(document.querySelectorAll(KEY_SELECTOR));
  if (keys.length === 0) {
    // Class-named keys: keep the outermost element of each key, not its label.
    keys = Array.prototype.slice.call(document.querySelectorAll(KEY_CLASS_SELECTOR))
      .filter((el) => !el.parentElement || !el.parentElement.closest(KEY_CLASS_SELECTOR));
  }
  return keys.filter(isVisible);
}

function labelOf(el) {
  return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function iconClassesOf(el) {
  let names = typeof el.className === 'string' ? el.className : '';
  const inner = el.querySelectorAll('[class]');
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i].getAttribute('class');
    if (c) names += ' ' + c;
  }
  return names;
}

function findKey(ch) {
  const keys = onScreenKeys();
  if (ch === ' ') return findSpecialKey(keys, SPACE_LABEL, SPACE_ICON);
  const wanted = ch.toLowerCase();
  for (let i = 0; i < keys.length; i++) {
    const label = labelOf(keys[i]);
    if (label.length === 1 && label.toLowerCase() === wanted) return keys[i];
  }
  return null;
}

function findSpecialKey(keys, labelPattern, iconPattern) {
  for (let i = 0; i < keys.length; i++) {
    if (labelPattern.test(labelOf(keys[i]))) return keys[i];
  }
  // Icon-only keys: no text of their own, the icon's class names the job.
  for (let i = 0; i < keys.length; i++) {
    if ((keys[i].textContent || '').trim() === '' && iconPattern.test(iconClassesOf(keys[i]))) return keys[i];
  }
  return null;
}

function queryText() {
  for (let i = 0; i < QUERY_SELECTORS.length; i++) {
    const el = document.querySelector(QUERY_SELECTORS[i]);
    if (!el) continue;
    const input = el.querySelector('input, textarea');
    return input ? input.value : (el.textContent || '');
  }
  return null;
}

function centreOf(el) {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function dispatchMouse(el, type, at) {
  let evt;
  try {
    evt = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: at.clientX, clientY: at.clientY, button: 0 });
  } catch {
    // Engines without the MouseEvent constructor.
    evt = document.createEvent('MouseEvents');
    evt.initMouseEvent(type, true, true, window, 1, 0, 0, at.clientX, at.clientY, false, false, false, false, 0, null);
  }
  el.dispatchEvent(evt);
}

// Ways of pressing an on-screen key, tried in order until one changes the
// query; the one that does is kept.
const PRESS_STRATEGIES = [
  function click(el) { el.click(); },
  function pointer(el) {
    const at = centreOf(el);
    ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach((type) => { dispatchMouse(el, type, at); });
  },
  function instance(el) {
    const inst = el.__instance;
    if (!inst || typeof inst.onSelect !== 'function') return;
    inst.onSelect({ type: 'click', stopPropagation() {}, preventDefault() {}, target: el, currentTarget: el, bubbles: true, cancelable: true });
  }
];

function press(el, strategy) {
  try {
    PRESS_STRATEGIES[strategy](el);
    return true;
  } catch (err) {
    if (DEBUG) console.warn(LOG_PREFIX, 'Pressing a key failed:', err);
    return false;
  }
}

function swallow(evt) {
  evt.preventDefault();
  evt.stopImmediatePropagation();
  // YouTube may act on the keyup too; it gets neither half.
  if (swallowedKeyUps.indexOf(evt.keyCode) === -1) swallowedKeyUps.push(evt.keyCode);
}

function printableChar(evt) {
  if (evt.ctrlKey || evt.altKey || evt.metaKey) return null;
  const code = evt.keyCode;
  if (COLOR_CODE_MAP.has(code)) return null;
  const key = evt.key;
  if (typeof key === 'string' && key !== 'Unidentified' && key !== '') {
    return key.length === 1 ? key : null; // a named key: Enter, ArrowLeft, ...
  }
  if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
  if (code >= 48 && code <= 57 && !evt.shiftKey) return String(code - 48);
  if (code === 32) return ' ';
  return PUNCTUATION[code] || null;
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function inOwnTerritory(target) {
  if (!target || target.nodeType !== 1) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return true;
  return !!(target.closest && target.closest('.ytaf-ui-container'));
}

function resetSession() {
  if (probe && probe.timer) clearTimeout(probe.timer);
  probe = null;
  lastTypedAt = 0;
  typedCount = 0;
  swallowedKeyUps.length = 0;
  // Nothing worked on the last visit: maybe the keyboard was not up. Try again.
  if (mode === 'none') mode = 'unknown';
}

/** Types characters on the on-screen keyboard, with the press that works. */
function typeOnScreen(chars) {
  for (let i = 0; i < chars.length; i++) {
    const key = findKey(chars[i]);
    if (key && press(key, pressStrategy)) typedCount++;
  }
}

/**
 * The first character went to YouTube. If the query changed, YouTube types by
 * itself. If not, find a way of pressing on-screen keys that changes it, then
 * type everything that came in meanwhile.
 */
function settleProbe() {
  const p = probe;
  p.timer = null;
  const now = queryText();
  if (now !== p.before) {
    mode = 'native';
    typedCount += p.chars.length;
    probe = null;
    if (DEBUG) console.info(LOG_PREFIX, 'YouTube types natively');
    return;
  }
  tryStrategy(p, 0);
}

function tryStrategy(p, strategy) {
  if (probe !== p) return;
  if (!isSearchPage()) { probe = null; return; }
  const key = findKey(p.chars[0]);
  if (!key) {
    // No key to press for it (keyboard not shown, another layout or script):
    // drop that character and decide on the next one.
    p.chars.shift();
    if (p.chars.length === 0) { probe = null; return; }
    tryStrategy(p, strategy);
    return;
  }
  const before = queryText();
  press(key, strategy);
  p.timer = setTimeout(() => {
    p.timer = null;
    if (probe !== p) return;
    if (queryText() !== before) {
      mode = 'osk';
      pressStrategy = strategy;
      typedCount++;
      probe = null;
      if (DEBUG) console.info(LOG_PREFIX, 'Typing on the on-screen keyboard, strategy', PRESS_STRATEGIES[strategy].name);
      typeOnScreen(p.chars.slice(1));
    } else if (strategy + 1 < PRESS_STRATEGIES.length) {
      tryStrategy(p, strategy + 1);
    } else {
      mode = 'none';
      probe = null;
      if (DEBUG) console.info(LOG_PREFIX, 'No way to type found; leaving keys alone');
    }
  }, SETTLE_MS);
}

function onKeyDown(evt) {
  if (evt.isTrusted === false || evt[SYNTHETIC_KEY_FLAG]) return;
  if (mode === 'none' || !isSearchPage() || !configRead('keyboardSearch')) return;
  if (inOwnTerritory(evt.target) || inOwnTerritory(document.activeElement)) return;

  const now = Date.now();
  const typing = now - lastTypedAt < TYPING_WINDOW_MS;
  const code = evt.keyCode;

  if (code === KEY_BACKSPACE) {
    // YouTube deletes by itself in native mode; it still counts as typing.
    if (mode === 'native' && typedCount > 0) lastTypedAt = now;
    // Only what was typed here, and only when we are the ones typing.
    if (mode !== 'osk' || typedCount === 0) return;
    const key = findSpecialKey(onScreenKeys(), BACKSPACE_LABEL, BACKSPACE_ICON);
    if (!key) return;
    swallow(evt);
    if (press(key, pressStrategy)) typedCount--;
    lastTypedAt = now;
    return;
  }

  if (code === KEY_ENTER) {
    // The remote's OK sends the same code: Enter submits only right after
    // keyboard typing. In native mode too: YouTube types by itself there but
    // takes Enter as OK on the focused on-screen key (webOS 25).
    if ((mode !== 'osk' && mode !== 'native') || !typing || typedCount === 0) return;
    const key = findSpecialKey(onScreenKeys(), SEARCH_LABEL, SEARCH_ICON);
    if (!key) return;
    swallow(evt);
    // ponytail: native mode never probed a press; the pointer press is the one
    // that works on webOS 25 (click() does not). Probe here if another build differs.
    press(key, mode === 'osk' ? pressStrategy : 1);
    lastTypedAt = 0;
    typedCount = 0;
    return;
  }

  const ch = printableChar(evt);
  if (ch === null) return;
  if (isDigit(ch) && !typing) return; // the remote's number keys stay shortcuts

  if (mode === 'native') {
    lastTypedAt = now;
    typedCount++;
    return;
  }

  if (mode === 'osk') {
    const key = findKey(ch);
    if (!key) return;
    swallow(evt);
    if (press(key, pressStrategy)) typedCount++;
    lastTypedAt = now;
    return;
  }

  // mode === 'unknown'
  lastTypedAt = now;
  if (probe) {
    // Still deciding: YouTube gets this one too, and it is queued in case
    // YouTube does nothing with it.
    probe.chars.push(ch);
    return;
  }
  const before = queryText();
  if (before === null) return; // nothing to watch: no way to tell, so no touching
  probe = { before, chars: [ch], timer: null };
  probe.timer = setTimeout(settleProbe, SETTLE_MS);
}

function onKeyUp(evt) {
  if (evt.isTrusted === false || evt[SYNTHETIC_KEY_FLAG]) return;
  const i = swallowedKeyUps.indexOf(evt.keyCode);
  if (i === -1) return;
  swallowedKeyUps.splice(i, 1);
  evt.preventDefault();
  evt.stopImmediatePropagation();
}

// Window capture, registered before YouTube's app code runs, so a key typed
// here never reaches YouTube's own handlers as well.
window.addEventListener('keydown', onKeyDown, true);
window.addEventListener('keyup', onKeyUp, true);
window.addEventListener('ytaf-page-update', (evt) => {
  if (!evt || !evt.detail || !evt.detail.isSearch) resetSession();
});
