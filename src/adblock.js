import { configGetAll, configAddChangeListener } from './config';
import { isShortsPage } from './utils';
import { getWebOSVersion } from './webos-utils';
import { FetchRegistry } from './hooks';
import { upgradeResponseThumbnails, thumbnailHookRequired } from './thumbnail-quality.js';
import { raiseRowsAhead } from './rows-ahead.js';

const DEBUG = false;
const EMOJI_DEBUG = false; 
const FORCE_FALLBACK = false;

let isFetchHooked = false;
let isXHRHooked = false;
let originalXHROpen = null;
let originalXHRSend = null;
const cachedWebOSVersion = getWebOSVersion();

// --- CONSTANTS & CONFIGURATION ---

// TELEMETRY_REGEX is derived from this list. '/api/stats/watchtime' and
// '/api/stats/playback' are deliberately absent: they register the view against
// the creator and leak nothing the player has not already sent.
const BLOCKED_TELEMETRY_PATHS = [
  '/youtubei/v1/log_event',
  '/ptracking',
  '/api/stats/atr',
  '/api/stats/qoe',
  '/pagead/',
  '/eligibility_check'
];

const TELEMETRY_REGEX = new RegExp(
  BLOCKED_TELEMETRY_PATHS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
);

const UI_STRINGS = {
  SHORTS_TITLE: 'Shorts',
  GUEST_PROMPT_TEXT: 'Sign in for better recommendations'
};

// The shelves removed by their title. The TV sends the title in the account's
// language and these shelves carry no language-independent marker that has
// been seen in a response, so each language needs its exact title here
// (NicholasBly/youtube-webos#101); only the English ones are confirmed.
// Compared trimmed and lower-cased.
const SHELF_TITLES = {
  TOP_LIVE_GAMES: new Set(['top live games']),
  MOST_RELEVANT: new Set(['most relevant'])
};

const YT_CONSTANTS = {
  SHELF_TYPE_SHORTS: 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS',
  TILE_STYLE_SHORTS: 'TILE_STYLE_YTLR_SHORTS',
  BADGE_STYLE_LIVE: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE',
  BADGE_STYLE_UPCOMING: 'THUMBNAIL_OVERLAY_BADGE_STYLE_UPCOMING',
  CONTENT_TYPE_LIVE: 'TILE_CONTENT_TYPE_LIVE',
  CONTENT_TYPE_SHORTS: 'TILE_CONTENT_TYPE_SHORTS',
  VIDEO_TYPE_REEL_AD: 'REEL_VIDEO_TYPE_AD'
};

const CONFIG_KEYS = {
  ADBLOCK: 'enableAdBlock',
  TRACKING: 'enableTrackingBlock',
  SHORTS: 'removeGlobalShorts',
  LIVE: 'removeLiveVideos',
  UPCOMING: 'removeUpcomingVideos',
  MEMBERS: 'removeMembersOnly',
  LIVE_GAMES: 'removeTopLiveGames',
  MOST_RELEVANT: 'removeMostRelevant',
  GUEST_PROMPTS: 'hideGuestSignInPrompts',
  EMOJI_FIX: 'enableLegacyEmojiFix',
  ENDCARDS: 'hideEndcards',
  THUMBNAILS: 'upgradeThumbnails',
  ROWS_AHEAD: 'loadRowsAhead',
  // "Are you still watching?" is one of the nag screens this switch bypasses.
  NAG_SCREENS: 'enableAutoLogin',
  AUTO_CAPTIONS: 'disableAutoCaptions'
};

// One emoji character: the symbols below in the BMP, or any astral character
// (a surrogate pair).
const EMOJI_CHAR_RE = /[©®‼⁉™ℹ↔-↙↩↪⌚⌛⌨⏏⏩-⏳⏸-⏺Ⓜ▪▫▶◀◻-◾☀-☄☎☑☔☕☘☝☠☢☣☦☪☮☯☸-☺♀♂♈-♓♟♠♣♥♦♨♻♾♿⚒-⚗⚙⚛⚜⚠⚡⚪⚫⚰⚱⚽⚾⛄⛅⛎⛏⛑⛓⛔⛩⛪⛰-⛵⛷-⛺⛽✂✅✈-✍✏✒✔✖✝✡✨✳✴❄❇❌❎❓-❕❗❣❤➕-➗➡➰➿⤴⤵⬅-⬇⬛⬜⭐⭕〰〽㊗㊙]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/;
// What may follow one: the emoji presentation selector, a skin tone, a tag
// character (the subdivision flags).
const EMOJI_MODIFIER = '(?:\\uFE0F|\\uD83C[\\uDFFB-\\uDFFF]|\\uDB40[\\uDC20-\\uDC7F])';
const EMOJI_CHAR = `(?:${EMOJI_CHAR_RE.source})`;
// One emoji as twemoji draws it, the unit that is wrapped: a flag (two
// regional indicators), a keycap, or a character with its modifiers and the
// characters zero-width-joined to it. Wrapped one code point at a time, a
// thumbs-up and its skin tone, or a family, came apart into several images,
// and a keycap (#️⃣) was not wrapped at all. (From mirijanristic's fork.)
const EMOJI_RE = new RegExp(
  '\\uD83C[\\uDDE6-\\uDDFF]\\uD83C[\\uDDE6-\\uDDFF]|[#*0-9]\\uFE0F?\\u20E3|' +
  `${EMOJI_CHAR}${EMOJI_MODIFIER}*(?:\\u200D${EMOJI_CHAR}${EMOJI_MODIFIER}*)*`
);
const EMOJI_RE_CAP = new RegExp(`(${EMOJI_RE.source})`, 'g');
const EMOJI_RE_GLOBAL = new RegExp(EMOJI_RE.source, 'g');
// Includes our own sentinels: a title that ships ​/‌ verbatim could
// otherwise forge an "already wrapped" region that emoji-font.js then treats
// as its own output. Stripping first also makes processEmojiString idempotent.
const CLEAN_TEXT_RE = /[​‌⁠﻿]/g;
// Single-scan gate for "does this string need any emoji work at all" - most
// YouTube titles are plain text and reject here. Every emoji holds an emoji
// character or the keycap mark.
const NEEDS_TEXT_WORK_RE = new RegExp(EMOJI_CHAR_RE.source + '|\\u20E3|[\\u200B\\u200C\\u2060\\uFEFF]');
// A sentinel to strip or an emoji to wrap, in one scan (wrapAttributedContent).
const ATTRIBUTED_WORK_RE = new RegExp(`[\\u200B\\u200C\\u2060\\uFEFF]|(${EMOJI_RE.source})`, 'g');
// An emoji or a sentinel written as a JSON escape (😀): the code
// points of EMOJI_CHAR_RE and CLEAN_TEXT_RE and the keycap mark (U+00A9,
// U+00AE, U+2000 to U+32FF, the surrogates, U+FEFF), loosely. An escaped
// ASCII character (& in a URL) does not match.
const ESCAPED_EMOJI_RE = /\\u(?:00[aA][9eE]|2[0-9a-fA-F]{3}|3[0-2][0-9a-fA-F]{2}|[dD][89abAB][0-9a-fA-F]{2}|[fF][eE][fF][fF])/;

/**
 * Whether the JSON text can hold anything the emoji walk would change: one
 * native scan of the text, so the walk over every item of a response (the
 * most expensive pass on webOS 3 and 4) is skipped for the ones without.
 */
function mayNeedEmojiWork(text) {
  return NEEDS_TEXT_WORK_RE.test(text) || ESCAPED_EMOJI_RE.test(text);
}

// A trackingParams value is an opaque token without quotes or escapes; one
// with a backslash in it is not matched and stays as sent. The leading quote
// keeps clickTrackingParams out of it: stripping that breaks clicking endcards.
// A key inside a string value cannot match: its quotes are escaped there.
const TRACKING_PARAMS_KEY = '"trackingParams"';
const TRACKING_PARAMS_RE = /"trackingParams"\s*:\s*"[^"\\]*"/g;
const TRACKING_PARAMS_EMPTY = '"trackingParams":""';

