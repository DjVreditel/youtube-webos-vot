import { logoStyles, thumbnailQualityModes, videoCodecModes, uiThemes, clockModes, startPageModes, minVideoLengthModes, seekStepModes } from './config.js';
import { configAddChangeListener, configRead, configWrite, configGetDesc, segmentTypes, configGetDefault, shortcutActions, sbModes, sbModesHighlight, forcePreviewModes, configGetProfileStatus } from './config.js';
import './ui.css';
import './auto-login.js';
import './return-dislike.js';
import { initVideoQuality } from './video-quality.js';
import { initLogoStyle } from './logo-style.js';
import { initMathLetters } from './math-letters.js';
// import { initPlaybackSpeed, stepSpeed, resetSpeed } from './playback-speed.js';
import sponsorBlockUI from './Sponsorblock-UI.js';
import { sendKey, REMOTE_KEYS, COLOR_CODE_MAP, isGuestMode, isWatchPage, isShortsPage, isSearchPage, SELECTORS, getVideo, SYNTHETIC_KEY_FLAG } from './utils.js';
import { syncAdblockHook, initTrackingBlock, destroyTrackingBlock } from './adblock.js';
import logoOrangeUrl from './icons/logo-orange.png';
import logoBlueUrl from './icons/logo-blue.png';
import logoRedUrl from './icons/logo-red.png';
import logoDarkUrl from './icons/logo-dark.png';
import { getWebOSVersion, isWebOS25 } from './webos-utils.js';
import { subtitleTranslateLanguages } from './subtitle-translate.js';
import { showNotification as _showNotification, setNotificationOled, setNotificationTheme } from './notifications.js';
import { blockChannel } from './long-press-menu.js';

// Re-export so existing `import { showNotification } from './ui'` sites keep working.
export const showNotification = _showNotification;

let lastSafeFocus = null;
let oledKeepAliveTimer = null;

let lastShortcutTime = 0;
let lastShortcutKey = -1;
let shortcutDebounceTime = 100;
// Burst actions opt out of the debounce so seeks can be repeated quickly, but
// they still have to swallow the duplicate one physical press produces: the
// colour buttons emit two codes that both map to the same name (red 403/166,
// green 404/172, yellow 405/170, blue 406/167/191) in the same tick. No remote
// repeats inside 50ms; a held seek key's repeats go through, so holding it
// keeps seeking.
const BURST_DUPLICATE_MS = 50;

// Seek Burst Variables
let seekAccumulator = 0;
let pendingSeekOffset = 0;
let seekResetTimer = null;
let seekApplyTimer = null;
let activeSeekNotification = null;

let activePlayPauseNotification = null;
let playPauseNotificationTimer = null;

// Lazy load variable
let optionsPanel = null;
// The Magic Remote settings button (see showPointerButton). Declared up here
// because applyTheme() runs at load, before that section.
let pointerButton = null;
let optionsPanelVisible = false;
let panelInitBlock = false;

const shortcutCache = {};
// Define keys including colors
const shortcutKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'red', 'green', 'yellow', 'blue'];

const COLOR_KEYS = new Set(['red', 'green', 'yellow', 'blue']);

// The settings panel's tabs, in order. `focus` is what takes focus when the
// tab is opened from inside a page. The old Main tab grew past the height of a
// 1080p screen, so it is split into Filters, Player and Interface.
const SETTINGS_PAGES = [
  { id: 'filters', name: 'Filters', focus: 'input' },
  { id: 'player', name: 'Player', focus: 'input, .shortcut-control-row' },
  { id: 'interface', name: 'Interface', focus: 'input, .shortcut-control-row' },
  { id: 'sponsor', name: 'SponsorBlock', focus: '.shortcut-control-row, input' },
  { id: 'shortcuts', name: 'Shortcuts', focus: '.shortcut-control-row' },
  { id: 'ui-tweaks', name: 'UI Tweaks', focus: '.shortcut-control-row, input' }
];
const SPONSOR_PAGE = 3;

const cachedSelectors = {
    comments: null,
    description: null,
    save: null
};

// Candidate lists hoisted to module scope so they aren't rebuilt per keypress.
const COMMENT_SELECTORS = [
    'yt-button-container[aria-label="Comments"]',
    'yt-icon.qHxFAf.ieYpu.nGYLgf',
    'yt-icon.qHxFAf.ieYpu.wFZPnb',
    'ytlr-button-renderer[idomkey="item-1"] ytlr-button',
    '[idomkey="TRANSPORT_CONTROLS_BUTTON_TYPE_COMMENTS"] ytlr-button',
    'ytlr-redux-connect-ytlr-like-button-renderer + ytlr-button-renderer ytlr-button',
    'ytlr-button-renderer[idomkey="1"] yt-button-container'
];
const SAVE_SELECTORS = [
    'yt-button-container[aria-label="Save"]',
    'yt-icon.p9sZp'
];
const DESCRIPTION_FALLBACK_SELECTOR = 'ytlr-button-renderer yt-formatted-string.XGffTd.OqGroe';

// "Try the cached selector, else walk the candidate list, else cache the
// winner" — was hand-rolled three times with subtly different fallback
// behaviour. If a cached selector stops matching we now always fall through to
// the full walk instead of returning null.
function resolveCached(cacheKey, selectors) {
    const cached = cachedSelectors[cacheKey];
    if (cached) {
        const hit = document.querySelector(cached);
        if (hit) return hit;
    }
    for (let i = 0; i < selectors.length; i++) {
        const el = document.querySelector(selectors[i]);
        if (el) {
            cachedSelectors[cacheKey] = selectors[i];
            return el;
        }
    }
    return null;
}

window.addEventListener('ytaf-page-update', (e) => {
    // Audio-only ends with the watch page, so home-screen previews are not
    // left invisible.
    if (!e.detail.isWatch && !e.detail.isShorts) document.documentElement.classList.remove('ytaf-audio-only');
    if (e.detail.isWatch) {
        cachedSelectors.comments = null;
        cachedSelectors.description = null;
        cachedSelectors.save = null;
    }
});

const ACTION_SCOPES = {
    config_menu: 'GLOBAL',
    oled_toggle: 'GLOBAL',
    sleep_timer: 'GLOBAL',
    refresh_page: 'NON_VIDEO',
    chapter_skip: 'VIDEO',
    chapter_skip_prev: 'VIDEO',
    seek_15_fwd: 'VIDEO',
    seek_15_back: 'VIDEO',
    play_pause: 'VIDEO',
    toggle_subs: 'VIDEO',
    toggle_comments: 'VIDEO',
    toggle_description: 'VIDEO',
    save_to_playlist: 'VIDEO',
    sb_skip_prev: 'VIDEO',
    sb_manual_skip: 'VIDEO',
    audio_only: 'VIDEO',
    jump_to_live: 'VIDEO'
    // speed_up: 'VIDEO',
    // speed_down: 'VIDEO',
    // speed_reset: 'VIDEO'
};

function updateShortcutCache(key) {
    shortcutCache[key] = configRead(`shortcut_key_${key}`);
}

// Initialize cache and listeners
shortcutKeys.forEach(key => {
    updateShortcutCache(key);
    configAddChangeListener(`shortcut_key_${key}`, () => updateShortcutCache(key));
});

// --- Helpers ---
// Element#matches / Element#closest polyfills now live in polyfills.js,
// imported via utils.js so every module gets them regardless of import order.

const simulateBack = () => { console.log('[Shortcut] Simulating Back/Escape...'); sendKey(REMOTE_KEYS.BACK); };

// Engagement panel detection. The two renderers are alternative shells YouTube
// uses depending on the panel type (comments/description vs. title-header
// panels); we query both and return whichever exists. Centralized here because
// the same chain was inlined in three shortcut handlers.
const ENGAGEMENT_PANEL_SELECTOR =
    'ytlr-engagement-panel-section-list-renderer, ytlr-engagement-panel-title-header-renderer';
const getEngagementPanel = () => document.querySelector(ENGAGEMENT_PANEL_SELECTOR);
const isEngagementPanelVisible = () => {
    const panel = getEngagementPanel();
    return !!(panel && window.getComputedStyle(panel).display !== 'none');
};

// --- Settings panel navigation ---
//
// The arrows move focus between the tab buttons and the controls of the open
// page by where they sit on screen. This used to be the WICG spatial-navigation
// polyfill (~110 KB, and a focusin listener with a forced layout on every focus
// change in the whole app) for what is a handful of rows; the search below is
// all the panel needs. Ported from mirijanristic's fork (panel/keyboard.js).

// The aligned cycle rows carry a hidden spacer checkbox (dummyBox) - it is
// tabIndex -1 and must never be a target.
const PANEL_FOCUSABLES = 'input:not([disabled]), .shortcut-control-row, button:not([disabled])';

/** The controls of `page` that can take focus, in document order. */
function pageFocusables(page) {
  const out = [];
  if (!page) return out;
  const nodes = page.querySelectorAll(PANEL_FOCUSABLES);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].tabIndex !== -1) out.push(nodes[i]);
  }
  return out;
}

/**
 * The box a move measures: a checkbox's whole label row (or cycle row), not the
 * small box at its left, which would overlap nothing above or below it.
 */
function boxOf(el) {
  const row = el.tagName === 'INPUT' ? el.closest('label, .shortcut-control-row') : null;
  return (row || el).getBoundingClientRect();
}

/**
 * The candidate nearest to `from` in `dir`, judged by the centres of their
 * boxes (boxOf). Left and Right stay within the row: only candidates that
 * overlap `from` vertically count. Up and Down need a candidate at least half a
 * row ahead - in the two-column Filters section the rows of one line are not
 * quite the same height (the last label's margin stretches its neighbour), and
 * a centre a fraction of a pixel lower must not count as "below". They prefer a
 * candidate that overlaps `from` horizontally but take the nearest one
 * otherwise. Among those, the one closest ahead wins, then the one closest
 * sideways. Returns null when nothing lies that way.
 */
function nearestInDirection(from, dir, candidates) {
  const a = boxOf(from);
  const ax = (a.left + a.right) / 2;
  const ay = (a.top + a.bottom) / 2;
  const vertical = dir === 'up' || dir === 'down';
  const minAhead = vertical ? Math.max(1, a.height / 2) : 0;
  let best = null;
  let bestOverlap = false;
  let bestAhead = Infinity;
  let bestAside = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (el === from) continue;
    const b = boxOf(el);
    if (b.width === 0 && b.height === 0) continue;
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;

    let ahead;
    if (dir === 'up') ahead = ay - by;
    else if (dir === 'down') ahead = by - ay;
    else if (dir === 'left') ahead = ax - bx;
    else ahead = bx - ax;
    if (ahead <= minAhead) continue;

    const aside = vertical ? Math.abs(bx - ax) : Math.abs(by - ay);
    const overlap = vertical
      ? b.right > a.left && b.left < a.right
      : b.bottom > a.top && b.top < a.bottom;
    if (!vertical && !overlap) continue;

    let better;
    if (overlap !== bestOverlap) better = overlap;
    else if (ahead !== bestAhead) better = ahead < bestAhead;
    else better = aside < bestAside;
    if (better) {
      best = el;
      bestOverlap = overlap;
      bestAhead = ahead;
      bestAside = aside;
    }
  }
  return best;
}
const ARROW_KEY_CODE = { 
  [REMOTE_KEYS.LEFT.code]: 'left', 
  [REMOTE_KEYS.UP.code]: 'up', 
  [REMOTE_KEYS.RIGHT.code]: 'right', 
  [REMOTE_KEYS.DOWN.code]: 'down' 
};

// Built from REMOTE_KEYS in utils.js — one source of truth for color codes
// and their per-remote alternates.
const getKeyColor = (charCode) => COLOR_CODE_MAP.get(charCode) || null;

// --- DOM Utility Functions ---

const createElement = (tag, props = {}, ...children) => {
  const el = document.createElement(tag);
  
  for (const [key, val] of Object.entries(props)) {
      if (key === 'style' && typeof val === 'object') {
          for (const [styleKey, styleVal] of Object.entries(val)) {
              el.style[styleKey] = styleVal;
          }
      }
      else if (key === 'class') el.className = val;
      else if (key === 'events' && typeof val === 'object') {
          for (const [evt, handler] of Object.entries(val)) {
              el.addEventListener(evt, handler);
          }
      }
      else if (key === 'text') el.textContent = val;
      else el[key] = val;
  }

  for (let i = 0; i < children.length; i++) {
      const child = children[i];
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
};

// --- UI Construction Functions ---

function createConfigCheckbox(key) {
  const elmInput = createElement('input', { type: 'checkbox', checked: configRead(key), events: { change: (evt) => configWrite(key, evt.target.checked) }});
  
  // The text sits in its own element: as a bare text node with a leading
  // non-breaking space, a label that wrapped to two lines (two-column
  // sections) indented only its first line, so the second hung to the left.
  const labelText = createElement('span', { class: 'label-text', text: configGetDesc(key) });
  const labelContent = createElement('div', { class: 'label-content', style: { fontSize: '2.1vh' } }, elmInput, labelText);
  const elmLabel = createElement('label', {}, labelContent);
  
  // elmInput.addEventListener('focus', () => elmLabel.classList.add('focused'));
  // elmInput.addEventListener('blur', () => elmLabel.classList.remove('focused'));
  configAddChangeListener(key, (evt) => elmInput.checked = evt.detail.newValue);
  
  return elmLabel;
}

// `variant` is an extra class on the section, used to opt a section into the
// two-column layout. Sizing and spacing moved to ui.css so the whole panel can
// be retuned in one place instead of through inline styles on every section.
function createSection(title, elements, variant) {
  const legend = createElement('div', { text: title, class: 'section-title' });
  const fieldset = createElement('div', { class: 'ytaf-settings-section' + (variant ? ' ' + variant : '') }, legend, ...elements);
  return fieldset;
}

// --- Generic UI Components Factory ---

function createGenericControlRow(labelText, displayValueGetter, onLeft, onRight, onClick, extraElements = null) {
  const valueText = createElement('span', { class: 'current-value' });
  const updateDisplay = () => valueText.textContent = displayValueGetter();

  const container = createElement('div', { 
    class: 'shortcut-control-row',
    style: { padding: '0.6vh 0', margin: '0.2vh 0' }, 
    tabIndex: 0,
    events: {
      keydown: (e) => {
        if (e.keyCode === REMOTE_KEYS.LEFT.code) { onLeft(); e.stopPropagation(); e.preventDefault(); }
        else if (e.keyCode === REMOTE_KEYS.RIGHT.code || e.keyCode === REMOTE_KEYS.ENTER.code) { onRight(); e.stopPropagation(); e.preventDefault(); }
      },
      click: () => onClick()
    }
  },
    createElement('span', { text: labelText, class: 'shortcut-label', style: { fontSize: '2.1vh' } }),
    createElement('div', { class: 'shortcut-value-container' },
      createElement('span', { text: '<', class: 'arrow-btn', events: { click: (e) => { e.stopPropagation(); onLeft(); } } }),
      valueText,
      createElement('span', { text: '>', class: 'arrow-btn', events: { click: (e) => { e.stopPropagation(); onRight(); } } })
    )
  );

  if (extraElements) {
     container.querySelector('.shortcut-value-container').appendChild(extraElements);
  }

  return { container, updateDisplay };
}

function createCycleControl(configKey, labelText, modesArray, displayMap = null, extraElements = null) {
    const displayValueGetter = () => displayMap ? displayMap[configRead(configKey)] || configRead(configKey) : configRead(configKey);
    const cycle = (dir) => {
        let idx = modesArray.indexOf(configRead(configKey));
        if (idx === -1) idx = 0;
        idx = dir === 'next' ? (idx + 1) % modesArray.length : (idx - 1 + modesArray.length) % modesArray.length;
        configWrite(configKey, modesArray[idx]);
        updateDisplay();
    };

    const { container, updateDisplay } = createGenericControlRow(
        labelText, displayValueGetter,
        () => cycle('prev'), () => cycle('next'), () => cycle('next'),
        extraElements
    );

    configAddChangeListener(configKey, updateDisplay);
    updateDisplay();
    return container;
}

/**
 * A cycle control that lines up with the checkbox rows around it.
 *
 * A .shortcut-control-row has no checkbox, so its label starts flush against
 * the row edge while every neighbouring label starts one checkbox-width in. The
 * hidden input below reserves exactly that width, which is cheaper and steadier
 * across themes than hard-coding a padding value that has to track the checkbox
 * CSS by hand.
 */
function createAlignedCycleControl(configKey, displayMap) {
  const control = createCycleControl(configKey, configGetDesc(configKey),
    Object.keys(displayMap), displayMap);

  const label = control.querySelector('.shortcut-label');
  if (label) {
    label.style.color = 'inherit'; 
    label.style.display = 'flex';
    label.style.alignItems = 'center';
	label.style.lineHeight = 'inherit';
    
    // A spacer only: never a focus target (Up/Down, the wrap-around).
    const dummyBox = createElement('input', {
      tabIndex: -1,
      style: {
        visibility: 'hidden',
        paddingLeft: '2.2vh'
      }
    });
    dummyBox.setAttribute('type', 'checkbox');
    
    label.textContent = '';
    label.appendChild(dummyBox);
    label.appendChild(document.createTextNode('\u00A0' + configGetDesc(configKey)));
  }

  return control;
}

const createLogoControl = () => createAlignedCycleControl('logoStyle', logoStyles);
const createVideoCodecControl = () => createAlignedCycleControl('forceVideoCodec', videoCodecModes);
function createThumbnailQualityControl() {
  const control = createAlignedCycleControl('thumbnailQualityMode', thumbnailQualityModes);
  // The strategy only means anything while the feature it tunes is on. Greyed
  // out and dropped from the focus order rather than hidden, so the rows below
  // it do not jump every time the checkbox above is toggled.
  const sync = () => {
    const on = configRead('upgradeThumbnails');
    control.style.opacity = on ? '1' : '0.5';
    control.tabIndex = on ? 0 : -1;
  };
  configAddChangeListener('upgradeThumbnails', sync);
  sync();
  return control;
}

// The per-account switch, with a line under it saying which settings are in
// use. When no account can be told from the identity record, the line lists
// the record's field names (never values) so the case can be reported.
function createPerAccountControl() {
  const control = createConfigCheckbox('perAccountSettings');
  const status = createElement('div', { class: 'ytaf-profile-status', style: { fontSize: '1.7vh', opacity: '0.75', paddingLeft: '3.2vh' } });
  const update = () => {
    const { state, fields } = configGetProfileStatus();
    let text = '';
    if (state === 'account') text = 'Using this account\'s own settings';
    else if (state === 'guest') text = 'Using the guest settings';
    else if (state === 'unknown') {
      text = 'Account not recognised - shared settings in use' +
        (fields.length ? ' (fields: ' + fields.join(', ') + ')' : '');
    }
    status.textContent = text;
    status.style.display = text ? '' : 'none';
  };
  configAddChangeListener('perAccountSettings', update);
  window.addEventListener('ytaf-profile-change', update);
  update();
  return createElement('div', {}, control, status);
}

// Turning subtitles on automatically needs a language to turn on. Greyed out
// and dropped from the focus order while Auto-Translate Subtitles is Off, like
// the thumbnail strategy row, so the rows below do not move.
function createSubtitleAutoEnableControl() {
  const control = createConfigCheckbox('subtitleAutoEnable');
  const input = control.querySelector('input');
  const sync = () => {
    const on = configRead('subtitleTranslateLang') !== 'off';
    control.style.opacity = on ? '1' : '0.5';
    if (input) input.tabIndex = on ? 0 : -1;
  };
  configAddChangeListener('subtitleTranslateLang', sync);
  sync();
  return control;
}

function createSegmentControl(key) {
  const isHighlight = key === 'sbMode_highlight';
  const modesMap = isHighlight ? sbModesHighlight : sbModes;
  const modes = Object.keys(modesMap);
  const colorKey = isHighlight ? 'poi_highlightColor' : key.replace('sbMode_', '') + 'Color';

  const hasColorPicker = segmentTypes[key.replace('sbMode_', '')] || (isHighlight && segmentTypes['poi_highlight']);
  let extraElements = null;

  if (hasColorPicker) {
      const resetButton = createElement('button', { 
          text: 'R', 
          class: 'reset-color-btn', 
          tabIndex: -1,
          events: { 
            click: (evt) => { evt.preventDefault(); evt.stopPropagation(); configWrite(colorKey, configGetDefault(colorKey)); }
          }
      });
      const colorInput = createElement('input', { 
          type: 'color', 
          value: configRead(colorKey), 
          tabIndex: -1,
          events: { 
              click: (evt) => { evt.stopPropagation(); },
              input: (evt) => configWrite(colorKey, evt.target.value) 
          }
      });
      
      configAddChangeListener(colorKey, (evt) => { colorInput.value = evt.detail.newValue; window.sponsorblock?.drawOverlay(); });
      extraElements = createElement('div', { style: { display: 'flex', marginLeft: '10px' } }, resetButton, colorInput);
  }

  return createCycleControl(key, configGetDesc(key), modes, modesMap, extraElements);
}

function createShortcutControl(keyIdentifier) {
  const configKey = `shortcut_key_${keyIdentifier}`;
  const actions = Object.keys(shortcutActions);
  const isColor = COLOR_KEYS.has(keyIdentifier);
  
  const labelText = isColor 
    ? `${keyIdentifier.charAt(0).toUpperCase() + keyIdentifier.slice(1)} Button` 
    : `Key ${keyIdentifier}`;

  return createCycleControl(configKey, labelText, actions, shortcutActions);
}

function createPreviewControl(key) {
  return createCycleControl(key, configGetDesc(key), Object.keys(forcePreviewModes), forcePreviewModes);
}

// A percentage stepped with Left/Right and clamped at both ends.
function createOpacityControl(key, step = 5, min = 0, max = 100) {
  
  const displayValueGetter = () => `${configRead(key)}%`;
  
  const changeValue = (delta) => {
    let val = configRead(key);
    val = Math.min(max, Math.max(min, val + delta));
    configWrite(key, val);
    updateDisplay();
  };

  const { container, updateDisplay } = createGenericControlRow(
      configGetDesc(key), displayValueGetter,
      () => changeValue(-step), () => changeValue(step), () => changeValue(step)
  );
  
  configAddChangeListener(key, updateDisplay);
  updateDisplay();
  return container;
}

// The channel of the video being watched, as the player names it, or ''.
function currentVideoChannel() {
  if (!isWatchPage()) return '';
  const player = document.getElementById(SELECTORS.PLAYER_ID);
  try {
    const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null;
    return data && typeof data.author === 'string' ? data.author.trim() : '';
  } catch { return ''; }
}

/**
 * A list setting (Blocked Channels, title keywords): its entries as buttons
 * that remove them, then a text box with an Add button. The text box takes a
 * USB or Bluetooth keyboard, or the TV's own keyboard on OK; OK with text in
 * it adds the text. `channelButton` adds a button that blocks the channel of
 * the video being watched, shown while there is one.
 */
function createListEditor(key, { placeholder, emptyText, channelButton }) {
  const entries = createElement('div', { class: 'ytaf-list-entries' });
  const input = createElement('input', { type: 'text', class: 'ytaf-text-input', placeholder });

  const render = () => {
    entries.textContent = '';
    const values = configRead(key);
    if (!values.length) entries.appendChild(createElement('div', { class: 'ytaf-list-empty', text: emptyText }));
    values.forEach((value, index) => {
      entries.appendChild(createElement('button', {
        class: 'ytaf-list-btn',
        text: '\u2715 ' + value,
        title: 'Remove',
        tabIndex: 0,
        events: { click: () => removeAt(index) }
      }));
    });
  };

  // The focused entry goes away with its button, so the focus moves on to the
  // entry that takes its place, or to the text box.
  const removeAt = (index) => {
    const values = configRead(key).slice();
    values.splice(index, 1);
    configWrite(key, values);
    const buttons = entries.querySelectorAll('.ytaf-list-btn');
    (buttons[Math.min(index, buttons.length - 1)] || input).focus();
  };

  const add = () => {
    const value = input.value.trim();
    input.value = '';
    if (!value) return;
    const values = configRead(key);
    const lower = value.toLowerCase();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i]).toLowerCase() === lower) return;
    }
    configWrite(key, values.concat([value]));
  };
  // OK in the text box (the panel's key handler).
  input.ytafSubmit = add;

  const children = [entries];
  if (channelButton) {
    const button = createElement('button', {
      class: 'ytaf-list-btn ytaf-list-action',
      tabIndex: 0,
      events: { click: () => { blockChannel(currentVideoChannel()); input.focus(); } }
    });
    const update = () => {
      const channel = currentVideoChannel();
      const blocked = channel && configRead(key).some((v) => String(v).toLowerCase() === channel.toLowerCase());
      button.textContent = 'Block the Channel of This Video: ' + channel;
      button.style.display = channel && !blocked ? '' : 'none';
    };
    configAddChangeListener(key, update);
    window.addEventListener('ytaf-panel-show', update);
    update();
    children.push(button);
  }
  children.push(createElement('div', { class: 'ytaf-list-input-row' }, input,
    createElement('button', { class: 'ytaf-list-btn', text: 'Add', tabIndex: 0, events: { click: () => { add(); input.focus(); } } })));

  configAddChangeListener(key, render);
  render();
  return createElement('div', { class: 'ytaf-list-editor' },
    createElement('div', { class: 'ytaf-list-title', text: configGetDesc(key) }), ...children);
}