/**
 * The JSON text with every string trackingParams blanked, at any depth: one
 * native pass over the text before the parse, where the walk of the parsed
 * tree stopped at depth 15 and cost more than the parse itself on a browse
 * response. The same string comes back when the key does not occur. (From
 * mirijanristic's fork.)
 */
function stripTrackingParams(text) {
  if (text.indexOf(TRACKING_PARAMS_KEY) === -1) return text;
  return text.replace(TRACKING_PARAMS_RE, TRACKING_PARAMS_EMPTY);
}

const IGNORE_ON_SHORTS = new Set(['SEARCH', 'PLAYER', 'ACTION']);

// The badges an item is removed for (hasWantedBadge), as bits of cfgFlags.badgeMask.
const BADGE_LIVE = 1;
const BADGE_UPCOMING = 2;
const BADGE_MEMBERS = 4;

// configGetAll() returns the live reference, so this binds once at load.
const cfgSnapshot = configGetAll();
let anyFilterEnabled = false;
// The same without Load Rows Ahead, which runs before everything else.
let anyResponseFilterEnabled = false;
let cfgEmojiFixEffective = false;

// Singleton passed to the filters, refreshed by recomputeFilterFlags() rather
// than re-allocated on every JSON.parse.
const cfgFlags = {
  enableAdBlock: false,
  enableTrackingBlock: false,
  removeGlobalShorts: false,
  removeLiveVideos: false,
  removeUpcomingVideos: false,
  removeMembersOnly: false,
  // BADGE_* bits of the three above, so an item's badges are read once.
  badgeMask: 0,
  removeTopLiveGames: false,
  removeMostRelevant: false,
  hideGuestPrompts: false,
  enableLegacyEmojiFix: false,
  hideEndcards: false,
  upgradeThumbnails: false,
  loadRowsAhead: false,
  removeYouThere: false,
  disableAutoCaptions: false
};

// cfgFlags with the legacy emoji fix off: what the filters get for a response
// whose text holds nothing the fix would change (hookedParse).
const cfgFlagsNoEmoji = Object.assign({}, cfgFlags);
// Every filter off and only the legacy emoji fix left: for the responses the
// Shorts player must get unfiltered, whose text still needs its emoji wrapped.
const cfgFlagsEmojiOnly = Object.assign({}, cfgFlags);

function recomputeFilterFlags() {
  cfgEmojiFixEffective = !!cfgSnapshot[CONFIG_KEYS.EMOJI_FIX] && cachedWebOSVersion <= 4;

  const adBlock = !!cfgSnapshot[CONFIG_KEYS.ADBLOCK];
  cfgFlags.enableAdBlock = adBlock;
  // Tracking Block, the Shorts, Live, Top live games and Most relevant filters
  // and the guest-prompt filter are Ad Blocking's own: the panel greys them out
  // while Ad Blocking is off, so they must genuinely do nothing then.
  cfgFlags.enableTrackingBlock = adBlock && !!cfgSnapshot[CONFIG_KEYS.TRACKING];
  cfgFlags.removeGlobalShorts = adBlock && !!cfgSnapshot[CONFIG_KEYS.SHORTS];
  cfgFlags.removeLiveVideos = adBlock && !!cfgSnapshot[CONFIG_KEYS.LIVE];
  cfgFlags.removeUpcomingVideos = adBlock && !!cfgSnapshot[CONFIG_KEYS.UPCOMING];
  cfgFlags.removeMembersOnly = adBlock && !!cfgSnapshot[CONFIG_KEYS.MEMBERS];
  cfgFlags.badgeMask = (cfgFlags.removeLiveVideos ? BADGE_LIVE : 0) |
    (cfgFlags.removeUpcomingVideos ? BADGE_UPCOMING : 0) |
    (cfgFlags.removeMembersOnly ? BADGE_MEMBERS : 0);
  cfgFlags.removeTopLiveGames = adBlock && !!cfgSnapshot[CONFIG_KEYS.LIVE_GAMES];
  cfgFlags.removeMostRelevant = adBlock && !!cfgSnapshot[CONFIG_KEYS.MOST_RELEVANT];
  cfgFlags.hideGuestPrompts = adBlock && !!cfgSnapshot[CONFIG_KEYS.GUEST_PROMPTS];
  // Independent switches on the same hook.
  cfgFlags.enableLegacyEmojiFix = cfgEmojiFixEffective;
  cfgFlags.hideEndcards = !!cfgSnapshot[CONFIG_KEYS.ENDCARDS];
  cfgFlags.upgradeThumbnails = !!cfgSnapshot[CONFIG_KEYS.THUMBNAILS];
  cfgFlags.loadRowsAhead = !!cfgSnapshot[CONFIG_KEYS.ROWS_AHEAD];
  cfgFlags.removeYouThere = !!cfgSnapshot[CONFIG_KEYS.NAG_SCREENS];
  cfgFlags.disableAutoCaptions = !!cfgSnapshot[CONFIG_KEYS.AUTO_CAPTIONS];

  anyResponseFilterEnabled = !!(
    cfgFlags.enableAdBlock ||
    cfgFlags.enableTrackingBlock ||
    cfgFlags.removeGlobalShorts ||
    cfgFlags.removeLiveVideos ||
    cfgFlags.removeUpcomingVideos ||
    cfgFlags.removeMembersOnly ||
    cfgFlags.removeTopLiveGames ||
    cfgFlags.removeMostRelevant ||
    cfgFlags.hideGuestPrompts ||
    cfgFlags.enableLegacyEmojiFix ||
    cfgFlags.hideEndcards ||
    cfgFlags.upgradeThumbnails ||
    cfgFlags.removeYouThere ||
    cfgFlags.disableAutoCaptions
  );
  anyFilterEnabled = anyResponseFilterEnabled || cfgFlags.loadRowsAhead;

  Object.assign(cfgFlagsNoEmoji, cfgFlags);
  cfgFlagsNoEmoji.enableLegacyEmojiFix = false;
  for (const k in cfgFlagsEmojiOnly) cfgFlagsEmojiOnly[k] = false;
  cfgFlagsEmojiOnly.badgeMask = 0;
  cfgFlagsEmojiOnly.enableLegacyEmojiFix = cfgFlags.enableLegacyEmojiFix;
}

recomputeFilterFlags();
for (const k of Object.values(CONFIG_KEYS)) {
  configAddChangeListener(k, recomputeFilterFlags);
}

const SCHEMA_REGISTRY = {
  typeSignatures: [
    { type: 'SHORTS_SEQUENCE', detectionPath: ['entries'], matchFn: (data) => Array.isArray(data.entries) },
    { type: 'PLAYER', detectionPath: ['streamingData'] },
    { type: 'NEXT', detectionPath: ['contents', 'singleColumnWatchNextResults'] },
    { type: 'HOME_BROWSE', detectionPath: ['contents', 'tvBrowseRenderer', 'content', 'tvSurfaceContentRenderer'] },
    { type: 'BROWSE_TABS', detectionPath: ['contents', 'tvBrowseRenderer', 'content', 'tvSecondaryNavRenderer'] },
    { type: 'SEARCH', detectionPath: ['contents', 'sectionListRenderer'], excludePath: ['contents', 'tvBrowseRenderer'] },
    { type: 'CONTINUATION', detectionPath: ['continuationContents'] },
    { type: 'ACTION', detectionPath: ['onResponseReceivedActions'] },
    { type: 'ACTION', detectionPath: ['onResponseReceivedEndpoints'] }
  ],
  paths: {
    PLAYER: { overlayPath: ['playerOverlays', 'playerOverlayRenderer'] },
    NEXT: { overlayPath: ['playerOverlays', 'playerOverlayRenderer'], pivotPath: ['contents', 'singleColumnWatchNextResults', 'pivot', 'sectionListRenderer', 'contents'] },
    SHORTS_SEQUENCE: { listPath: ['entries'] },
    HOME_BROWSE: { mainContent: ['contents', 'tvBrowseRenderer', 'content', 'tvSurfaceContentRenderer', 'content', 'sectionListRenderer', 'contents'] },
    BROWSE_TABS: { tabsPath: ['contents', 'tvBrowseRenderer', 'content', 'tvSecondaryNavRenderer', 'sections', '0', 'tvSecondaryNavSectionRenderer', 'tabs'] },
    SEARCH: { mainContent: ['contents', 'sectionListRenderer', 'contents'] },
    CONTINUATION: { 
      sectionPath: ['continuationContents', 'sectionListContinuation', 'contents'], 
      gridPath: ['continuationContents', 'gridContinuation', 'items'],
      horizontalPath: ['continuationContents', 'horizontalListContinuation', 'items'],
      tvSurfacePath: ['continuationContents', 'tvSurfaceContentContinuation', 'content', 'sectionListRenderer', 'contents']
    }
  }
};