// --- Main Options Panel Logic ---

function createOptionsPanel() {
  const elmContainer = createElement('div', { 
    class: isGuestMode() ? 'ytaf-ui-container guest-mode' : 'ytaf-ui-container',
    style: { display: 'none' }, 
    tabIndex: 0,
    events: {
      focus: () => console.info('Options panel focused!'),
      blur: () => console.info('Options panel blurred!')
    }
  });

  // Chrome 38 to 59 (webOS 3/4) have no :focus-within, and a selector they do
  // not know drops the whole rule - so the label row of the focused checkbox
  // carries a class instead (ui.css). From mirijanristic's fork.
  const markLabel = (evt, on) => {
    const label = evt.target.closest ? evt.target.closest('label') : null;
    if (label) label.classList.toggle('ytaf-focused', on);
  };
  elmContainer.addEventListener('focusin', (evt) => markLabel(evt, true));
  elmContainer.addEventListener('focusout', (evt) => markLabel(evt, false));

  let activePage = 0;
  elmContainer.activePage = 0;
  // One element per entry of SETTINGS_PAGES, filled as each page is built.
  const pages = [];

  const tabMenu = createElement('div', { 
    class: 'ytaf-tab-menu',
    events: {
      mouseleave: () => {
        const activeTabBtn = tabBtns[activePage];
        if (activeTabBtn && document.activeElement && document.activeElement.classList.contains('ytaf-tab-btn')) {
            activeTabBtn.focus();
        }
      }
    }
  });
  const tabBtns = SETTINGS_PAGES.map(({ name }, index) => createElement('button', {
      class: index === 0 ? 'ytaf-tab-btn active' : 'ytaf-tab-btn',
      text: name,
      tabIndex: 0,
      events: { 
        click: () => setActivePage(index),
        mouseenter: (e) => e.target.focus()
      }
    }));
  tabBtns.forEach(btn => { tabMenu.appendChild(btn); });

	const setActivePage = (pageIndex) => {
	  if (pageIndex === activePage) return; // Don't do work if we are already on this tab
	  ensurePage(pageIndex);   // may still be queued behind the idle build chain
	  // 1. Deactivate old state
	  pages[activePage].style.display = 'none';
	  tabBtns[activePage].classList.remove('active');

	  // 2. Set new state
	  activePage = elmContainer.activePage = pageIndex;
	  pages[activePage].style.display = 'block';
	  tabBtns[activePage].classList.add('active');

	  // 3. Focus management
	  const activeEl = document.activeElement;
	  const isTabFocused = activeEl && activeEl.classList.contains('ytaf-tab-btn');
	  
	  if (!isTabFocused) {
		const focusTarget = pages[activePage].querySelector(SETTINGS_PAGES[activePage].focus);
		if (focusTarget) focusTarget.focus();
	  }
	  
	  // 4. Handle SponsorBlock popup state
	  sponsorBlockUI.togglePopup(activePage === SPONSOR_PAGE && isWatchPage());
	};

  // The tab buttons and the controls of the open page.
  const panelFocusables = () => tabBtns.concat(pageFocusables(pages[activePage]));
  // Focuses a control and scrolls the open page so it is in full view, with
  // half a row of its neighbours: focus() alone does not scroll on every TV.
  // The first and the last control take the page to its top and its end, so
  // what sits above the first or below the last (a heading, a note, the
  // page's padding) comes into view with the arrows too, not only with the
  // Magic Remote wheel. The part in view is the page's box within the panel's.
  const focusInView = (el) => {
    el.focus();
    const page = pages[activePage];
    if (!page || !page.contains(el)) return;
    const shown = pageFocusables(page).filter((c) => c.getClientRects().length > 0);
    if (el === shown[0]) { page.scrollTop = 0; return; }
    if (el === shown[shown.length - 1]) { page.scrollTop = page.scrollHeight; return; }
    const pageBox = page.getBoundingClientRect();
    const panelBox = elmContainer.getBoundingClientRect();
    const top = Math.max(pageBox.top, panelBox.top);
    const bottom = Math.min(pageBox.bottom, panelBox.bottom);
    const row = boxOf(el);
    const margin = row.height / 2;
    if (row.bottom + margin > bottom) page.scrollTop += row.bottom + margin - bottom;
    else if (row.top - margin < top) page.scrollTop -= top - row.top + margin;
  };
  const moveFocus = (dir) => {
    const target = nearestInDirection(document.activeElement, dir, panelFocusables());
    if (target) focusInView(target);
  };

  // Keyboard Navigation for the Options Panel
  elmContainer.addEventListener('keydown', (evt) => {
    if (getKeyColor(evt.charCode || evt.keyCode) === 'green') return; // Let global handler handle close if mapped to green (or config_menu logic)

    // A text box keeps the keys it types with, Left and Right included (they
    // move the cursor) until the cursor is at that end of the text, where they
    // move on to the Add button and back; Up and Down still leave it. OK adds
    // what was typed, or with nothing typed is left to the TV, which opens its
    // keyboard.
    const textBox = isTextBox(document.activeElement) ? document.activeElement : null;
    if (textBox) {
      const code = evt.keyCode;
      if (code === REMOTE_KEYS.ENTER.code) {
        if (textBox.value.trim() && textBox.ytafSubmit) {
          textBox.ytafSubmit();
          evt.preventDefault();
        }
        evt.stopPropagation();
        return;
      }
      const isVertical = code === REMOTE_KEYS.UP.code || code === REMOTE_KEYS.DOWN.code;
      const caret = typeof textBox.selectionStart === 'number' ? textBox.selectionStart : 0;
      const leavesBox = (code === REMOTE_KEYS.RIGHT.code && caret >= textBox.value.length) ||
        (code === REMOTE_KEYS.LEFT.code && caret === 0 && textBox.selectionEnd === 0);
      if (!isVertical && !leavesBox && code !== 27 && code !== REMOTE_KEYS.BACK.code) {
        evt.stopPropagation();
        return;
      }
    }

    if (evt.keyCode in ARROW_KEY_CODE) {
      const dir = ARROW_KEY_CODE[evt.keyCode];
      const preFocus = document.activeElement;

      if (dir === 'left' || dir === 'right') {
        // Prevent modifying row from navigating away
        if (preFocus.classList.contains('shortcut-control-row')) return;

        moveFocus(dir);
        
        // Tab menu wrap-around logic
        if (preFocus === document.activeElement && preFocus.classList.contains('ytaf-tab-btn')) {
			const idx = tabBtns.indexOf(preFocus);
			if (dir === 'right' && idx === tabBtns.length - 1) tabBtns[0].focus();
			else if (dir === 'left' && idx === 0) tabBtns[tabBtns.length - 1].focus();
		}

        // Moving along the tabs opens the tab under the focus, so the open tab
        // and the focused one are never two different buttons: Down then leads
        // into the page that is on screen.
        const focusedTab = tabBtns.indexOf(document.activeElement);
        if (focusedTab !== -1) setActivePage(focusedTab);
        
        evt.preventDefault(); evt.stopPropagation(); return;
      } else if (dir === 'up' || dir === 'down') {
        moveFocus(dir);
        const postFocus = document.activeElement;

        if (dir === 'up' && preFocus !== postFocus) {
            if (preFocus.closest('.ytaf-settings-page') && postFocus.classList.contains('ytaf-tab-btn')) {
                const activeTabBtn = tabBtns[activePage];
                if (activeTabBtn) activeTabBtn.focus();
            }
        }

        if (preFocus === postFocus) {
          const activeTabBtn = tabBtns[activePage];
          const focusables = [activeTabBtn].concat(pageFocusables(pages[activePage])).filter(Boolean);
          
          if (focusables.length > 0) {
            if (dir === 'up') focusInView(focusables[focusables.length - 1]);
            else if (dir === 'down') focusInView(focusables[0]);
          }
        }
        evt.preventDefault(); evt.stopPropagation(); return;
      }
    } else if (evt.keyCode === REMOTE_KEYS.ENTER.code) {
      if (evt instanceof KeyboardEvent) document.activeElement.click();
    } else if (evt.keyCode === 27 || evt.keyCode === REMOTE_KEYS.BACK.code) { // Escape / remote Back
      showOptionsPanel(false);
    }
    evt.preventDefault(); evt.stopPropagation();
  }, true);

  const toggleTheme = (evt) => { 
      evt.preventDefault(); 
      evt.stopPropagation(); 
      // Fox -> blue -> red -> Fox.
      const order = Object.keys(uiThemes);
      const next = order[(order.indexOf(configRead('uiTheme')) + 1) % order.length];
      configWrite('uiTheme', next);
      const activeTab = tabBtns[activePage];
      if (activeTab) activeTab.focus();
  };
  // All start hidden; updateLogoState() shows the one for the current theme.
  const createLogo = (src, cls) => createElement('img', { src, alt: 'Logo', class: `ytaf-logo ${cls}`, title: 'Click to switch theme', style: { display: 'none' }, events: { click: toggleTheme }});
  
  const elmHeading = createElement('h1', {},
    createElement('span', { text: 'YouTube Extended' }),
    createLogo(logoOrangeUrl, 'logo-orange'),
    createLogo(logoBlueUrl, 'logo-blue'),
    createLogo(logoRedUrl, 'logo-red'),
    createLogo(logoDarkUrl, 'logo-dark')
  );
  elmContainer.appendChild(elmHeading);
  elmContainer.appendChild(tabMenu);

  // A page element: the first one visible, the others hidden until their tab
  // is picked. They are appended in build order, which does not matter since
  // only one is ever displayed.
  // The room a page has under the heading and the tabs, so a long page
  // scrolls inside the panel. ui.css says 94vh - 15vh, but the heading and the
  // tabs take more than 15vh, so the bottom rows of a full page were cut off
  // by the panel's edge instead of scrolling into view. Measured when the
  // panel is shown; the pages built later get the same.
  let pageMaxHeight = '';
  const fitPages = () => {
    const screenH = window.innerHeight || document.documentElement.clientHeight || 0;
    const page = pages[activePage];
    if (!screenH || !page) return;
    const frame = window.getComputedStyle(elmContainer);
    const pageStyle = window.getComputedStyle(page);
    // Where the open page starts in the panel: the heading, the tabs and their margins.
    const room = screenH * 0.94 - page.offsetTop -
      (parseFloat(frame.borderTopWidth) || 0) - (parseFloat(frame.borderBottomWidth) || 0) -
      (parseFloat(pageStyle.paddingTop) || 0) - (parseFloat(pageStyle.paddingBottom) || 0);
    if (room < 100) return;
    pageMaxHeight = Math.floor(room) + 'px';
    for (let i = 0; i < pages.length; i++) {
      if (pages[i]) pages[i].style.maxHeight = pageMaxHeight;
    }
  };
  elmContainer.fitPages = fitPages;

  const makePage = (index) => {
    const page = createElement('div', {
      class: 'ytaf-settings-page ytaf-page-sectioned',
      id: `ytaf-page-${SETTINGS_PAGES[index].id}`,
      style: index === 0 ? {} : { display: 'none' }
    });
    pages[index] = page;
    if (pageMaxHeight) page.style.maxHeight = pageMaxHeight;
    elmContainer.appendChild(page);
    return page;
  };

  // --- Page 1: Filters ---
  const pageFilters = makePage(0);
  
  const elAdBlock = createConfigCheckbox('enableAdBlock');
  const elTrackingBlock = createConfigCheckbox('enableTrackingBlock');
  const cosmeticGroup = [elAdBlock, elTrackingBlock];
  const elRemoveGlobalShorts = createConfigCheckbox('removeGlobalShorts');
  const elRemoveLiveVideos = createConfigCheckbox('removeLiveVideos');
  const elRemoveTopLiveGames = createConfigCheckbox('removeTopLiveGames');
  const elRemoveMostRelevant = createConfigCheckbox('removeMostRelevant');
  const elRemoveUpcoming = createConfigCheckbox('removeUpcomingVideos');
  const elRemoveMembersOnly = createConfigCheckbox('removeMembersOnly');
  let elGuestPrompts = null;
  cosmeticGroup.push(elRemoveGlobalShorts, elRemoveLiveVideos, elRemoveTopLiveGames, elRemoveMostRelevant, elRemoveUpcoming, elRemoveMembersOnly);
  if (isGuestMode()) { elGuestPrompts = createConfigCheckbox('hideGuestSignInPrompts'); cosmeticGroup.push(elGuestPrompts); }

  pageFilters.appendChild(createSection('Cosmetic Filtering', cosmeticGroup, 'ytaf-section-2col'));

  // Dependency Management
  const setState = (el, enabled) => { if (!el) return; const input = el.querySelector('input'); if (input) { input.disabled = !enabled; el.style.opacity = enabled ? '1' : '0.5'; }};

  // Declared after the conditional elGuestPrompts assignment above.
  // setState already no-ops on null, so no filtering needed.
  // Tracking Block rides on the same JSON.parse hook and network hooks as Ad
  // Blocking, so it genuinely does nothing while Ad Blocking is off. Greying it
  // out is what tells the user that, instead of leaving a checkbox that looks
  // armed but is inert.
  const adBlockDependents = [elTrackingBlock, elRemoveGlobalShorts, elRemoveLiveVideos, elRemoveTopLiveGames, elRemoveMostRelevant, elRemoveUpcoming, elRemoveMembersOnly, elGuestPrompts];
  const updateDependencyState = () => {
    const enabled = configRead('enableAdBlock');
    adBlockDependents.forEach(el => { setState(el, enabled); });
  };
  
  elAdBlock.querySelector('input').addEventListener('change', updateDependencyState);
  if (elRemoveGlobalShorts) {
    elRemoveGlobalShorts.querySelector('input').addEventListener('change', updateDependencyState);
    configAddChangeListener('removeGlobalShorts', updateDependencyState);
  }
  configAddChangeListener('enableAdBlock', updateDependencyState);
  updateDependencyState();

  // Feed filters. Ad Blocking's like the ones above: greyed out and out of the
  // focus order while it is off. Built in the first frame after the panel is
  // up, with the deferred pages below, so opening the panel does not pay for
  // it; it sits at the bottom of the page, below what the panel opens on.
  let buildFeedSection = () => {
    const feedSection = createSection('Feed Filters', [
      createConfigCheckbox('hideWatchedVideos'),
      createAlignedCycleControl('minVideoLength', minVideoLengthModes),
      createListEditor('blockedChannels', {
        placeholder: 'Channel name, then OK',
        emptyText: 'None. Block one here, or with a long press on a video (UI Tweaks tab).',
        channelButton: true
      }),
      createListEditor('blockedKeywords', {
        placeholder: 'A word or phrase, then OK',
        emptyText: 'None.'
      })
    ]);
    pageFilters.appendChild(feedSection);
    const updateFeedSection = () => {
      const enabled = configRead('enableAdBlock');
      feedSection.style.opacity = enabled ? '1' : '0.5';
      const controls = feedSection.querySelectorAll('input, button');
      for (let i = 0; i < controls.length; i++) {
        if (controls[i].tabIndex !== -1 || controls[i].disabled) controls[i].disabled = !enabled;
      }
      const rows = feedSection.querySelectorAll('.shortcut-control-row');
      for (let i = 0; i < rows.length; i++) rows[i].tabIndex = enabled ? 0 : -1;
    };
    configAddChangeListener('enableAdBlock', updateFeedSection);
    // The entries are rebuilt when a list changes.
    configAddChangeListener('blockedChannels', updateFeedSection);
    configAddChangeListener('blockedKeywords', updateFeedSection);
    updateFeedSection();
  };

  // --- Page 2: Player ---
  makePage(1).appendChild(createSection('Video Player',
  [createConfigCheckbox('forceHighResVideo'),
  createConfigCheckbox('showQualityOnStart'),
  //createConfigCheckbox('enablePlaybackSpeed'),
  createVideoCodecControl(),
  createAlignedCycleControl('subtitleTranslateLang', subtitleTranslateLanguages),
  createSubtitleAutoEnableControl(),
  createConfigCheckbox('disableAutoCaptions'),
  createConfigCheckbox('forceOriginalAudio'),
  createConfigCheckbox('showTimeRemaining'),
  createConfigCheckbox('hideEndcards'),
  createConfigCheckbox('enableScrollSeek'),
  createAlignedCycleControl('seekStep', seekStepModes),
  createConfigCheckbox('enableReturnYouTubeDislike')]));
  // The logo in the header also cycles the theme, but a remote cannot focus
  // it, so the setting needs a row of its own to be reachable on a TV.
  // Keep the Clock On During Playback means nothing with the clock off.
  const elClockDuringPlayback = createConfigCheckbox('clockDuringPlayback');
  const updateClockRow = () => setState(elClockDuringPlayback, configRead('clockMode') !== 'off');
  configAddChangeListener('clockMode', updateClockRow);
  updateClockRow();
  const interfaceGroup = [createAlignedCycleControl('uiTheme', uiThemes), createConfigCheckbox('enableAutoLogin'), createConfigCheckbox('autoSelectAccount'), createPerAccountControl(), createConfigCheckbox('upgradeThumbnails'), createThumbnailQualityControl(), createLogoControl(), createAlignedCycleControl('clockMode', clockModes), elClockDuringPlayback, createConfigCheckbox('enableOledCareMode'), createConfigCheckbox('disableNotifications'), createConfigCheckbox('loadRowsAhead'), createConfigCheckbox('keyboardSearch'), createConfigCheckbox('pointerSettingsButton'), createConfigCheckbox('disableAnimations')];
  // The cast block only exists on webOS 25 (see userScript.js).
  if (isWebOS25()) interfaceGroup.push(createConfigCheckbox('blockWebosCast'));
  // --- Page 3: Interface ---
  makePage(2).appendChild(createSection('Interface', interfaceGroup));

  // --- Pages 4-6: built off the critical path ---
  //
  // Only the first three pages (the old Main page) are built up front -
  // building every page inside the keydown handler cost 170ms on webOS 3, most
  // of it on display:none pages. The rest build one per animation frame once
  // the panel is up, and setActivePage() forces a synchronous build if the user
  // beats the chain.
  const pageBuilders = [
    null,
    null,
    null,
    function buildSponsorPage() {
  // --- Page 4: SponsorBlock ---
    const pageSponsor = makePage(SPONSOR_PAGE);
    pageSponsor.classList.remove('ytaf-page-sectioned');
    pageSponsor.appendChild(createConfigCheckbox('enableSponsorBlock'));
  
    const elmBlock = createElement('blockquote', {},
      ...['Sponsor', 'Intro', 'Outro', 'Interaction', 'SelfPromo', 'MusicOfftopic', 'Filler', 'Hook', 'Preview'].map(s => createSegmentControl(`sbMode_${s.toLowerCase()}`)),
      createSegmentControl('sbMode_highlight'),
      createConfigCheckbox('enableMutedSegments'),
      createConfigCheckbox('sbPeriodicRefresh'),
  	createConfigCheckbox('skipSegmentsOnce'),
      createConfigCheckbox('sbFullVideoLabel'),
      createConfigCheckbox('sbShowTimeWithSkips')
    );
    pageSponsor.appendChild(elmBlock);
    pageSponsor.appendChild(createElement('div', {}, createElement('small', { text: 'Sponsor segments skipping - https://sponsor.ajay.app' })));

      },
    function buildShortcutsPage() {
  // --- Page 5: Shortcuts ---
    const pageShortcuts = makePage(4);
    pageShortcuts.classList.remove('ytaf-page-sectioned');
    shortcutKeys.forEach(key => { pageShortcuts.appendChild(createShortcutControl(key)); });
  
      },
    function buildUITweaksPage() {
  // --- Page 6: UI Tweaks ---
    const pageUITweaks = makePage(5);
  
    const playerUITweaks = [
        createOpacityControl('videoShelfOpacity'),
        createElement('div', { text: 'Adjusts opacity of black background underneath videos (Requires OLED-care mode)', style: { color: '#aaa', fontSize: '18px', padding: '4px 12px 12px' } }),
        createOpacityControl('uiBrightness', 10, 40, 100),
        createElement('div', { text: 'Dims the YouTube menus and thumbnails; never the playing video or this panel', style: { color: '#aaa', fontSize: '18px', padding: '4px 12px 12px' } }),
  	  createPreviewControl('forcePreviews'),
  	  createElement('div', { text: 'Forces the video thumbnail preview on/off on app load', style: { color: '#aaa', fontSize: '18px', padding: '4px 12px 12px' } }),
  	  createConfigCheckbox('mutePreviews'),
  	  createConfigCheckbox('fitPageBesideGuide'),
  	  createElement('div', { text: 'Only if the open left menu pushes the page off the right edge; elsewhere it just adds a wider margin', style: { color: '#aaa', fontSize: '18px', padding: '4px 12px 12px' } }),
  	  createConfigCheckbox('fixMultilineTitles'),
  	  createConfigCheckbox('removeBlackBorders')
    ];

    if (getWebOSVersion() <= 4) {
        playerUITweaks.push(createConfigCheckbox('enableLegacyEmojiFix'));
    }

    pageUITweaks.appendChild(createSection('Player UI Tweaks', playerUITweaks));

    // Where the app starts and what the tiles and their menus show. On this
    // page, which has room, as the Interface page is full.
    // DeArrow's thumbnails come with its titles.
    const elDeArrowThumbnails = createConfigCheckbox('enableDeArrowThumbnails');
    const updateDeArrowRow = () => setState(elDeArrowThumbnails, configRead('enableDeArrow'));
    configAddChangeListener('enableDeArrow', updateDeArrowRow);
    updateDeArrowRow();
    pageUITweaks.appendChild(createSection('Browsing', [
      createAlignedCycleControl('startPage', startPageModes),
      createConfigCheckbox('extendLongPressMenu'),
      createConfigCheckbox('enableDeArrow'),
      elDeArrowThumbnails
    ]));

      }
  ];

  const ensurePage = (index) => {
    const build = pageBuilders[index];
    if (!build) return;
    pageBuilders[index] = null;   // clear first: a builder must never run twice
    build();
  };
  elmContainer.ensurePage = ensurePage;

  // Chain the remaining builders one per frame so no single frame does all of
  // it. Bails out early if the user already forced them via a tab press.
  elmContainer.buildDeferredPages = () => {
    let index = 1;
    const step = () => {
      if (buildFeedSection) {
        const build = buildFeedSection;
        buildFeedSection = null;
        build();
        requestAnimationFrame(step);
        return;
      }
      while (index < pageBuilders.length && !pageBuilders[index]) index++;
      if (index >= pageBuilders.length) return;
      ensurePage(index++);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  return elmContainer;
}

// Lazy Load: optionsPanel is not created here.
// document.body.appendChild(optionsPanel); removed

function showOptionsPanel(visible) {
  if (panelInitBlock) {
      console.log('[UI] Options panel toggle blocked due to initialization lock.');
      return;
  }
  if (visible === undefined || visible === null) visible = true;
  
  if (visible && !optionsPanelVisible) {
    
    // Lazy Initialization
    if (!optionsPanel) {
        console.log('[UI] Initializing Options Panel (Lazy Load)...');
		panelInitBlock = true;
        setTimeout(() => { panelInitBlock = false; }, 500);
        optionsPanel = createOptionsPanel();
        document.body.appendChild(optionsPanel);
        
        // Apply startup states that depend on panel existence
        applyOledMode(configRead('enableOledCareMode'));
        applyTheme(configRead('uiTheme'));
    }

    console.info('Showing and focusing options panel!');
    optionsPanel.style.display = 'block';
    // Measured in the next frame, not here: the measuring forces a layout,
    // which would hold up the key press that opens the panel.
    requestAnimationFrame(optionsPanel.fitPages);
    // Rows that depend on the page under the panel (the video's channel).
    window.dispatchEvent(new CustomEvent('ytaf-panel-show'));
    // The other three tabs are built here, one per frame, now that the panel is
    // on screen. Doing it inside the keydown handler is what made opening the
    // panel a 170ms freeze on webOS 3.
    if (optionsPanel.buildDeferredPages) optionsPanel.buildDeferredPages();
    if (optionsPanel.activePage === SPONSOR_PAGE && (isWatchPage())) sponsorBlockUI.togglePopup(true);
    else sponsorBlockUI.togglePopup(false);
    
    // Find best initial focus
    const activeTabBtn = optionsPanel.querySelector('.ytaf-tab-btn.active');
    if (activeTabBtn) {
        activeTabBtn.focus();
        lastSafeFocus = activeTabBtn;
    } else {
        optionsPanel.focus();
        lastSafeFocus = optionsPanel;
    }
    optionsPanelVisible = true;
  } else if (!visible && optionsPanelVisible && optionsPanel) {
    console.info('Hiding options panel!');
    optionsPanel.style.display = 'none';
    sponsorBlockUI.togglePopup(false);
    optionsPanel.blur();
    optionsPanelVisible = false;
    lastSafeFocus = null;
    // A held Back (or whichever key closed the panel) must not go on to
    // YouTube as a page back.
    swallowHeldKey();
    // The binding may have changed while the panel was open: if no key opens
    // it any more, Green does again.
    ensureMenuKey(true);
  }
}

// Trap focus inside options panel when visible
document.addEventListener('focus', (e) => {
  if (!optionsPanelVisible || !optionsPanel) return;
  const target = e.target;
  const isSafeFocus = (optionsPanel && optionsPanel.contains(target)) || (target.closest && target.closest('.sb-segments-popup'));
  if (isSafeFocus) lastSafeFocus = target;
  else {
    e.stopPropagation();
    e.preventDefault();
    if (lastSafeFocus && lastSafeFocus.isConnected) lastSafeFocus.focus();
    else {
      const firstVisibleInput = optionsPanel.querySelector('.ytaf-tab-btn.active, .ytaf-settings-page[style*="block"] input:not([disabled]), .ytaf-settings-page[style*="block"] .shortcut-control-row');
      if (firstVisibleInput) firstVisibleInput.focus();
      else optionsPanel.focus();
    }
  }
}, true);

window.ytaf_showOptionsPanel = showOptionsPanel;

// --- Video Control Logic ---

async function skipChapter(direction = 'next') {
  if(isShortsPage()) return;
  const video = getVideo();
  if (!video || !video.duration) return;

  skipChapter.lastSrc = skipChapter.lastSrc || '';
  skipChapter.hasForced = skipChapter.hasForced || false;

  const currentSrc = video.src || window.location.href;
  let wasForcedNow = false;
  
  if (skipChapter.lastSrc !== currentSrc) { skipChapter.lastSrc = currentSrc; skipChapter.hasForced = false; }

  const getChapterEls = () => {
    const bar = document.querySelector('ytlr-multi-markers-player-bar-renderer [idomkey="progress-bar"]');
    if (!bar) return [];
    // Avoid creating an array copy if possible, but structure might require it. 
    // Using bar.children directly in loop below.
    return bar.children;
  };

  let chapterEls = getChapterEls();

  // Hack: Force UI to load chapters if they aren't in DOM
  if (chapterEls.length === 0 && !skipChapter.hasForced) {
    console.log('[Chapters] No chapters found. Forcing UI...');
    skipChapter.hasForced = true;
    wasForcedNow = true;
    showNotification('Loading chapters...');
    sendKey(REMOTE_KEYS.ENTER);
    await new Promise(resolve => setTimeout(resolve, 500));
    chapterEls = getChapterEls();
  }

  if (chapterEls.length === 0) {
    showNotification('No chapters found');
    if (wasForcedNow) setTimeout(() => simulateBack(), 250);
    return;
  }

  const totalDuration = video.duration;
  const currentTime = video.currentTime;
  let totalWidth = 0;
  const chapters = [];

  // 1. Single DOM pass: extract valid chapters and calculate total width
  for (let i = 0; i < chapterEls.length; i++) {
      const el = chapterEls[i];
      if (el.getAttribute('idomkey')?.startsWith('chapter-')) {
          const width = parseFloat(el.style.width || '0');
          totalWidth += width;
          chapters.push(width);
      }
  }

  if (totalWidth === 0) return;

  let targetTime = -1;
  let currentChapterStart = 0;
  let prevChapterStart = 0;
  let accumulatedWidth = 0;

  // 2. Find target using cached values
  for (let i = 0; i < chapters.length; i++) {
      const width = chapters[i];
      const startTimestamp = (accumulatedWidth / totalWidth) * totalDuration;
      accumulatedWidth += width;

      if (direction === 'next') {
        if (startTimestamp > currentTime + 1) {
            targetTime = startTimestamp;
            break;
        }
      } else if (currentTime >= startTimestamp) {
        // Prev logic
        prevChapterStart = currentChapterStart;
        currentChapterStart = startTimestamp;
      } else {
        // Passed current time
        break;
      }
  }
  
  // Finalize Previous Target
  if (direction !== 'next') {
      if (currentTime - currentChapterStart > 3) targetTime = currentChapterStart;
      else targetTime = prevChapterStart;
  }

  if (targetTime !== -1 && targetTime < video.duration) {
    video.currentTime = targetTime;
    showNotification(direction === 'next' ? 'Next Chapter' : 'Previous Chapter');
    if (wasForcedNow) setTimeout(() => simulateBack(), 250);
  } else {
    showNotification(direction === 'next' ? 'No next chapter' : 'Start of video');
    if (wasForcedNow) setTimeout(() => simulateBack(), 250);
  }
}

function performBurstSeek(seconds, video) {
    if (!video) video = getVideo();
    if (!video) return;
	
    // Reset accumulators if direction changes (e.g. going from +15 to -15)
	if ((seekAccumulator > 0 && seconds < 0) || (seekAccumulator < 0 && seconds > 0)) {
        // Only the toast's running total restarts; the part not applied to
        // the video yet still counts (+5, +5, -5 must move +5, not -5).
        seekAccumulator = 0;
    }

    seekAccumulator += seconds;
    pendingSeekOffset += seconds; // Add to the queue, don't apply to video yet

    // Reset the "UI Fade Out" timer
    if (seekResetTimer) clearTimeout(seekResetTimer);

    // Update UI immediately (lightweight operation)
    const directionSymbol = seekAccumulator > 0 ? '+' : '';
    const msg = `Skipped ${directionSymbol}${seekAccumulator}s`;

    if (activeSeekNotification) {
         activeSeekNotification.update(msg);
    } else {
         activeSeekNotification = showNotification(msg);
    }

    // Debounce the heavy video seek operation
    if (seekApplyTimer) clearTimeout(seekApplyTimer);

    seekApplyTimer = setTimeout(() => {
        if (pendingSeekOffset !== 0) {
            // Apply the total calculated seek in one single operation
            video.currentTime += pendingSeekOffset;
            pendingSeekOffset = 0;
        }
    }, 200); // 200ms buffer allows rapid key presses without freezing the UI

    seekResetTimer = setTimeout(() => {
        seekAccumulator = 0;
        activeSeekNotification = null;
        seekResetTimer = null;
    }, 1200);
}

// --- Magic Remote scroll-wheel seeking ---
// While the progress bar has focus, each wheel notch seeks: up is forward,
// down is back. Anywhere else the wheel keeps scrolling as before. Ported from
// jesvijonathan's fork, onto the burst-seek path so rapid notches coalesce
// into one seek and one notification.
const SCROLL_SEEK_STEP_S = 10;
const isProgressBarFocused = () => !!document.querySelector('ytlr-progress-bar.ytLrProgressBarFocused, ytlr-progress-bar[focused]');

function handleScrollSeek(evt) {
    if (!configRead('enableScrollSeek') || optionsPanelVisible) return;
    if (!isWatchPage() || !evt.deltaY || !isProgressBarFocused()) return;
    const video = getVideo();
    if (!video || !video.duration) return;
    evt.preventDefault();
    evt.stopPropagation();
    performBurstSeek(evt.deltaY > 0 ? -SCROLL_SEEK_STEP_S : SCROLL_SEEK_STEP_S, video);
}

window.addEventListener('wheel', handleScrollSeek, { passive: false, capture: true });

// --- Left/Right Seek Step ---
// While the player controls are hidden, Left and Right seek by the chosen step
// instead of YouTube's own, on the burst-seek path, so quick presses add up to
// one seek. With the controls on screen they move along the controls as
// before. (From MickLesk's fork.)
let seekStepKeyCode = null;

// Taken as shown unless the controls are found and neither active nor holding
// the focus: wrongly taking Left and Right from the controls is worse than
// leaving them to YouTube.
function playerControlsShown() {
  const controls = document.querySelector('yt-focus-container[idomkey="controls"]');
  if (!controls) return true;
  return controls.classList.contains('zylon-focus') || controls.contains(document.activeElement);
}

function handleSeekStepKey(evt) {
  if (isSyntheticKey(evt)) return;
  const code = evt.keyCode;
  if (code !== REMOTE_KEYS.LEFT.code && code !== REMOTE_KEYS.RIGHT.code) return;
  if (evt.type === 'keyup') {
    // The keyup of a press we seeked with is ours too.
    if (code === seekStepKeyCode) {
      seekStepKeyCode = null;
      evt.preventDefault();
      evt.stopImmediatePropagation();
    }
    return;
  }
  const step = Number(configRead('seekStep')) || 0;
  if (!step || optionsPanelVisible || !isWatchPage() || isShortsPage()) return;
  if (isTextBox(document.activeElement) || playerControlsShown() || isEngagementPanelVisible()) return;
  const video = getVideo();
  if (!video || !video.duration) return;
  evt.preventDefault();
  evt.stopImmediatePropagation();
  seekStepKeyCode = code;
  performBurstSeek(code === REMOTE_KEYS.RIGHT.code ? step : -step, video);
}

window.addEventListener('keydown', handleSeekStepKey, true);
window.addEventListener('keyup', handleSeekStepKey, true);

function triggerInternal(element, name) {
  if (!element) return false;
  let success = false;
  try { element.click(); console.log(`[Shortcut] Standard click triggered for ${name}`); success = true; } 
  catch (e) { console.warn(`[Shortcut] Standard click failed for ${name}:`, e); }
  
  // Try to access internal React/Polymer instance for robust clicking
  const instance = element.__instance;
  if (instance && typeof instance.onSelect === 'function') {
    console.log(`[Shortcut] Also calling internal onSelect() for ${name}`);
    try {
      const mockEvent = { type: 'click', stopPropagation: () => {}, preventDefault: () => {}, target: element, currentTarget: element, bubbles: true, cancelable: true };
      instance.onSelect(mockEvent);
      success = true;
    } catch (e) { console.warn(`[Shortcut] Internal call failed for ${name}:`, e); }
  }
  return success;
}

// --- Shortcut Helper Functions (Static Logic) ---
// Extracted to prevent object allocation inside handlers

function toggleSubtitlesLogic(player) {
    let toggledViaApi = false;
    if (player) {
        // Try API first
        if (typeof player.loadModule === 'function') player.loadModule('captions');
        if (typeof player.getOption === 'function' && typeof player.setOption === 'function') {
          try {
            const currentTrack = player.getOption('captions', 'track');
            const isEnabled = currentTrack && (currentTrack.languageCode || currentTrack.vssId);
            if (isEnabled) { player.setOption('captions', 'track', {}); showNotification('Subtitles: OFF'); toggledViaApi = true; }
            else {
              const trackList = player.getOption('captions', 'tracklist');
              const videoData = player.getVideoData ? player.getVideoData() : null;
              const targetTrack = (trackList && trackList[0]) || (videoData && videoData.captionTracks && videoData.captionTracks[0]);
              if (targetTrack) { player.setOption('captions', 'track', targetTrack); showNotification(`Subtitles: ON (${targetTrack.languageName || targetTrack.name || targetTrack.languageCode})`); toggledViaApi = true; }
            }
          } catch (e) { console.warn('[Shortcut] Subtitle API Error:', e); }
        }
    }
    // Fallback to UI clicking
    if (!toggledViaApi) {
        const capsBtn = document.querySelector('ytlr-captions-button yt-button-container') || document.querySelector('ytlr-captions-button ytlr-button');
        if (capsBtn) {
          if (triggerInternal(capsBtn, 'Captions')) {
            setTimeout(() => {
              const isPressed = capsBtn.getAttribute('aria-pressed') === 'true';
              showNotification(isPressed ? 'Subtitles: ON' : 'Subtitles: OFF');
            }, 250);
            return;
          }
        }
        showNotification('Subtitles unavailable');
    }
}

function toggleCommentsLogic() {
    const target = resolveCached('comments', COMMENT_SELECTORS);
    let commBtn = target ? target.closest('yt-button-container, ytlr-button') : null;
    let isLiveChat = false;

    if (!commBtn) {
          const chatTarget = document.querySelector('ytlr-live-chat-toggle-button yt-button-container, yt-button-container[aria-label="Live chat"]');
          if (chatTarget) {
              commBtn = chatTarget;
              isLiveChat = true;
          }
    }

    const isBtnActive = commBtn && (commBtn.getAttribute('aria-pressed') === 'true' || commBtn.getAttribute('aria-selected') === 'true');
    const isPanelVisible = isEngagementPanelVisible();

    if ((isBtnActive || isPanelVisible) && !isLiveChat) simulateBack();
    else if (triggerInternal(commBtn, isLiveChat ? 'Live Chat' : 'Comments')) {
            if (isLiveChat) {
                setTimeout(() => {
                    const pressed = commBtn.getAttribute('aria-pressed') === 'true';
                    showNotification(pressed ? 'Live Chat: ON' : 'Live Chat: OFF');
                }, 250);
            }
        }
        else {
            showNotification(isLiveChat ? 'Live Chat Unavailable' : 'Comments Unavailable');
        }
}

function toggleDescriptionLogic() {
    let target = null;

    if (cachedSelectors.description) {
        const cachedEl = document.querySelector(cachedSelectors.description);
        target = cachedEl ? cachedEl.closest('yt-button-container') : null;
    }

    // Text-matching pass can't be expressed as a selector, so it stays bespoke.
    // The querySelectorAll result is iterated directly rather than materialised
    // into an array first.
    if (!target) {
        const candidates = document.querySelectorAll('yt-formatted-string.XGffTd.OqGroe');
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i].textContent.trim() === 'Description') {
                target = candidates[i].closest('yt-button-container');
                break;
            }
        }
    }

    if (!target) {
        const genericTextBtn = document.querySelector(DESCRIPTION_FALLBACK_SELECTOR);
        if (genericTextBtn) {
            target = genericTextBtn.closest('yt-button-container');
            cachedSelectors.description = DESCRIPTION_FALLBACK_SELECTOR;
        }
    }

    const isDescActive = target && (target.getAttribute('aria-pressed') === 'true' || target.getAttribute('aria-selected') === 'true');
    const isPanelVisible = isEngagementPanelVisible();

    if (isDescActive || isPanelVisible) simulateBack();
    else if (triggerInternal(target, 'Description')) {
            setTimeout(() => {
                if (window.returnYouTubeDislike) {
                    console.log('[Shortcut] Manually triggering RYD check for description panel...');
                    window.returnYouTubeDislike.observeBodyForPanel();
                }
            }, 350);
        }
        else showNotification('Description Unavailable');
}