let origParse = JSON.parse;
let isHooked = false;
// Whether hookedParse is still somewhere in the JSON.parse chain. Hooks
// installed after ours (force-codec.js, subtitle-translate.js) wrap it, so
// switching off must not write origParse back over them - it just turns the
// hook into a pass-through instead.
let isInstalled = false;

// --- CORE FUNCTIONS ---

function debugLog(msg, ...args) {
  if (DEBUG) console.log(`[AdBlock] ${msg}`, ...args);
}

function processEmojiString(str) {
  if (typeof str !== 'string' || !str) return str;
  if (!NEEDS_TEXT_WORK_RE.test(str)) return str;
  let cleanedStr = str.replace(CLEAN_TEXT_RE, '');

  const replaced = cleanedStr.replace(EMOJI_RE_GLOBAL, '​$&‌');
  if (EMOJI_DEBUG && replaced !== str) {
    console.log(`[AdBlock-Emoji] Wrapped emoji in string: "${str}"`);
  }
  return replaced;
}

// Idempotent by construction: the sentinels are stripped first, then re-wrapped
// from the cleaned text. That also stops a title shipping ​/‌ verbatim
// from forging an "already wrapped" region.
function splitIntoRuns(text, originalRun = {}) {
    if (!NEEDS_TEXT_WORK_RE.test(text)) return null;

    const cleanText = text.replace(CLEAN_TEXT_RE, '');
    if (!EMOJI_RE.test(cleanText)) return null;

    const parts = cleanText.split(EMOJI_RE_CAP);
    const newRuns = [];

    for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        if (i % 2 === 1) {
            newRuns.push(Object.assign({}, originalRun, { text: '​' + parts[i] + '‌' }));
        } else {
            newRuns.push(Object.assign({}, originalRun, { text: parts[i] }));
        }
    }
    return newRuns;
}

/** Whether `obj` has offset runs (commandRuns, styleRuns...) over its `content`. */
function hasOffsetRuns(obj) {
  for (const key in obj) {
    if (key.slice(-4) === 'Runs' && Array.isArray(obj[key])) return true;
  }
  return false;
}

/**
 * An attributed string's `content` wrapped, and the offsets of its runs
 * (UTF-16 units of `content`) moved with the characters they name: a run
 * starting at an emoji starts at its opening sentinel, one ending with it
 * ends after the closing one. Without this a mention, link or timestamp after
 * an emoji pointed two characters early per emoji. (From mirijanristic's fork.)
 */
function wrapAttributedContent(obj) {
  const src = obj.content;
  // Each edit as three numbers: where it starts and ends in `src`, and +1 for
  // a wrapped emoji or -1 for a stripped sentinel.
  const edits = [];
  let out = '';
  let last = 0;
  ATTRIBUTED_WORK_RE.lastIndex = 0;
  let m = ATTRIBUTED_WORK_RE.exec(src);
  while (m !== null) {
    out += src.slice(last, m.index);
    if (m[1]) {
      out += '​' + m[1] + '‌';
      edits.push(m.index, m.index + m[1].length, 1);
    } else {
      edits.push(m.index, m.index + 1, -1);
    }
    last = m.index + m[0].length;
    m = ATTRIBUTED_WORK_RE.exec(src);
  }
  if (edits.length === 0) return;
  out += src.slice(last);

  // Where offset `p` of `src` lands in `out`.
  const moved = (p) => {
    let shift = 0;
    for (let i = 0; i < edits.length; i += 3) {
      if (edits[i + 2] === -1) {
        if (edits[i] < p) shift--;
      } else if (edits[i + 1] <= p) {
        shift += 2;
      } else if (edits[i] < p) {
        shift++;
      }
    }
    return p + shift;
  };
  for (const key in obj) {
    const runs = obj[key];
    if (key.slice(-4) !== 'Runs' || !Array.isArray(runs)) continue;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (!run || typeof run !== 'object') continue;
      const start = typeof run.startIndex === 'number' ? run.startIndex : 0;
      const newStart = moved(start);
      if (typeof run.length === 'number') run.length = moved(start + run.length) - newStart;
      if (newStart !== start) run.startIndex = newStart;
    }
  }
  obj.content = out;
}

// Non-recursive: the emoji/text fields of a single node, in place.
// walkAndProcess guarantees obj is a non-null object.
function processTextFieldsInPlace(obj) {
  // Set when the runs array below came from simpleText in this same call;
  // re-splitting it would be work for an identical result.
  let justBuiltRuns = false;

  if (typeof obj.simpleText === 'string' && NEEDS_TEXT_WORK_RE.test(obj.simpleText)) {
    const runs = splitIntoRuns(obj.simpleText);
    if (runs) {
        obj.runs = runs;
        delete obj.simpleText; 
        justBuiltRuns = true;
    } else {
        obj.simpleText = obj.simpleText.replace(CLEAN_TEXT_RE, '');
    }
  }

  if (typeof obj.sectionString === 'string') {
    obj.sectionString = processEmojiString(obj.sectionString); 
  }
  
  if (typeof obj.content === 'string' && NEEDS_TEXT_WORK_RE.test(obj.content)) {
    if (hasOffsetRuns(obj)) wrapAttributedContent(obj);
    else obj.content = processEmojiString(obj.content);
  }
  
  if (!justBuiltRuns && Array.isArray(obj.runs)) {
    const src = obj.runs;
    // Lazily allocated: a runs array only needs rebuilding if a run actually
    // splits, which is rare.
    let newRuns = null;
    for (let i = 0, len = src.length; i < len; i++) {
      const run = src[i];
      if (!run || typeof run.text !== 'string') {
        if (newRuns) newRuns.push(run);
        continue;
      }
      if (!NEEDS_TEXT_WORK_RE.test(run.text)) {
        if (newRuns) newRuns.push(run);
        continue;
      }
      const split = splitIntoRuns(run.text, run);
      if (split) {
        if (!newRuns) newRuns = src.slice(0, i);
        for (let j = 0; j < split.length; j++) newRuns.push(split[j]);
      } else {
        run.text = run.text.replace(CLEAN_TEXT_RE, '');
        if (newRuns) newRuns.push(run);
      }
    }
    if (newRuns) obj.runs = newRuns;
  }
}

// Depth-limited walk doing the emoji text processing. trackingParams go in
// the text, before the parse (stripTrackingParams).
function walkAndProcess(obj, maxDepth, currentDepth = 0) {
  if (!obj || typeof obj !== 'object' || currentDepth > maxDepth) return;

  processTextFieldsInPlace(obj);

  const nextDepth = currentDepth + 1;

  if (Array.isArray(obj)) {
    for (let i = 0, len = obj.length; i < len; i++) {
      const v = obj[i];
      if (v && typeof v === 'object') walkAndProcess(v, maxDepth, nextDepth);
    }
  } else {
    // for-in, not Object.keys(): identical visited set for JSON.parse output,
    // without allocating an array at every node of the response tree.
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === 'object') walkAndProcess(v, maxDepth, nextDepth);
    }
  }
}

// Per-item entry point for the filter functions.
function findAndProcessText(obj, maxDepth = 20) {
  walkAndProcess(obj, maxDepth);
}

const telemetryFetchHandler = (evt) => {
  const { url } = evt.detail;
  // .pathname avoids the .href getter rebuilding the whole URL string, and all
  // BLOCKED_TELEMETRY_PATHS are path-only.
  if (TELEMETRY_REGEX.test(url.pathname)) {
    if (DEBUG) console.info('[AdBlock] Blocked telemetry Fetch request:', url.pathname);
    evt.preventDefault();
  }
};

export function initTrackingBlock() {
  if (isFetchHooked || isXHRHooked) return;

  // 1. Hook Fetch (Wrapped separately so webOS 3 EventTarget failures don't break XHR)
  try {
    if (typeof FetchRegistry !== 'undefined' && FetchRegistry.getInstance) {
      FetchRegistry.getInstance().addEventListener('request', telemetryFetchHandler);
      isFetchHooked = true; // set here — nothing between this and add() can throw
    }
  } catch (e) {
    console.warn('[AdBlock] Fetch hook failed (expected behavior on webOS 3):', e.message);
  }

  // 2. Hook XMLHttpRequest
  try {
    originalXHROpen = window.XMLHttpRequest.prototype.open;
    originalXHRSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function(method, url) {
      // Fallback for older engines that might not support optional chaining properly
      const urlStr = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
      // The path alone, as the fetch side tests it: a blocked path named in a
      // query parameter (a redirect or a next= URL) must not block the request.
      const query = urlStr.indexOf('?');
      const path = query === -1 ? urlStr : urlStr.slice(0, query);
      this.__adblockBlocked = !!path && TELEMETRY_REGEX.test(path);

      if (this.__adblockBlocked) {
        if (DEBUG) console.info('[AdBlock] Blocked telemetry XHR request:', urlStr);
        // Point the request at an empty data: URL instead of refusing to send.
        const isAsync = arguments.length > 2 ? arguments[2] : true;
        return originalXHROpen.call(this, 'GET', 'data:text/plain,', isAsync);
      }

      // Use standard 'arguments' instead of spread syntax (...args) for webOS 3 compatibility
      return originalXHROpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function(body) {
      if (this.__adblockBlocked) {
        return originalXHRSend.call(this); // drop the telemetry body
      }
      return originalXHRSend.apply(this, arguments);
    };

    isXHRHooked = true;
    console.info('[AdBlock] Telemetry network hooks enabled (XHR)');
  } catch (e) {
    console.error('[AdBlock] Failed to initialize XHR telemetry blockers:', e);
  }
}

export function destroyTrackingBlock() {
  if (!isFetchHooked && !isXHRHooked) return;

  // 1. Unhook Fetch
  if (isFetchHooked) {
    try {
      if (typeof FetchRegistry !== 'undefined' && FetchRegistry.getInstance) {
        FetchRegistry.getInstance().removeEventListener('request', telemetryFetchHandler);
      }
    } catch (e) {
      console.warn('[AdBlock] Fetch unhook failed (expected on older engines):', e.message);
    } finally {
      isFetchHooked = false;
    }
  }

  // 2. Unhook XMLHttpRequest
  if (isXHRHooked) {
    try {
      if (originalXHROpen && originalXHRSend) {
        window.XMLHttpRequest.prototype.open = originalXHROpen;
        window.XMLHttpRequest.prototype.send = originalXHRSend;
        originalXHROpen = null;
        originalXHRSend = null;
      }
    } catch (e) {
      console.error('[AdBlock] Failed to remove XHR network blockers:', e);
    } finally {
      isXHRHooked = false;
      if (DEBUG) console.info('[AdBlock] Telemetry network hooks disabled');
    }
  }
}

function logSchemaMiss(data, textLength) {
  try {
    let info = '';
    const keys = Array.isArray(data) ? '[Array]' : Object.keys(data);
    if (textLength < 1000) {
      info = `Content: ${JSON.stringify(data)}`;
    } else {
      info = `Top-Level Keys: [${Array.isArray(keys) ? keys.join(', ') : 'Array'}]`;
    }
    debugLog(`MISS (Fallback used) | Size: ${textLength} | ${info}`);
  } catch {
    debugLog(`MISS (Fallback used) | Size: ${textLength} | Error analyzing structure`);
  }
}

// Four functions on purpose. hookedParse runs on every JSON.parse the app
// makes and holds only the cheap guards; the try/catch sits alone in
// filterSafely, since the engine of webOS 3 (V8 3.28) does not optimise a
// function that contains one; filterResponse is the work itself. (From
// mirijanristic's fork.)

function hookedParse(text, reviver) {
  // Guards ordered cheapest-first. YouTube parses thousands of small blobs
  // (localStorage reads, config, per-tile metadata) and none of them can be a
  // filterable response, so those calls must cost as close to nothing as
  // possible on top of the native parse.
  if (!isHooked || !anyFilterEnabled || typeof text !== 'string' || text.length < 500) {
    return origParse.call(this, text, reviver);
  }
  return parseAndFilter(this, text, reviver);
}

function parseAndFilter(self, text, reviver) {
  // Blanked in the text, in one native pass, before the parse.
  if (cfgFlags.enableTrackingBlock) text = stripTrackingParams(text);

  const data = origParse.call(self, text, reviver);
  if (!data || typeof data !== 'object') return data;
  if (
    data.responseContext === undefined &&
    data.playerResponse === undefined &&
    data.continuationContents === undefined
  )
    return data;
  if (data.botguardData) return data;

  filterSafely(data, text);
  return data;
}

function filterSafely(data, text) {
  try {
    filterResponse(data, text);
  } catch (e) {
    if (DEBUG) console.error('[AdBlock] Error during filtering:', e);
  }
}

function filterResponse(data, text) {
  const responseType = detectResponseType(data);
  // Before the Shorts guard below: a browse response parsed while a Short
  // plays still wants its rows ahead.
  if (cfgFlags.loadRowsAhead) raiseRowsAhead(data, responseType);
  if (!anyResponseFilterEnabled) return;

  // The legacy emoji fix walks every item it filters; a text without an
  // emoji in it is filtered with the fix left out (one native scan of the
  // text instead). (From mirijanristic's fork.)
  const flags = cfgFlags.enableLegacyEmojiFix && !mayNeedEmojiWork(text) ? cfgFlagsNoEmoji : cfgFlags;

  if (isShortsPage() && responseType && IGNORE_ON_SHORTS.has(responseType)) {
    // The Shorts player gets these unfiltered, but their titles, comments
    // and descriptions still need the emoji wrapped on webOS 3 and 4, or
    // they render as boxes there (NicholasBly/youtube-webos#74).
    if (flags.enableLegacyEmojiFix) {
      applySchemaFilters(data, responseType, cfgFlagsEmojiOnly);
      if (data.frameworkUpdates) walkAndProcess(data.frameworkUpdates, 20);
    }
    return;
  }

  if (FORCE_FALLBACK) {
    if (DEBUG) debugLog('FORCE_FALLBACK active. Using fallback filters.');
    if (!Array.isArray(data)) applyFallbackFilters(data, flags);
  } else if (responseType && SCHEMA_REGISTRY.paths[responseType]) {
    if (DEBUG) debugLog(`Schema Match: [${responseType}]`);
    applySchemaFilters(data, responseType, flags);
  } else if (responseType === 'ACTION' || responseType === 'PLAYER') {
    if (DEBUG) debugLog(`Schema Match: [${responseType}]`);
    applySchemaFilters(data, responseType, flags);
  } else if (text.length > 10000 && !Array.isArray(data)) {
    if (DEBUG) logSchemaMiss(data, text.length);
    applyFallbackFilters(data, flags);
  } else if ((flags.removeGlobalShorts || flags.removeLiveVideos) && !Array.isArray(data)) {
    // The guide arrives in its own small response, which matches no content
    // schema and is under the fallback's size threshold - so without this it
    // was never looked at. removeBlockedNavEntries() early-returns when the
    // settings are off, and its search is depth-bounded.
    removeBlockedNavEntries(data, flags.removeGlobalShorts, flags.removeLiveVideos);
  }

  // Thumbnail rewriting runs after filtering, so shelves and ad slots that
  // were just removed are never rewritten, and it reuses the responseType
  // already resolved above instead of detecting the shape a second time.
  if (cfgFlags.upgradeThumbnails) upgradeResponseThumbnails(data, responseType);

  // Emoji on frameworkUpdates as a small targeted walk at depth 20.
  if (flags.enableLegacyEmojiFix && data.frameworkUpdates) {
    walkAndProcess(data.frameworkUpdates, 20);
  }
}

function detectResponseType(data) {
  const signatures = SCHEMA_REGISTRY.typeSignatures;
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    if (sig.excludePath && getByPath(data, sig.excludePath) !== undefined) continue;
    if (getByPath(data, sig.detectionPath) !== undefined) {
      if (sig.matchFn && !sig.matchFn(data)) continue;
      return sig.type;
    }
  }
  return null;
}