function saveToPlaylistLogic() {
    const el = resolveCached('save', SAVE_SELECTORS);
    // Structural check rather than comparing against the selector string, so
    // this keeps working if the selector text ever changes.
    const target = el && el.tagName === 'YT-ICON' ? el.closest('yt-button-container') : el;

    const panel = document.querySelector('.AmQJbe');
      
    if (panel) simulateBack();
    else if (!triggerInternal(target, 'Save/Watch Later')) {
            showNotification('Save Button Unavailable');
        }
}

function refreshPageLogic() {
    const commandPayload = {
        clickTrackingParams: '',
        signalServiceEndpoint: {
            signal: 'CLIENT_SIGNAL',
            actions: [
                {
                    clickTrackingParams: '',
                    signalAction: {
                        signal: 'SOFT_RELOAD_PAGE'
                    },
                    commandMetadata: {
                        webCommandMetadata: {
                            clientAction: true
                        }
                    }
                }
            ]
        }
    };

    const appRoot = document.querySelector('ytlr-app') || document.body;
    console.log('[Shortcut] Triggering soft reload...');
    
    appRoot.dispatchEvent(new CustomEvent('innertube-command', {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: commandPayload
    }));
    
    // showNotification('Refreshing Page...');
}

function playPauseLogic(video) {
    const notify = (msg) => {
        if (activePlayPauseNotification) {
            activePlayPauseNotification.update(msg);
        } else {
            activePlayPauseNotification = showNotification(msg);
        }
        
        if (playPauseNotificationTimer) clearTimeout(playPauseNotificationTimer);
        playPauseNotificationTimer = setTimeout(() => {
            activePlayPauseNotification = null;
            playPauseNotificationTimer = null;
        }, 3000);
    };

    if (video.paused) { 
        video.play(); 
        notify('Playing');
    } else {
        video.pause();
        notify('Paused');
        
        const controls = document.querySelector('yt-focus-container[idomkey="controls"]');
        const isControlsVisible = controls && controls.classList.contains('zylon-focus');
        
        // Only run hiding logic if the controls are not already visible
        if (!isControlsVisible) {
            const watchOverlay = document.querySelector('.webOs-watch');
            
            document.body.classList.add('ytaf-hide-controls');
            if (watchOverlay) watchOverlay.style.opacity = '0';
            
            // We only process the dismissal timers if we aren't on a Shorts page
            if (!isShortsPage()) {
                
                // Lazy-check the engagement panel visibility
                if (!isEngagementPanelVisible()) {
                    shortcutDebounceTime = 650;
                
                    if (document.activeElement && typeof document.activeElement.blur === 'function') {
                        document.activeElement.blur();
                    }
                    
                    setTimeout(() => {
                        const currentControls = document.querySelector('yt-focus-container[idomkey="controls"]');
                        if (currentControls && currentControls.classList.contains('zylon-focus')) {
                            sendKey(REMOTE_KEYS.BACK, document.activeElement);
                        }
                    }, 250);
                }
            }

            // Cleanup CSS and overlay (on Shorts too, or the controls and the
            // clock stay hidden after leaving them)
            setTimeout(() => {
              document.body.classList.remove('ytaf-hide-controls');
              if (watchOverlay) watchOverlay.style.opacity = '';
            }, 750);
        }
    }
}