function applySchemaFilters(data, responseType, config) {
  removeBlockedNavEntries(data, config.removeGlobalShorts, config.removeLiveVideos);
  const schema = SCHEMA_REGISTRY.paths[responseType];
  switch (responseType) {
    case 'SHORTS_SEQUENCE':
        if (config.enableAdBlock && schema?.listPath) {
            const entries = getByPath(data, schema.listPath);
            if (Array.isArray(entries)) {
                const oldLen = entries.length;
                filterItemsOptimized(entries, config);
                if (DEBUG && entries.length !== oldLen) debugLog(`SHORTS_SEQUENCE: Removed ${oldLen - entries.length} items`);
            }
        }
        break;
    case 'HOME_BROWSE':
      if (schema?.mainContent) {
        let contents = getByPath(data, schema.mainContent);
        if (!contents) {
            contents = findObjects(data, ['sectionListRenderer'], 8).sectionListRenderer?.contents;
            if (DEBUG && contents) debugLog(`${responseType}: Using fallback search`);
        }
        if (Array.isArray(contents)) processSectionListOptimized(contents, config, responseType);
      }
      break;
    case 'BROWSE_TABS':
      if (schema?.tabsPath) {
        const tabs = getByPath(data, schema.tabsPath);
        if (Array.isArray(tabs)) {
          for (let i = 0; i < tabs.length; i++) {
            const gridContents = tabs[i].tabRenderer?.content?.sectionListRenderer?.contents || tabs[i].tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
            if (Array.isArray(gridContents)) processSectionListOptimized(gridContents, config, 'BROWSE_TAB_GENERIC');
          }
        }
      }
      break;
    case 'SEARCH':
      if (schema?.mainContent) {
        let contents = getByPath(data, schema.mainContent);
        if (!contents) {
            contents = findObjects(data, ['sectionListRenderer'], 8).sectionListRenderer?.contents;
            if (DEBUG && contents) debugLog(`${responseType}: Using fallback search`);
        }
        if (Array.isArray(contents)) processSectionListOptimized(contents, config, responseType);
      }
      break;
    case 'CONTINUATION':
      filterContinuation(data, config);
      break;
    case 'ACTION':
      filterActions(data, config);
      break;
    case 'PLAYER':
    case 'NEXT':
      if (config.enableAdBlock) {
        if (responseType === 'PLAYER') removePlayerAdsOptimized(data);
        removePaidPromotion(data);
        let overlay = getByPath(data, schema?.overlayPath);
        if (!overlay) {
            overlay = findObjects(data, ['playerOverlayRenderer'], 8).playerOverlayRenderer;
            if (DEBUG && overlay) debugLog(`${responseType}: Path failed, found overlay via fallback`);
        }
        if (overlay?.timelyActionRenderers) {
            delete overlay.timelyActionRenderers;
            if (DEBUG) debugLog(`${responseType}: Removed timelyActionRenderers (QR Code)`);
        }
      }
	  if (config.hideEndcards) {
          removeEndcardsOptimized(data);
      }
      if (config.removeYouThere) removeYouThere(data);
      if (config.disableAutoCaptions && responseType === 'PLAYER') disableAutoCaptions(data);
      if (config.hideGuestPrompts) {
         let pivotContents = getByPath(data, schema?.pivotPath);
         if (!pivotContents) {
            pivotContents = findObjects(data, ['pivot'], 8).pivot?.sectionListRenderer?.contents;
            if (DEBUG && pivotContents) debugLog(`${responseType}: Found pivot via fallback search`);
         }
         if (Array.isArray(pivotContents)) processSectionListOptimized(pivotContents, config, `${responseType} (Pivot)`);
      }
      if (config.enableLegacyEmojiFix) {
        if (responseType === 'NEXT') {
          findAndProcessText(getByPath(data, ['contents', 'singleColumnWatchNextResults']));
          findAndProcessText(getByPath(data, ['playerOverlays']));
          findAndProcessText(getByPath(data, ['engagementPanels']), 20); 
        } else if (responseType === 'PLAYER') {
          findAndProcessText(getByPath(data, ['videoDetails']));
        }
      }
      break;
  }

  // A response is typed by its main content, but can carry a continuation or
  // received actions beside it (a browse or watch-next page with its first
  // continuation inlined); those get their filters too, or their ads and
  // Shorts got through.
  if (responseType !== 'CONTINUATION' && data.continuationContents) {
    filterContinuation(data, config);
  }
  if (responseType !== 'ACTION' && (data.onResponseReceivedActions || data.onResponseReceivedEndpoints)) {
    filterActions(data, config);
  }
}

function filterListLogged(items, config, label, skipEmoji) {
  if (!Array.isArray(items)) return;
  const oldLen = items.length;
  filterItemsOptimized(items, config, skipEmoji);
  if (DEBUG && oldLen !== items.length) debugLog(`${label}: Removed ${oldLen - items.length} items`);
}

function filterContinuation(data, config) {
  const schema = SCHEMA_REGISTRY.paths.CONTINUATION;
  // The whole continuation is walked for emoji at the end, once, so the
  // filters below skip their own per-item walk.
  const walksAfter = !!config.enableLegacyEmojiFix;
  processSectionListOptimized(getByPath(data, schema.sectionPath), config, 'CONTINUATION (Section)', walksAfter);
  processSectionListOptimized(getByPath(data, schema.tvSurfacePath), config, 'CONTINUATION (TV Surface)', walksAfter);
  filterListLogged(getByPath(data, schema.gridPath), config, 'CONTINUATION (Grid)', walksAfter);
  filterListLogged(getByPath(data, schema.horizontalPath), config, 'CONTINUATION (Horizontal)', walksAfter);
  if (walksAfter && data.continuationContents) findAndProcessText(data.continuationContents, 20);
}

// The received actions and the received endpoints: a body can carry both, and
// only the first of the two used to be looked at.
function filterActions(data, config) {
  const walksAfter = !!config.enableLegacyEmojiFix;
  const lists = [data.onResponseReceivedActions, data.onResponseReceivedEndpoints];
  for (let i = 0; i < lists.length; i++) {
    if (!Array.isArray(lists[i])) continue;
    processActions(lists[i], config, walksAfter);
    if (walksAfter) findAndProcessText(lists[i], 20);
  }
}

/**
 * Remove blocked entries (Shorts, Live) from the left-hand guide.
 *
 * Identified by endpoint first - browseId FEshorts / a reelWatchEndpoint for Shorts, 
 * or FEtopics_live for Live - and only then by title text.
 */
function isNavEntryBlocked(entry, removeGlobalShorts, removeLiveVideos) {
  if (!entry || typeof entry !== 'object') return false;

  const renderer =
    entry.guideEntryRenderer ||
    entry.tabRenderer ||
    entry.pivotBarItemRenderer ||
    entry;

  const endpoint = renderer.navigationEndpoint || renderer.endpoint || renderer.onSelectCommand;
  if (endpoint) {
    if (removeGlobalShorts && endpoint.reelWatchEndpoint) return true;
    const browseId = endpoint.browseEndpoint?.browseId;
    if (removeGlobalShorts && (browseId === 'FEshorts' || browseId === 'FEshorts_tv')) return true;
    if (removeLiveVideos && browseId === 'FEtopics_live') return true;
  }

  if (removeGlobalShorts) {
    const title =
      renderer.title?.simpleText ||
      renderer.title?.runs?.[0]?.text ||
      renderer.tabIdentifier ||
      (typeof renderer.title === 'string' ? renderer.title : undefined);
    return title === UI_STRINGS.SHORTS_TITLE;
  }
  return false;
}

function removeBlockedNavEntries(data, removeGlobalShorts, removeLiveVideos) {
  if ((!removeGlobalShorts && !removeLiveVideos) || !data || typeof data !== 'object') return;

  const found = findObjects(
    data,
    ['tvSecondaryNavRenderer', 'guideRenderer', 'pivotBarRenderer', 'items', 'tabs', 'sections'],
    8
  );

  const lists = [
    found.tvSecondaryNavRenderer?.sections,
    found.guideRenderer?.items,
    found.pivotBarRenderer?.items,
    found.tabs,
    found.sections,
    found.items
  ];

  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    if (!Array.isArray(list)) continue;

    for (let j = 0; j < list.length; j++) {
      const inner =
        list[j]?.tvSecondaryNavSectionRenderer?.tabs ||
        list[j]?.guideSectionRenderer?.items;
      if (Array.isArray(inner)) {
        const before = inner.length;
        let w = 0;
        for (let k = 0; k < inner.length; k++) {
          if (!isNavEntryBlocked(inner[k], removeGlobalShorts, removeLiveVideos)) inner[w++] = inner[k];
        }
        inner.length = w;
        if (DEBUG && before !== w) debugLog(`Guide: removed ${before - w} blocked entr(ies)`);
      }
    }

    const before = list.length;
    let w = 0;
    for (let j = 0; j < list.length; j++) {
      if (!isNavEntryBlocked(list[j], removeGlobalShorts, removeLiveVideos)) list[w++] = list[j];
    }
    list.length = w;
    if (DEBUG && before !== w) debugLog(`Guide: removed ${before - w} blocked entr(ies)`);
  }
}

function applyFallbackFilters(data, config) {
  removeBlockedNavEntries(data, config.removeGlobalShorts, config.removeLiveVideos);
  if (config.enableAdBlock) removePlayerAdsOptimized(data);
  if (config.hideEndcards) removeEndcardsOptimized(data);
  const needles = ['playerOverlayRenderer', 'pivot', 'sectionListRenderer', 'gridRenderer', 'gridContinuation', 'sectionListContinuation', 'entries'];
  const found = findObjects(data, needles, 10);
  
  if (config.enableAdBlock && found.playerOverlayRenderer?.timelyActionRenderers) {
      delete found.playerOverlayRenderer.timelyActionRenderers;
      if (DEBUG) debugLog('FALLBACK: Removed timelyActionRenderers');
  }
  if (Array.isArray(found.pivot?.sectionListRenderer?.contents)) processSectionListOptimized(found.pivot.sectionListRenderer.contents, config, 'Fallback Pivot');
  if (Array.isArray(found.sectionListRenderer?.contents)) processSectionListOptimized(found.sectionListRenderer.contents, config, 'Fallback sectionListRenderer');
  if (Array.isArray(found.sectionListContinuation?.contents)) processSectionListOptimized(found.sectionListContinuation.contents, config, 'Fallback sectionListContinuation');
  
  if (found.gridRenderer?.items) {
      const oldLen = found.gridRenderer.items.length;
      filterItemsOptimized(found.gridRenderer.items, config);
      if (DEBUG && oldLen !== found.gridRenderer.items.length) debugLog(`FALLBACK (Grid): Removed ${oldLen - found.gridRenderer.items.length} items`);
  }
  if (found.gridContinuation?.items) {
      const oldLen = found.gridContinuation.items.length;
      filterItemsOptimized(found.gridContinuation.items, config);
      if (DEBUG && oldLen !== found.gridContinuation.items.length) debugLog(`FALLBACK (Grid Continuation): Removed ${oldLen - found.gridContinuation.items.length} items`);
  }
  if (Array.isArray(found.entries)) {
      const oldLen = found.entries.length;
      filterItemsOptimized(found.entries, config);
      if (DEBUG && oldLen !== found.entries.length) debugLog(`FALLBACK (Entries): Removed ${oldLen - found.entries.length} items`);
  }
  
  processActions(data.onResponseReceivedActions, config);
  processActions(data.onResponseReceivedEndpoints, config);
}

function processActions(actions, config, skipEmoji) {
  if (!Array.isArray(actions)) return;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;
    if (action.reloadContinuationItemsCommand?.continuationItems) {
      filterItemsOptimized(action.reloadContinuationItemsCommand.continuationItems, config, skipEmoji);
    }
    if (action.appendContinuationItemsAction?.continuationItems) {
      filterItemsOptimized(action.appendContinuationItemsAction.continuationItems, config, skipEmoji);
    }
  }
}

function getShelfTitleOptimized(shelf) {
  if (!shelf) return '';
  return shelf.title?.runs?.[0]?.text || shelf.title?.simpleText || shelf.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title?.runs?.[0]?.text || '';
}

/**
 * Does this item carry one of the wanted badges (BADGE_* bits): a live stream,
 * an upcoming stream or premiere, a members-only video?
 *
 * The live badge lives at, from an item in a shelf's item list:
 *   lockupViewModel.contentImage.thumbnailViewModel
 *     .overlays[].thumbnailBottomOverlayViewModel
 *     .badges[].thumbnailBadgeViewModel.badgeStyle
 *
 * Both arrays are searched rather than indexed at [0]: a thumbnail carries
 * several overlays (duration, progress, badges) and their order is not
 * guaranteed, so hardcoding the first entry would miss the badge whenever
 * anything else is attached to the thumbnail.
 *
 * The older tileRenderer shape is kept as a fallback so this keeps working if
 * the viewModel schema is swapped out again: its time-status overlay says
 * LIVE or UPCOMING, and its metadata lines carry the badges (members only,
 * upcoming) as metadataBadgeRenderer styles. Only the style enums are read,
 * never the badge text, so this works in every language, and a video without
 * one of them is never touched.
 */
function hasWantedBadge(item, want) {
  if (!want || !item) return false;

  const lockup = item.lockupViewModel;
  if (lockup) {
    const overlays = lockup.contentImage?.thumbnailViewModel?.overlays;
    if (Array.isArray(overlays)) {
      for (let i = 0; i < overlays.length; i++) {
        const overlay = overlays[i];
        if (!overlay) continue;
        if (hasWantedThumbnailBadge(overlay.thumbnailBottomOverlayViewModel?.badges, want)) return true;
        if (hasWantedThumbnailBadge(overlay.thumbnailOverlayBadgeViewModel?.thumbnailBadges, want)) return true;
      }
    }
    if (want & BADGE_MEMBERS) {
      const rows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
      if (Array.isArray(rows)) {
        for (let i = 0; i < rows.length; i++) {
          const badges = rows[i]?.badges;
          if (!Array.isArray(badges)) continue;
          for (let b = 0; b < badges.length; b++) {
            if (isMembersStyle(badges[b]?.badgeViewModel?.badgeStyle)) return true;
          }
        }
      }
    }
  }

  const tile = item.tileRenderer;
  if (tile) {
    if ((want & BADGE_LIVE) && tile.contentType === YT_CONSTANTS.CONTENT_TYPE_LIVE) return true;
    const timeStatus = tile.header?.tileHeaderRenderer?.thumbnailOverlays;
    if (Array.isArray(timeStatus)) {
      for (let i = 0; i < timeStatus.length; i++) {
        const style = timeStatus[i]?.thumbnailOverlayTimeStatusRenderer?.style;
        if (!style) continue;
        if ((want & BADGE_LIVE) && (style === 'LIVE' || style === 'THUMBNAIL_OVERLAY_TIME_STATUS_RENDERER_STYLE_LIVE')) return true;
        if ((want & BADGE_UPCOMING) && (style === 'UPCOMING' || style === 'THUMBNAIL_OVERLAY_TIME_STATUS_RENDERER_STYLE_UPCOMING')) return true;
      }
    }
    if (want & (BADGE_UPCOMING | BADGE_MEMBERS)) {
      const lines = tile.metadata?.tileMetadataRenderer?.lines;
      if (Array.isArray(lines)) {
        for (let i = 0; i < lines.length; i++) {
          const lineItems = lines[i]?.lineRenderer?.items;
          if (!Array.isArray(lineItems)) continue;
          for (let j = 0; j < lineItems.length; j++) {
            if (isWantedMetadataBadge(lineItems[j]?.lineItemRenderer?.badge?.metadataBadgeRenderer?.style, want)) return true;
          }
        }
      }
    }
    if ((want & BADGE_UPCOMING) && tile.upcomingEventData) return true;
  }

  // The video renderers some surfaces (watch-next, search) still send.
  const video = item.videoRenderer || item.gridVideoRenderer || item.compactVideoRenderer;
  if (video) {
    if ((want & BADGE_UPCOMING) && video.upcomingEventData) return true;
    const badges = video.badges;
    if ((want & (BADGE_UPCOMING | BADGE_MEMBERS)) && Array.isArray(badges)) {
      for (let b = 0; b < badges.length; b++) {
        if (isWantedMetadataBadge(badges[b]?.metadataBadgeRenderer?.style, want)) return true;
      }
    }
  }

  return false;
}