// --- Jump to Live ---
// On a live stream that was paused or rewound, back to the live edge
// (NicholasBly/youtube-webos#148). The player's own seekToLiveHead keeps its
// live state right; the <video>'s seekable range is the fallback.
function isLiveStream(player, video) {
    try {
        const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null;
        if (data && data.isLive === true) return true;
    } catch { /* not the player API we know */ }
    return video.duration === Infinity;
}

function jumpToLiveLogic(video) {
    const player = document.getElementById(SELECTORS.PLAYER_ID);
    if (!isLiveStream(player, video)) {
        showNotification('Not a live stream');
        return;
    }
    try {
        if (player && typeof player.seekToLiveHead === 'function') {
            player.seekToLiveHead();
        } else {
            const ranges = video.seekable;
            if (!ranges || !ranges.length) { showNotification('Live edge not available'); return; }
            video.currentTime = Math.max(0, ranges.end(ranges.length - 1) - 1);
        }
        if (video.paused) video.play();
        showNotification('Jumped to Live');
    } catch (e) {
        console.warn('[Shortcut] Jump to live failed:', e);
        showNotification('Live edge not available');
    }
}

// --- Sleep Timer ---
// Each press steps to the next duration; past the last one it switches off.
// When it runs out the video is paused, so the TV's own idle timer and
// screensaver take over as if the viewer had stopped watching.
const SLEEP_TIMER_STEPS_MIN = [15, 30, 60, 90, 120];
let sleepTimerStep = -1;
let sleepTimerId = null;

function clearSleepTimer() {
    if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
    sleepTimerStep = -1;
}

function cycleSleepTimer() {
    const next = sleepTimerStep + 1;
    clearSleepTimer();
    if (next >= SLEEP_TIMER_STEPS_MIN.length) {
        showNotification('Sleep timer off');
        return;
    }
    sleepTimerStep = next;
    const minutes = SLEEP_TIMER_STEPS_MIN[next];
    sleepTimerId = setTimeout(() => {
        clearSleepTimer();
        const video = getVideo();
        if (video && !video.paused) video.pause();
        showNotification('Sleep timer: playback paused');
    }, minutes * 60000);
    showNotification(`Sleep timer: ${minutes} min`);
}

function handleShortcutAction(action) {
  // Global Actions - Do not require Video
  if (action === 'config_menu') {
      showOptionsPanel(!optionsPanelVisible);
      return;
  }
  
  if (action === 'oled_toggle') {
      let overlay = document.getElementById('oled-black-overlay');
      if (overlay) {
          overlay.remove();
          document.documentElement.classList.remove('ytaf-oled-blackout');
          if (oledKeepAliveTimer) { clearInterval(oledKeepAliveTimer); oledKeepAliveTimer = null; }
          showNotification('OLED Mode Deactivated');
      } else {
          if (optionsPanelVisible) showOptionsPanel(false);
          // Below the notification container (1200) so the toasts - this
          // feature's own included - are not painted behind the blackout, and
          // above the settings panel (1000). The clock (1199) is hidden by the
          // class instead, so it does not burn in on a black screen.
          overlay = createElement('div', { id: 'oled-black-overlay', style: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: '#000', zIndex: 1100 }});
          document.body.appendChild(overlay);
          document.documentElement.classList.add('ytaf-oled-blackout');
          
          // Keep TV awake by simulating input
          oledKeepAliveTimer = setInterval(() => {
            sendKey(REMOTE_KEYS.UP);
            setTimeout(() => sendKey(REMOTE_KEYS.UP), 250);
          }, 30 * 60 * 1000);
          showNotification('OLED Mode Activated');
      }
      return;
  }
  if (action === 'sleep_timer') {
      cycleSleepTimer();
      return;
  }
  if (action === 'refresh_page') {
      if (isWatchPage() || isShortsPage()) {
          showNotification('Cannot refresh on player pages');
          return;
      }
      refreshPageLogic();
      return;
  }

  // Player Actions - Require Video/Context
  // Player actions only make sense on a watch or Shorts page.
  if (!isWatchPage() && !isShortsPage()) return;

  const video = getVideo();
  if (!video) return;

  switch (action) {
    case 'chapter_skip':
        skipChapter('next');
        break;
    case 'chapter_skip_prev':
        skipChapter('prev');
        break;
    case 'seek_15_fwd':
        performBurstSeek(5, video);
        break;
    case 'seek_15_back':
        performBurstSeek(-5, video);
        break;
    case 'play_pause':
        playPauseLogic(video);
        break;
    case 'jump_to_live':
        jumpToLiveLogic(video);
        break;

    // case 'speed_up':
        // stepSpeed(1);
        // break;

    // case 'speed_down':
        // stepSpeed(-1);
        // break;

    // case 'speed_reset':
        // resetSpeed();
        // break;
    case 'toggle_subs':
        // Resolved here rather than above the switch: only this one action
        // needs it, and the .html5-video-player fallback is a full-document
        // class-selector walk that was being paid on every shortcut keypress.
        toggleSubtitlesLogic(
            document.getElementById(SELECTORS.PLAYER_ID) || document.querySelector('.html5-video-player')
        );
        break;
    case 'toggle_comments':
        toggleCommentsLogic();
        break;
    case 'toggle_description':
        toggleDescriptionLogic();
        break;
    case 'save_to_playlist':
        saveToPlaylistLogic();
        break;
    case 'sb_skip_prev':
        if (window.sponsorblock) {
            const success = window.sponsorblock.skipToPreviousSegment();
            if (!success) showNotification('No previous segment found');
        } else {
            showNotification('SponsorBlock not loaded');
        }
        break;
    case 'audio_only': {
        // The picture is hidden, the sound keeps playing - for music and
        // podcasts on an OLED panel. A class on <html> rather than a style on
        // the element, so it survives YouTube replacing the <video>. From
        // jesvijonathan's fork via anikettuli's NicholasBly PR #146.
        const on = document.documentElement.classList.toggle('ytaf-audio-only');
        showNotification(`Audio-Only Mode ${on ? 'Enabled' : 'Disabled'}`);
        break;
    }
    case 'sb_manual_skip':
        try {
          if (window.sponsorblock) {
            const handled = window.sponsorblock.handleBlueButton(); // Keep naming convention even if not blue button
            if (!handled) showNotification('No action available');
          } else showNotification('SponsorBlock not loaded');
        } catch (e) { showNotification('Error: ' + e.message); }
        break;
    default:
        console.warn(`[Shortcut] Unknown action: ${action}`);
  }
}