function hasWantedThumbnailBadge(badges, want) {
  if (!Array.isArray(badges)) return false;
  for (let b = 0; b < badges.length; b++) {
    const style = badges[b]?.thumbnailBadgeViewModel?.badgeStyle;
    if (!style) continue;
    if ((want & BADGE_LIVE) && style === YT_CONSTANTS.BADGE_STYLE_LIVE) return true;
    if ((want & BADGE_UPCOMING) && style === YT_CONSTANTS.BADGE_STYLE_UPCOMING) return true;
    if ((want & BADGE_MEMBERS) && isMembersStyle(style)) return true;
  }
  return false;
}

function isWantedMetadataBadge(style, want) {
  if (!style) return false;
  if ((want & BADGE_MEMBERS) && isMembersStyle(style)) return true;
  return !!(want & BADGE_UPCOMING) && style === 'UPCOMING';
}

// BADGE_STYLE_TYPE_MEMBERS_ONLY on a metadata badge, a *_MEMBERS_ONLY style
// on the view-model badges.
function isMembersStyle(style) {
  return typeof style === 'string' && style.indexOf('MEMBERS_ONLY') !== -1;
}

function isReelAd(item) {
  const endpoint = item.command?.reelWatchEndpoint;
  return endpoint?.adClientParams?.isAd === true || endpoint?.adClientParams?.isAd === 'true' || endpoint?.videoType === YT_CONSTANTS.VIDEO_TYPE_REEL_AD;
}

function hasAdRenderer(item) {
  return !!(item.adSlotRenderer || item.tvMastheadRenderer);
}

function isGuestPrompt(item) {
  return !!(item.feedNudgeRenderer || item.alertWithActionsRenderer || item.gridButtonRenderer?.title?.runs?.[0]?.text === UI_STRINGS.GUEST_PROMPT_TEXT);
}

function isShortsItem(item) {
  const tile = item.tileRenderer;
  if (tile && (tile.style === YT_CONSTANTS.TILE_STYLE_SHORTS || tile.contentType === YT_CONSTANTS.CONTENT_TYPE_SHORTS || tile.onSelectCommand?.reelWatchEndpoint)) return true;
  return !!(item.reelItemRenderer || item.contentType === YT_CONSTANTS.CONTENT_TYPE_SHORTS || item.onSelectCommand?.reelWatchEndpoint);
}

/**
 * Whether an item (a tile, a lockup, a nudge) goes under the flags: the one
 * rule for items in a shelf, in a grid or continuation, and bare in a section
 * list. Before it was shared, a bare Shorts tile or live lockup in search
 * results was only checked for ad renderers and got through.
 */
function shouldDropItem(item, config) {
  if (!item || typeof item !== 'object') return false;
  if (config.enableAdBlock && (hasAdRenderer(item) || isReelAd(item))) return true;
  if (config.hideGuestPrompts && isGuestPrompt(item)) return true;
  if (config.removeGlobalShorts && isShortsItem(item)) return true;
  return hasWantedBadge(item, config.badgeMask);
}

/** Whether a whole shelf goes: the Shorts shelf by type or title, the titled shelves. */
function shouldDropShelf(shelf, config) {
  const { removeGlobalShorts, removeTopLiveGames, removeMostRelevant } = config;
  if (removeGlobalShorts && shelf.tvhtml5ShelfRendererType === YT_CONSTANTS.SHELF_TYPE_SHORTS) return true;
  if (!removeGlobalShorts && !removeTopLiveGames && !removeMostRelevant) return false;
  const title = getShelfTitleOptimized(shelf);
  if (removeGlobalShorts && title === UI_STRINGS.SHORTS_TITLE) return true;
  if (!title || (!removeTopLiveGames && !removeMostRelevant)) return false;
  // Once per shelf, and only with one of the two filters on.
  const key = title.trim().toLowerCase();
  return (removeTopLiveGames && SHELF_TITLES.TOP_LIVE_GAMES.has(key)) ||
    (removeMostRelevant && SHELF_TITLES.MOST_RELEVANT.has(key));
}

// Counts carried through one section's item lists: the items they had and the
// items left once filtered. Reused across calls rather than allocated per shelf.
const listTally = { had: 0, left: 0 };

/**
 * Filters every item list of a section in place and returns how many lists it
 * had: a shelf's horizontal list, grid and expanded list
 * (expandedShelfContentsRenderer, never filtered before), or the grid or
 * horizontal list a section list carries bare (search results). The emoji
 * walk is left to the caller, which walks the whole section.
 */
function filterSectionItemLists(section, config) {
  listTally.had = 0;
  listTally.left = 0;
  let lists = 0;
  const shelf = section.shelfRenderer;
  if (shelf) {
    const content = shelf.content;
    if (!content) return 0;
    lists += filterTalliedList(content.horizontalListRenderer?.items, config);
    lists += filterTalliedList(content.gridRenderer?.items, config);
    lists += filterTalliedList(content.expandedShelfContentsRenderer?.items, config);
    return lists;
  }
  lists += filterTalliedList(section.gridRenderer?.items, config);
  lists += filterTalliedList(section.horizontalListRenderer?.items, config);
  return lists;
}

function filterTalliedList(items, config) {
  if (!Array.isArray(items)) return 0;
  listTally.had += items.length;
  filterItemsOptimized(items, config, true);
  listTally.left += items.length;
  return 1;
}

// skipEmoji: see filterItemsOptimized below.
function processSectionListOptimized(contents, config, contextName = '', skipEmoji = false) {
  if (!Array.isArray(contents) || contents.length === 0) return;
  const enableLegacyEmojiFix = skipEmoji ? false : config.enableLegacyEmojiFix;
  // With nothing to check and no emoji to wrap the pass would walk every
  // shelf only to keep everything.
  if (!enableLegacyEmojiFix && !anyItemCheck(config)) return;
  const initialCount = contents.length;
  let writeIdx = 0;

  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    let keepItem = true;

    if (!item || typeof item !== 'object') {
      // Kept as sent.
    } else if (item.shelfRenderer) {
      const shelf = item.shelfRenderer;
      if (shouldDropShelf(shelf, config)) keepItem = false;
      // A shelf we emptied has to go with its items. Left in place it still
      // has a title and a content box, so the app renders the header plus a
      // <ytlr-ghost-surface> of skeleton tiles and waits forever for content
      // that was already removed - the "Live now" row of grey boxes.
      // Only a shelf the filter emptied: one whose content uses some other
      // renderer was never filtered here, and one that arrived with an empty
      // list (filled later by its own continuation) was not emptied here.
      else if (filterSectionItemLists(item, config) > 0 && listTally.had > 0 && listTally.left === 0) {
        keepItem = false;
        if (DEBUG) debugLog(`${contextName ? contextName + ': ' : ''}Dropped emptied shelf "${getShelfTitleOptimized(shelf)}"`);
      }
    } else if (filterSectionItemLists(item, config) === 0) {
      // A bare grid or horizontal list keeps its (filtered) place, and with
      // it its continuation; anything else is an item of its own.
      if (shouldDropItem(item, config)) keepItem = false;
    }

    if (keepItem) {
      if (enableLegacyEmojiFix) findAndProcessText(item, 20);
      if (writeIdx !== i) contents[writeIdx] = item;
      writeIdx++;
    }
  }
  contents.length = writeIdx;

  if (DEBUG) {
    const removed = initialCount - writeIdx;
    if (removed > 0) debugLog(`${contextName ? contextName + ': ' : ''}Filtered ${removed} top-level items from ${initialCount}`);
  }
}