// --- Global Input Handler ---

// Whether `el` takes typed text: a textarea, or an input other than a checkbox
// or a colour. A digit with one of the panel's checkboxes focused is still a
// shortcut (a digit bound to the menu must close the panel from there too).
function isTextBox(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'color';
}

const isSyntheticKey = (evt) => !!evt[SYNTHETIC_KEY_FLAG] || evt.isTrusted === false;

// The key that closed the settings panel (Back, Escape, an Enter, the menu
// key) is swallowed until it is released: a held Back keeps repeating, and
// once the panel's own handler is gone the repeats would reach YouTube as a
// page back. heldKeyCode is the trusted key currently down, so
// showOptionsPanel(false) knows which one closed it. Keys this mod sends
// itself pass (play/pause sends Back).
let heldKeyCode = null;
let swallowedKeyCode = null;
let swallowTimer = null;

function releaseSwallowedKey() {
  swallowedKeyCode = null;
  if (swallowTimer) { clearTimeout(swallowTimer); swallowTimer = null; }
}

function armSwallowTimer(ms) {
  if (swallowTimer) clearTimeout(swallowTimer);
  // A keyup the TV never delivers must not hold the key for good.
  swallowTimer = setTimeout(releaseSwallowedKey, ms);
}

function swallowHeldKey() {
  if (heldKeyCode === null) return;
  swallowedKeyCode = heldKeyCode;
  armSwallowTimer(2000);
}

window.addEventListener('keydown', (evt) => {
  if (isSyntheticKey(evt)) return;
  const code = evt.keyCode;
  if (swallowedKeyCode !== null && code === swallowedKeyCode) {
    // A held key keeps sliding the window; its keyup ends it.
    if (evt.repeat) armSwallowTimer(1000);
    evt.preventDefault();
    evt.stopImmediatePropagation();
    return;
  }
  heldKeyCode = code;
}, true);

window.addEventListener('keyup', (evt) => {
  if (isSyntheticKey(evt)) return;
  if (evt.keyCode === heldKeyCode) heldKeyCode = null;
  if (swallowedKeyCode !== null && evt.keyCode === swallowedKeyCode) {
    releaseSwallowedKey();
    evt.preventDefault();
    evt.stopImmediatePropagation();
  }
}, true);

const eventHandler = (evt) => {
  // Keys this mod synthesises (screensaver keep-alive sends Yellow, play/pause
  // sends Back) must never trigger a binding.
  if (isSyntheticKey(evt)) return true;

  const code = evt.keyCode || evt.charCode;
  const keyColor = getKeyColor(code);

  // FAST FAIL: If typing in a native text box, let standard characters (like 0-9) pass through instantly
  if (!keyColor && isTextBox(evt.target)) {
      return true;
  }

  // Identify Key (Name)
  let keyName = keyColor;
  const isNumberKey = evt.type === 'keydown' && evt.keyCode >= 48 && evt.keyCode <= 57;

  if (isNumberKey) {
      if (isSearchPage()) return true;
      keyName = String(evt.keyCode - 48);
  }

  if (!keyName) return true; // Not a managed key

  // Get Action
  const action = shortcutCache[keyName];
  if (!action || action === 'none') return true;

  // Scope & Context Checking (O(1) Efficiency)
  const isVideoPage = isWatchPage() || isShortsPage();
  const actionScope = ACTION_SCOPES[action] || 'VIDEO'; // Default unknown actions to VIDEO for safety

  // Release the key instantly if the action's required scope doesn't match the page
  if (actionScope === 'VIDEO' && !isVideoPage) return true;

  // --- Proceed to Debounce and Execution ---

  const isBurstAction = action === 'seek_15_fwd' || action === 'seek_15_back';

  // A held bound key: its repeats are one press and never reach YouTube (a
  // held digit would jump the video to a percentage). The seeks batch their
  // presses, repeats included, so a held seek key keeps seeking.
  if (evt.repeat && !isBurstAction) {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
  }

  const now = Date.now();

  const dedupeWindow = isBurstAction ? BURST_DUPLICATE_MS : shortcutDebounceTime;

  if (now - lastShortcutTime < dedupeWindow && lastShortcutKey === keyName) {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
  }

  if (optionsPanelVisible && action !== 'config_menu') { evt.preventDefault(); evt.stopPropagation(); return false; }

  shortcutDebounceTime = 100;
  lastShortcutTime = now;
  lastShortcutKey = keyName;

  evt.preventDefault();
  evt.stopPropagation();
  handleShortcutAction(action);

  return false;
};

// window, not document, and in the capture phase. YouTube's own key handler
// sits on window capture and calls stopPropagation for the colour keys it
// claims - yellow routes to search - so a document-capture listener never saw
// a trusted yellow keydown at all. The userScript runs before YouTube's app
// code, so registering here first resolves our binding before theirs. Keys
// with no binding return without preventDefault and propagate as before.
window.addEventListener('keydown', eventHandler, true);

// --- Initialization & CSS Injection ---

function initGlobalStyles() {
    // Static stylesheet — written once, never rebuilt. Toggling a class on the
    // <html> element activates/deactivates each section. We use documentElement
    // rather than body because YouTube's leanback app rewrites body.className
    // on tab navigation (Home → Gaming, etc.) and would wipe our toggles.
    // .ytaf-hide-controls stays on body because it's owned by play/pause logic,
    // not config — YouTube never touches it.
    const style = createElement('style');
    style.textContent = `
        html.ytaf-oled-blackout .webOs-watch { display: none !important; }
        html.ytaf-audio-only video { visibility: hidden !important; }

        html.ytaf-hide-logo ytlr-redux-connect-ytlr-logo-entity,
        html.ytaf-hide-logo ytlr-logo-entity { visibility: hidden !important; }

        body.ytaf-hide-controls .GLc3cc,
        body.ytaf-hide-controls .webOs-watch,
        body.ytaf-hide-controls .ytLrWatchDefaultShadow,
        body.ytaf-hide-controls [idomkey='shadow'],
        body.ytaf-hide-controls .ytLrWatchDefault2025Shadow { opacity: 0 !important; }

        /* OLED-care mode — written once, toggled by html.oled-theme-active.
           Gated on <html> rather than <body> because YouTube's leanback app
           rewrites body.className on tab navigation and panel dialogs, which
           would wipe a body-class gate and silently disable these rules.
           Same reason ytaf-hide-logo / ytaf-fix-titles / ytaf-remove-borders
           already live on documentElement.

           The shelf backdrop's opacity is a rule of its own in
           <style id="ytaf-oled-opacity"> (syncOledShelfOpacity), so a
           videoShelfOpacity slider tick never rebuilds this block; the
           conditional rules sit under html.oled-transparent-shelf. */
        html.oled-theme-active #container,
        html.oled-theme-active .ytLrGuideResponseMask,
        html.oled-theme-active .geClSe,
        html.oled-theme-active .hsdF6b,
        html.oled-theme-active .ytLrAnimatedOverlayContainer,
        html.oled-theme-active .ZghAqf,
        html.oled-theme-active .RAE3Re .AmQJbe,
        html.oled-theme-active .tVp1L,
        html.oled-theme-active .app-quality-root .DnwJH,
        html.oled-theme-active .qRdzpd.stQChb .TYE3Ed,
        html.oled-theme-active .k82tDb { background-color: #000 !important; }
        html.oled-theme-active .ytLrGuideResponseGradient { display: none; }
        html.oled-theme-active .iha0pc { color: #000 !important; }
        html.oled-theme-active .p0DeOc { background-color: #000 !important; background-image: none !important; }
        html.oled-theme-active ytlr-player-focus-ring { border: 0.375rem solid rgb(200, 200, 200) !important; }
        html.oled-theme-active ytlr-surface-page { background-image: none !important; background-color: #000 !important; }
        html.oled-theme-active.oled-transparent-shelf .app-quality-root .UGcxnc .dxLAmd,
        html.oled-theme-active.oled-transparent-shelf .app-quality-root .UGcxnc .Dc2Zic .JkDfAc { background-color: rgba(0, 0, 0, 0) !important; }

        html.ytaf-fix-titles .app-quality-root .SK1srf .WVWtef,
        html.ytaf-fix-titles .app-quality-root .SK1srf .niS3yd {
            padding-bottom: 0.37vh !important;
            padding-top: 0.37vh !important;
        }

        html.ytaf-remove-borders yt-formatted-string,
        html.ytaf-remove-borders .style-scope.ytd-rich-grid-media,
        html.ytaf-remove-borders #video-title,
        html.ytaf-remove-borders #metadata-line,
        html.ytaf-remove-borders .ytd-video-meta-block {
            background-color: transparent !important;
            background: none !important;
            box-shadow: none !important;
        }
        html.ytaf-remove-borders #details.ytd-rich-grid-media {
            background-color: transparent !important;
            margin-top: 4px !important;
        }
        html.ytaf-remove-borders ytd-thumbnail,
        html.ytaf-remove-borders .ytd-searchbox,
        html.ytaf-remove-borders .ytp-videowall-still-info-bg {
            background-color: transparent !important;
        }
        html.ytaf-remove-borders .app-quality-root .boSXqb .QFqCxd:before,
        html.ytaf-remove-borders .app-quality-root .V7jTHe,
        html.ytaf-remove-borders .app-quality-root .g6XRz,
        html.ytaf-remove-borders .app-quality-root .UGcxnc .sjENQb {
            background-color: transparent !important;
        }
        html.ytaf-remove-borders .ltewod.BZ345e { background-color: #f1f1f1 !important; }
        html.ytaf-remove-borders .MIiKQd.CgA6bd,
        html.ytaf-remove-borders .clJQEe,
        html.ytaf-remove-borders .dySudf,
        html.ytaf-remove-borders .ltewod {
            background-color: rgba(45, 45, 45, 0.45) !important;
            background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 100%) !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3) !important;
        }

        body .ytLrWatchDefaultShadow,
        body [idomkey='shadow'] {
            display: block !important;
            height: 100% !important;
            width: 100% !important;
            pointer-events: none !important;
            position: absolute !important;
            background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, rgba(0, 0, 0, 0.8) 90%) !important;
            background-color: rgba(0, 0, 0, 0.3) !important;
        }
        body .ytLrWatchDefault2025Shadow { background-color: rgba(11, 11, 11, 0.5) !important; }

        /* Disable Animations. Scoped to YouTube's own app root, so the settings
           panel, notifications and the clock (all on <body>) keep theirs.
           Near-zero durations rather than "none": a transitionend or
           animationend that YouTube waits for still fires, just at once.
           Chrome 38 (webOS 3) only knows the -webkit- animation properties. */
        html.ytaf-no-animations ytlr-app,
        html.ytaf-no-animations ytlr-app *,
        html.ytaf-no-animations ytlr-app *:before,
        html.ytaf-no-animations ytlr-app *:after {
            -webkit-transition-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
            -webkit-transition-delay: 0s !important;
            transition-delay: 0s !important;
            -webkit-animation-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
            -webkit-animation-delay: 0s !important;
            animation-delay: 0s !important;
            -webkit-animation-iteration-count: 1 !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
        }
    `;
    document.head.appendChild(style);

    const syncClass = (cls, key) => document.documentElement.classList.toggle(cls, !!configRead(key));
    const CLASS_KEYS = {
        'ytaf-fix-titles': 'fixMultilineTitles',
        'ytaf-remove-borders': 'removeBlackBorders',
        'ytaf-no-animations': 'disableAnimations'
    };
    for (const [cls, key] of Object.entries(CLASS_KEYS)) {
        syncClass(cls, key);
        configAddChangeListener(key, () => syncClass(cls, key));
    }
}