// Whether any per-item or per-shelf check is on at all.
// Every one of them counts only with Ad Blocking on (recomputeFilterFlags).
function anyItemCheck(config) {
  return config.enableAdBlock;
}

// skipEmoji: set when the caller is about to run its own findAndProcessText
// over an ancestor of these items. Without it every tile in a shelf was walked
// twice - once here and once again as part of the shelf's own walk - which on a
// 150 KB browse response meant ~10k redundant node visits per parse.
function filterItemsOptimized(items, config, skipEmoji) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const enableLegacyEmojiFix = skipEmoji ? false : config.enableLegacyEmojiFix;
  const anyCheck = anyItemCheck(config);
  if (!anyCheck && !enableLegacyEmojiFix) return items;

  let writeIdx = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (anyCheck && shouldDropItem(item, config)) continue;
    if (enableLegacyEmojiFix) findAndProcessText(item, 20);
    if (writeIdx !== i) items[writeIdx] = item;
    writeIdx++;
  }
  items.length = writeIdx;
  return items;
}

function getByPath(obj, parts) {
  if (!parts) return undefined;
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current == null) return undefined;
    current = current[parts[i]];
  }
  return current;
}

function clearArrayIfExists(obj, key) {
  if (obj[key]?.length) { obj[key].length = 0; return 1; }
  return 0;
}

function removeEndcardsOptimized(data) {
  let cleared = 0;
  if (data.endscreen) {
      delete data.endscreen;
      cleared++;
  }
  if (data.playerResponse && data.playerResponse.endscreen) {
      delete data.playerResponse.endscreen;
      cleared++;
  }
  if (DEBUG && cleared > 0) debugLog('Cleaned Player Endcards');
}

function removePlayerAdsOptimized(data) {
  let cleared = 0;
  cleared += clearArrayIfExists(data, 'adPlacements'); 
  cleared += clearArrayIfExists(data, 'playerAds'); 
  cleared += clearArrayIfExists(data, 'adSlots');

  // Strip attestation and telemetry mismatches
  if (data.attestation) {
      delete data.attestation;
      cleared++;
      if (DEBUG) debugLog('Cleaned Player Attestation Challenge');
  }
  if (data.adBreakHeartbeatParams) {
      delete data.adBreakHeartbeatParams;
      cleared++;
      if (DEBUG) debugLog('Cleaned Ad Break Heartbeat');
  }
  if (data.playerResponse) {
    cleared += clearArrayIfExists(data.playerResponse, 'adPlacements'); cleared += clearArrayIfExists(data.playerResponse, 'playerAds'); cleared += clearArrayIfExists(data.playerResponse, 'adSlots');
  }
  if (DEBUG && cleared > 0) debugLog('Cleaned Player Ads/Placements');
}

/**
 * "Are you still watching?": the player and watch-next responses carry it as a
 * youThereRenderer in their messages, and the app pauses the video to show it
 * after a while without key presses. Without the message it never asks.
 * (From MickLesk's fork; webosbrew/youtube-webos#86, #250.)
 */
function dropYouThereMessages(holder) {
  const messages = holder && holder.messages;
  if (!Array.isArray(messages)) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].youThereRenderer) messages.splice(i, 1);
  }
}

function removeYouThere(data) {
  dropYouThereMessages(data);
  dropYouThereMessages(data.playerResponse);
}

/**
 * The "Includes paid promotion" banner over the start of a video. The shopping
 * and merch QR codes are timelyActionRenderers, removed with the overlay above.
 * (From MickLesk's fork; webosbrew/youtube-webos#340.)
 */
function removePaidPromotion(data) {
  if (data.paidContentOverlay) delete data.paidContentOverlay;
  if (data.playerResponse && data.playerResponse.paidContentOverlay) delete data.playerResponse.paidContentOverlay;
}

/**
 * Subtitles that start on by themselves: the player response names a default
 * track and an initial state per audio track. Without the default and with the
 * state set to off, a video starts without subtitles; turning them on by hand,
 * and Turn On Translated Subtitles Automatically, still work.
 * (From MickLesk's fork; webosbrew/youtube-webos#57.)
 */
function captionsOff(holder) {
  const renderer = holder && holder.captions && holder.captions.playerCaptionsTracklistRenderer;
  const tracks = renderer && renderer.audioTracks;
  if (!Array.isArray(tracks)) return;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (!track || typeof track !== 'object') continue;
    delete track.defaultCaptionTrackIndex;
    track.captionsInitialState = 'CAPTIONS_INITIAL_STATE_OFF_RECOMMENDED';
  }
}

function disableAutoCaptions(data) {
  captionsOff(data);
  captionsOff(data.playerResponse);
}

function findObjects(haystack, needlesArray, maxDepth = 10) {
  if (!haystack || typeof haystack !== 'object' || maxDepth <= 0 || !needlesArray.length) return {};
  const results = {};
  let foundCount = 0;
  const targetCount = needlesArray.length;
  // Flat queue to reduce GC pressure: [obj, depth, obj, depth, ...]
  const queue = [haystack, 0];
  let idx = 0;

  while (idx < queue.length && foundCount < targetCount) {
    const currentObj = queue[idx++];
    const currentDepth = queue[idx++];
    
    if (currentDepth > maxDepth) continue;

    for (let i = 0; i < targetCount; i++) {
      const needle = needlesArray[i];
      if (!results[needle] && currentObj[needle] !== undefined) {
        results[needle] = currentObj[needle];
        foundCount++;
      }
    }
    if (foundCount === targetCount) break;

    const nextDepth = currentDepth + 1;
    for (const k in currentObj) {
      const val = currentObj[k];
      if (val && typeof val === 'object') {
        queue.push(val, nextDepth);
      }
    }
  }
  return results;
}

/**
 * Is the JSON.parse hook needed at all?
 *
 * It carries independent things: the response filters (ads, Shorts, guest
 * prompts, trackingParams - all of them Ad Blocking's), the endcards and the
 * legacy emoji rewrite. Ad Blocking being off must not take the emoji fix down
 * with it - on webOS 3 and 4 that is what stops titles rendering as tofu
 * boxes, and it has its own setting. Load Rows Ahead is on the same hook.
 */
export function parseHookRequired() {
  return !!(
    cfgSnapshot[CONFIG_KEYS.ADBLOCK] ||
    cfgSnapshot[CONFIG_KEYS.ENDCARDS] ||
    cfgEmojiFixEffective ||
    cfgSnapshot[CONFIG_KEYS.ROWS_AHEAD] ||
    cfgSnapshot[CONFIG_KEYS.NAG_SCREENS] ||
    cfgSnapshot[CONFIG_KEYS.AUTO_CAPTIONS] ||
    thumbnailHookRequired()
  );
}

/** Install or remove the JSON.parse hook to match the current settings. */
export function syncAdblockHook() {
  if (parseHookRequired()) initAdblock();
  else destroyAdblock();
}

export function initAdblock() {
  if (isHooked) return;
  if (DEBUG) console.info('[AdBlock] Initializing hybrid hook (Debug Mode: ' + DEBUG + ')');

  isHooked = true;
  if (isInstalled) return;

  origParse = JSON.parse;
  // Assigned directly rather than wrapped in a forwarding closure: that
  // wrapper added a call frame to every JSON.parse in the app.
  JSON.parse = hookedParse;
  isInstalled = true;
}

export function destroyAdblock() {
  if (!isHooked) return;
  if (DEBUG) console.info('[AdBlock] Restoring JSON.parse');
  
  isHooked = false;
  // Only unwind when nothing was stacked on top of us since.
  if (JSON.parse === hookedParse) {
    JSON.parse = origParse;
    isInstalled = false;
  }
}

initAdblock();

// Tracking Block is Ad Blocking's: its network hooks go in only with both on.
if (cfgFlags.enableTrackingBlock) {
  try {
    initTrackingBlock();
  } catch (e) {
    console.warn('[AdBlock] Early tracking block install failed:', e.message);
  }
}