const LOGO_URLS = {
  'logo-orange': logoOrangeUrl,
  'logo-blue': logoBlueUrl,
  'logo-red': logoRedUrl,
  'logo-dark': logoDarkUrl
};

/** The logo variant for the current theme: one of the LOGO_URLS keys. */
function currentLogoVariant() {
  const theme = configRead('uiTheme');
  return configRead('enableOledCareMode') ? 'logo-dark'
    : theme === 'classic-red' ? 'logo-red'
    : theme === 'fox' ? 'logo-orange'
    : 'logo-blue';
}

function updateLogoState() {
  const wanted = currentLogoVariant();
  document.querySelectorAll('.ytaf-logo').forEach((logo) => {
    logo.style.display = logo.classList.contains(wanted) ? '' : 'none';
  });
  syncPointerButtonTheme();
}

// The shelf backdrop's opacity, written as a rule of its own rather than a CSS
// custom property: Chromium 38 (webOS 3) has no var() and dropped the whole
// declaration, leaving the shelf un-blacked. From mirijanristic's fork.
function syncOledShelfOpacity() {
  const opacityVal = configRead('videoShelfOpacity');
  let style = document.getElementById('ytaf-oled-opacity');
  if (!style) {
    style = document.createElement('style');
    style.id = 'ytaf-oled-opacity';
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = `html.oled-theme-active .Jx9xPc { background-color: rgba(0, 0, 0, ${opacityVal / 100}) !important; }`;
  document.documentElement.classList.toggle('oled-transparent-shelf', opacityVal > 50);
}

function applyOledMode(enabled) {
  // All the OLED rules now live in initGlobalStyles() as static CSS gated by
  // html.oled-theme-active. We toggle on documentElement (not body) because
  // YouTube rewrites body.className on navigation/panel transitions — a body
  // gate would silently drop OLED whenever YT touched the class string.
  if (optionsPanel) optionsPanel.classList.toggle('oled-care', enabled);
  setNotificationOled(enabled);

  document.documentElement.classList.toggle('oled-theme-active', !!enabled);
  if (enabled) syncOledShelfOpacity();
  else document.documentElement.classList.remove('oled-transparent-shelf');

  updateLogoState();
}

function applyTheme(theme) {
  if (optionsPanel) {
      optionsPanel.classList.toggle('theme-classic-red', theme === 'classic-red');
      optionsPanel.classList.toggle('theme-fox', theme === 'fox');
  }
  setNotificationTheme(theme);
  updateLogoState();
}

// The key that opens the settings panel. With none bound (the viewer gave the
// menu key another action), Green opens it again; `announce` says so in a
// toast. Runs at start and whenever the panel closes, so a binding changed in
// the panel takes effect without a restart.
function ensureMenuKey(announce) {
    const key = shortcutKeys.find(k => shortcutCache[k] === 'config_menu');
    if (key) return key;
    console.warn('[UI] No menu keybind found. Forcing Green button to Open Settings.');
    configWrite('shortcut_key_green', 'config_menu');
    if (announce) showNotification('Press [GREEN] to open the settings');
    return 'green';
}

const startupMenuKey = ensureMenuKey(false);

// --- Start-up ---
initGlobalStyles();
initVideoQuality();
initLogoStyle();
initMathLetters();
// initPlaybackSpeed();

// Initial apply (will skip UI elements if they don't exist yet, but handle global styles)
applyOledMode(configRead('enableOledCareMode'));
configAddChangeListener('enableOledCareMode', (evt) => applyOledMode(evt.detail.newValue));

// The Fox theme is this fork's default. An install that already stored the
// old default (blue) is moved to it once; after that the choice is the
// viewer's.
if (!configRead('foxThemeApplied')) {
  configWrite('foxThemeApplied', true);
  if (configRead('uiTheme') === 'blue-force-field') configWrite('uiTheme', 'fox');
}

applyTheme(configRead('uiTheme'));
configAddChangeListener('uiTheme', (evt) => applyTheme(evt.detail.newValue));

configAddChangeListener('enableAdBlock', () => {
  syncAdblockHook();
  // Tracking Block is gated on Ad Blocking, so its network hooks follow too.
  syncTrackingBlock();
});

function syncTrackingBlock() {
  // Greyed out in the panel while Ad Blocking is off, so off then as well.
  if (configRead('enableAdBlock') && configRead('enableTrackingBlock')) initTrackingBlock();
  else destroyTrackingBlock();
}

configAddChangeListener('enableTrackingBlock', syncTrackingBlock);

// The emoji fix lives on the same JSON.parse hook, so toggling it has to be
// able to install that hook even with Ad Blocking off.
configAddChangeListener('enableLegacyEmojiFix', () => syncAdblockHook());
configAddChangeListener('hideGuestSignInPrompts', () => syncAdblockHook());
configAddChangeListener('hideEndcards', () => syncAdblockHook());
// Max Thumbnail Quality rewrites URLs inside the same JSON.parse hook.
configAddChangeListener('upgradeThumbnails', () => syncAdblockHook());
// Load Rows Ahead raises the continuation threshold inside the same hook.
configAddChangeListener('loadRowsAhead', () => syncAdblockHook());
// "Are you still watching?" (Bypass Nag Screens) and the subtitle start state
// are rewritten in the same hook.
configAddChangeListener('enableAutoLogin', () => syncAdblockHook());
configAddChangeListener('disableAutoCaptions', () => syncAdblockHook());
// Original audio, the long-press menu and DeArrow are rewrites in the same hook.
configAddChangeListener('forceOriginalAudio', () => syncAdblockHook());
configAddChangeListener('extendLongPressMenu', () => syncAdblockHook());
configAddChangeListener('enableDeArrow', () => syncAdblockHook());

configAddChangeListener('videoShelfOpacity', () => {
  // Cheap update — rewrites the one-rule opacity <style> and toggles the
  // transparent-shelf class. No rebuild of the global stylesheet.
  if (configRead('enableOledCareMode')) syncOledShelfOpacity();
});

// --- UI Brightness ---
//
// A dark layer over the browse UI (home, search, channels...), never over the
// watch page or Shorts, so the video itself is not dimmed. It lets every
// pointer event through, and it sits under the settings panel, notifications,
// the clock and the pointer button (ui.css), so only YouTube's own UI dims.
let dimOverlay = null;
function syncUiBrightness() {
  const brightness = Number(configRead('uiBrightness')) || 100;
  const on = brightness < 100 && !isWatchPage() && !isShortsPage();
  if (!on) {
    if (dimOverlay) dimOverlay.style.display = 'none';
    return;
  }
  if (!dimOverlay) {
    if (!document.body) return;
    dimOverlay = createElement('div', { id: 'ytaf-dim-overlay' });
    document.body.appendChild(dimOverlay);
  }
  dimOverlay.style.opacity = String((100 - Math.max(0, brightness)) / 100);
  dimOverlay.style.display = 'block';
}
configAddChangeListener('uiBrightness', syncUiBrightness);
window.addEventListener('ytaf-page-update', syncUiBrightness);

// --- Settings button for the Magic Remote pointer ---
//
// Remotes with no colour buttons (the LG MR26, NicholasBly/youtube-webos#189)
// had no way into the panel. A fox button in the top-right corner (the logo
// and colours of the current theme, see syncPointerButtonTheme) shows while
// the pointer is in use - on a real move, never on its own - and fades a few
// seconds after the last one, or as soon as webOS hides the pointer. A click
// opens or closes the panel. It is a plain <div> with no tabindex (tabIndex
// -1) and takes no focus on click, so neither D-pad navigation nor YouTube's
// focus model can ever land on it.
const POINTER_BUTTON_HIDE_MS = 4000;
let pointerButtonTimer = 0;
let lastPointerX = -1;
let lastPointerY = -1;

function hidePointerButton() {
  clearTimeout(pointerButtonTimer);
  if (pointerButton) pointerButton.classList.remove('ytaf-visible');
}

function createPointerButton() {
  const swallow = (evt) => { evt.preventDefault(); evt.stopPropagation(); };
  const btn = createElement('div', {
    id: 'ytaf-pointer-btn',
    title: 'YouTube Extended settings',
    events: {
      // preventDefault keeps focus where it is (no blur of the panel's row).
      mousedown: swallow,
      mouseup: swallow,
      click: (evt) => {
        swallow(evt);
        showOptionsPanel(!optionsPanelVisible);
        showPointerButton();
      }
    }
  }, createElement('img', { src: logoOrangeUrl, alt: '' }));
  btn.setAttribute('role', 'button');
  document.body.appendChild(btn);
  pointerButton = btn;
  syncPointerButtonTheme();
  return btn;
}

// The button follows the panel's theme: the same logo variant as the panel
// heading, and a class per variant for the ring and hover colours in ui.css.
function syncPointerButtonTheme() {
  if (!pointerButton) return;
  const variant = currentLogoVariant();
  for (const key of Object.keys(LOGO_URLS)) pointerButton.classList.toggle(`ytaf-${key}`, key === variant);
  const img = pointerButton.firstChild;
  if (img && img.getAttribute('src') !== LOGO_URLS[variant]) img.setAttribute('src', LOGO_URLS[variant]);
}

function showPointerButton() {
  if (!configRead('pointerSettingsButton') || !document.body) return;
  if (!pointerButton) pointerButton = createPointerButton();
  pointerButton.classList.toggle('ytaf-below-clock', configRead('clockMode') !== 'off');
  pointerButton.classList.add('ytaf-visible');
  clearTimeout(pointerButtonTimer);
  pointerButtonTimer = setTimeout(hidePointerButton, POINTER_BUTTON_HIDE_MS);
}

document.addEventListener('mousemove', (evt) => {
  // Chrome sends a synthetic mousemove with unchanged coordinates when the
  // page scrolls under a resting pointer; only a real move counts.
  if (evt.clientX === lastPointerX && evt.clientY === lastPointerY) return;
  lastPointerX = evt.clientX;
  lastPointerY = evt.clientY;
  showPointerButton();
}, true);
// webOS reports the pointer appearing and disappearing (it hides on a D-pad
// press or after a few idle seconds).
document.addEventListener('cursorStateChange', (evt) => {
  if (evt.detail && evt.detail.visibility === false) hidePointerButton();
});
window.addEventListener('keydown', (evt) => {
  if (evt.keyCode in ARROW_KEY_CODE) hidePointerButton();
}, true);
// Picking a video with the pointer must not leave the button over it.
window.addEventListener('ytaf-page-update', (evt) => {
  if (evt.detail.isWatch || evt.detail.isShorts) hidePointerButton();
});
configAddChangeListener('pointerSettingsButton', (evt) => { if (!evt.detail.newValue) hidePointerButton(); });

// Apply initial states on boot
syncUiBrightness();
syncAdblockHook();
syncTrackingBlock();

// Startup hint. It used to fire a fixed 2s after the script loaded and stay
// 3s, so on a TV still showing the splash or the account picker it came and
// went unseen. Wait instead until YouTube shows a real page (a
// WEB_PAGE_TYPE_* class on <body> that is not the account selector), then
// show it a little longer. Gives up waiting after 30s and shows it anyway.
(function showStartupHint() {
  const startedAt = Date.now();
  const pageReady = () => {
    const cls = (document.body && document.body.className) || '';
    return cls.indexOf('WEB_PAGE_TYPE_') !== -1 && cls.indexOf(SELECTORS.ACCOUNT_SELECTOR) === -1;
  };
  const check = () => {
    if (pageReady() || Date.now() - startedAt > 30000) {
      // The key bound at start (a viewer may have moved the menu off Green).
      const label = startupMenuKey.toUpperCase();
      setTimeout(() => showNotification(`Press [${label}] to open the settings`, 6000), 1000);
      return;
    }
    setTimeout(check, 500);
  };
  setTimeout(check, 1000);
})();