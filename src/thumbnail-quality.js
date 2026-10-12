import { configRead, configAddChangeListener } from './config.js';

/**
 * Max Thumbnail Quality - rewrites thumbnail URLs in the parsed InnerTube
 * response, inside the JSON.parse hook adblock.js already owns, so the app is
 * only ever handed the high-quality URL and never fetches the 320x180 crop.
 *
 * JSON carries no failure signal the way a CSS background fallback does, and
 * maxresdefault does not exist for every video - YouTube answers a miss with a
 * small grey placeholder rather than a 404 (see PLACEHOLDER_MAX_BYTES). Hence
 * SPECULATIVE_MODE and the verification queue below.
 */

const DEBUG = false;

/**
 * How far above the "known to exist" line the module is willing to reach.
 * Driven by the `thumbnailQualityMode` setting; see thumbnailQualityModes in
 * config.js for the user-facing wording.
 *
 *   'safe'  - never emit a rung unless YouTube shipped it in this very response
 *             or a probe confirmed it. A tile can never land on a 404.
 *   'eager' - go straight to maxresdefault. Sharpest first paint; videos with
 *             no maxres need the correction path below to recover.
 *   'sd'    - 'eager' with the ladder stopped at sddefault (640x480): drawn
 *             from the first frame, so a tile is never swapped from a lower
 *             rung, at about a quarter of the decode work of maxres; the rare
 *             video with no sddefault is corrected to hqdefault.
 */
let qualityMode = configRead('thumbnailQualityMode');

/**
 * Emit WebP derivatives (~25-30% smaller) when the runtime can decode them.
 * Off by default: `vi_webp` coverage is per-video and all-or-nothing, nothing
 * in the response says which videos have it, and the no-webp population is
 * larger than the no-maxres one - so a miss costs a grey tile until the probe
 * lands. Worth it only if bandwidth matters more than first paint.
 */
const USE_WEBP = false;

/** Patch already-rendered tiles when verification finds something better. */
const ENABLE_LIVE_PROMOTION = true;

// Verification budget. Probes are HEAD requests fired from an idle callback,
// never from the parse itself, so these bound background work only.
const MAX_CONCURRENT_PROBES = 3;
// Hard ceiling on how many *distinct* videos are ever probed in one session.
const PROBE_ATTEMPT_LIMIT = 4000;
// Verification waits this long after the last response before running. A
// continuation lands on every scroll, so this doubles as a scroll detector
// without needing a scroll listener: while the user is moving, probes stay
// parked and the network is left to the app.
const PROBE_IDLE_DELAY = 1200;
// Probes allowed past the idle gate on each parse: the first videos that parse
// queued, which is the top of the response, which is what is on screen. Sized
// to about one visible row so a grey tile is corrected in one probe round
// rather than after the whole backlog drains.
const PROBE_URGENT_BURST = 4;
// Remote arrow keys are the other scroll signal, and the only one for content
// that is already loaded: moving across rows that are in memory fetches no
// continuation, so the parse-based gate above never sees it. For this long
// after the last arrow press neither probes nor promotions run: a promotion
// writes a new background-image, a decode and a texture upload in the middle
// of the row animation. Covers the remote's key-repeat interval with margin.
const NAV_PAUSE_MS = 350;
const NAV_KEY_CODES = { 37: true, 38: true, 39: true, 40: true };
// Probes for tiles the app currently has rendered. These skip the idle gate
// outright: an on-screen grey box is the whole reason verification exists, and
// a HEAD is a few hundred bytes against an image request it is racing.
const PROBE_VISIBLE_BURST = 6;
// The rendered set only changes as fast as the user can scroll, and sampling it
// costs a document-wide selector match, so it is reused inside this window.
const VISIBLE_SAMPLE_TTL = 250;
// Below this the queue drains in a round or two and ordering cannot matter.
const VISIBILITY_SORT_MIN_QUEUE = 6;
const PROBE_TIMEOUT = 5000;
// A missing derivative comes back 200 OK with a tiny grey placeholder body.
const PLACEHOLDER_MAX_BYTES = 5000;
// The same placeholder measured the other way: it decodes at 120x90.
const PLACEHOLDER_MAX_WIDTH = 120;

const PROMOTION_DEBOUNCE = 150;
// A correction whose tile is not on screen yet is retried rather than dropped.
const PROMOTION_RETRY_DELAY = 900;
const PROMOTION_MAX_ATTEMPTS = 5;
const CACHE_KEY = 'ytaf-thumb-quality';
// Which ladder the stored answers were measured against and the revision of
// what a stored answer may be, e.g. "5r2". Kept beside the cache rather than
// inside it so the cache format, and its one-split parse, stay as they were.
const CACHE_CAP_KEY = 'ytaf-thumb-quality-cap';
// 2: a timeout or a network error is no longer saved as a miss. Caches of an
// older revision may hold such misses, and are dropped once.
const CACHE_REVISION = 2;
const CACHE_LIMIT = 1200;
const CACHE_SAVE_DEBOUNCE = 4000;
const PENDING_LIMIT = 1500;

// Bounds the fallback scan used when no schema path matched. A browse response
// is a few thousand nodes; anything past this is not a shelf we know about.
// Depth 16 is not arbitrary: a tile container sits at depth 13
// (continuationContents > sectionListContinuation > contents > [] >
// shelfRenderer > content > horizontalListRenderer > items > [] > tileRenderer
// > header > tileHeaderRenderer > thumbnail), and the playlistPanelVideoWrapper
// shape adds two more. A cap of 12 made this scan unable to rescue the exact
// shapes it exists to rescue.
const SCAN_MAX_NODES = 6000;
const SCAN_MAX_DEPTH = 16;

// --- Quality ladder -------------------------------------------------------
// Ordered worst to best; the index is the rank stored in the cache.
//   hqdefault     480x360   4:3, letterboxed — exists for every video ever
//   sddefault     640x480   4:3, letterboxed
//   hq720        1280x720   16:9 native crop
//   maxresdefault 1280x720+ 16:9, only when the source was >= 720p
const QUALITY_NAMES = ['default', 'mqdefault', 'hqdefault', 'sddefault', 'hq720', 'maxresdefault'];
const RANK = { default: 0, mqdefault: 1, hqdefault: 2, sddefault: 3, hq720: 4, maxresdefault: 5 };

/** The rung that is always present. Nothing is ever emitted below this. */
const FLOOR_RANK = RANK.hqdefault;

/** Rungs generated for every video ever uploaded. Above this needs proof. */
const GUARANTEED_RANK = RANK.hqdefault;

/**
 * The best rung a mode emits or probes for. A single rung, deliberately:
 * maxresdefault and hq720 are both 1280x720 for the overwhelming majority of
 * uploads, so probing the second rung doubled verification traffic to
 * distinguish two files of identical size. A miss falls straight to the
 * guaranteed floor. In 'sd' mode the rung is sddefault instead.
 */
function usefulRankFor(mode) {
  return mode === 'sd' ? RANK.sddefault : RANK.maxresdefault;
}

/**
 * Whether the mode draws its rung before any proof and corrects a miss
 * afterwards ('sd', 'eager'), or draws only what is known to exist and waits
 * for the probe ('safe').
 */
function drawsUnproven(mode) {
  return mode === 'sd' || mode === 'eager';
}

/** The best rung the current mode emits or probes for. */
let usefulRank = usefulRankFor(qualityMode);

// A probe that learned nothing, unlike a miss: it ran out of time, or the
// network failed. A missing rung is not an error: i.ytimg.com answers it with a
// 404 (or a tiny grey placeholder), which a HEAD reads and an image loads.
const UNKNOWN = 'unknown';

// Anchored so it cannot match mid-string, and `\w+` on the basename so
// A/B-test variants (hqdefault_custom_2) are captured and then rejected by the
// RANK lookup rather than being rewritten to a name that has no custom-variant
// equivalent.
const THUMB_URL_RE = /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([\w-]+)\/(\w+)\.(?:jpg|jpeg|webp|png)/;
const THUMB_IN_CSS_RE = /i\.ytimg\.com\/vi(?:_webp)?\/([\w-]+)\//;

const DOM_SELECTOR = 'ytlr-thumbnail-details, ytlr-surface-page, thumbnail image';

// --- Runtime capability ---------------------------------------------------
// Must be synchronous: the first browse response can arrive before an async
// detection settles, and a mid-session flip would emit two URL families for the
// same video and halve the HTTP cache hit rate.
const webpSupported = (() => {
  if (!USE_WEBP) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch {
    return false;
  }
})();

// --- State ----------------------------------------------------------------
let enabled = !!configRead('upgradeThumbnails');

/** videoId -> verified rank. Survives navigation and restarts. */
const qualityCache = new Map();
/**
 * Cached entries a probe that learned nothing put there ('safe' only): the
 * floor for this session, left out of the saved cache so the next session asks
 * again.
 */
const unconfirmed = new Set();
/** Insertion-ordered probe backlog of videoIds. */
const probeQueue = new Set();
// The videos the current parse queued; deferProbes() makes them the latest
// parse and empties it.
const queuedByParse = [];
// The videos the latest parse queued: the only ones the urgent budget
// (PROBE_URGENT_BURST per parse) is spent on, so a parse never pays for the
// backlog of the ones before it.
const latestParse = new Set();
/**
 * Every videoId enqueued this session: one attempt each, answered or not. A
 * video the verification cache evicts is taken out, so it may be probed again
 * when it comes back.
 */
const probeAttempted = new Set();
const pendingPromotions = new Map();
const promotionAttempts = new Map();
/**
 * videoId -> the thumbnail entry objects we wrote an unverified URL into.
 *
 * These are the very objects the app holds: JSON.parse handed it the same
 * references, and a virtualised list reads `.url` off them when a tile finally
 * scrolls into view, not at parse time. Keeping them means a correction can be
 * written back into the app's own model, so a tile that has not rendered yet
 * never gets the chance to be grey. The DOM sweep only has to cover tiles that
 * were already on screen when the probe landed - which is the half the old
 * one-shot sweep could see, and it threw the other half away.
 */
const pendingEntries = new Map();
/** videoId -> highest rank already known good, so corrections cannot regress. */
const provenFloor = new Map();

let activeProbes = 0;
let saveTimer = null;
let promoteTimer = null;
let probePump = null;
let probeTimer = null;
// On a monotonic clock: a wall clock set back (the TV syncing its time) would
// otherwise stretch the idle gate by however far it jumped.
let lastParseAt = -Infinity;
let lastNavAt = -Infinity;
// Bumped when the verification cache is reset (a mode change across rungs). A
// probe in flight against the old ladder must not write its answer into the new.
let probeGeneration = 0;
let urgentLeft = 0;
let visibleBudget = 0;
let visibleSample = null;
let visibleSampleAt = 0;

const now =
  window.performance && typeof window.performance.now === 'function'
    ? () => window.performance.now()
    : () => Date.now();

const idle =
  typeof window.requestIdleCallback === 'function'
    ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
    : (cb) => setTimeout(cb, 32);

function debugLog(...args) {
  if (DEBUG) console.info('[ThumbQuality]', ...args);
}

/** Sets `key`, dropping the oldest entry at `limit`; returns the dropped key, or null. */
function capSet(map, key, value, limit) {
  let evicted = null;
  // Only a new key makes room: overwriting one must not cost another video.
  if (map.size >= limit && !map.has(key)) {
    evicted = map.keys().next().value;
    map.delete(evicted);
  }
  map.set(key, value);
  return evicted;
}

// --- Persistent cache -----------------------------------------------------
// Compact "id:rank,id:rank" rather than JSON: it parses with one split on
// startup and avoids the hooked JSON.stringify entirely.

/** What CACHE_CAP_KEY holds for the current ladder and revision. */
function capMarker() {
  return usefulRank + 'r' + CACHE_REVISION;
}

/** Forgets the stored answers and records the ladder the next ones are measured against. */
function dropStoredCache() {
  try {
    window.localStorage.removeItem(CACHE_KEY);
    window.localStorage.setItem(CACHE_CAP_KEY, capMarker());
  } catch {
    // Storage refused: the answers are still forgotten for this session.
  }
}

function loadCache() {
  try {
    // The cache is only valid against the ladder and the revision that wrote
    // it. Any other marker, or none (a build that saved timeouts as misses),
    // means every stored answer is suspect: drop it once and start over.
    if (window.localStorage.getItem(CACHE_CAP_KEY) !== capMarker()) {
      dropStoredCache();
      return;
    }
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parts = raw.split(',');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      const sep = entry.lastIndexOf(':');
      if (sep < 1) continue;
      const rank = +entry.slice(sep + 1);
      if (rank >= 0 && rank < QUALITY_NAMES.length) qualityCache.set(entry.slice(0, sep), rank);
    }
    debugLog(`loaded ${qualityCache.size} cached qualities`);
  } catch {
    // Private mode / quota / storage disabled — the cache is an optimisation.
  }
}

function saveCache() {
  saveTimer = null;
  try {
    const out = [];
    // Map iteration is insertion-ordered, so dropping from the front evicts the
    // oldest entries.
    let skip = qualityCache.size - CACHE_LIMIT;
    qualityCache.forEach((rank, id) => {
      if (skip-- > 0) return;
      if (!unconfirmed.has(id)) out.push(id + ':' + rank);
    });
    window.localStorage.setItem(CACHE_KEY, out.join(','));
    window.localStorage.setItem(CACHE_CAP_KEY, capMarker());
  } catch {
    // Ignore.
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveCache, CACHE_SAVE_DEBOUNCE);
}

// --- URL rewriting --------------------------------------------------------

/**
 * Build a thumbnail URL.
 *
 * `forceJpeg` exists because the floor is only a floor in the `/vi/` family.
 * `hqdefault.jpg` is generated for every video ever uploaded; `vi_webp`
 * coverage is not universal, and a video with no webp derivatives at all 404s
 * on `hqdefault.webp` just as it does on `maxresdefault.webp`. Emitting a webp
 * fallback for a webp miss is a fallback to the same failure, which is why
 * those tiles stayed grey permanently instead of recovering.
 */
function buildUrl(videoId, name, forceJpeg) {
  return webpSupported && !forceJpeg
    ? 'https://i.ytimg.com/vi_webp/' + videoId + '/' + name + '.webp'
    : 'https://i.ytimg.com/vi/' + videoId + '/' + name + '.jpg';
}


/**
 * Resolve one thumbnail URL to its upgraded form, or null to leave it alone.
 *
 * The emitted rung is the useful one (maxres) clamped to the safe one - the
 * ceiling of what is known to exist, from `proven` in this response or a cached
 * probe. When useful exceeds safe a probe is scheduled and the better rung
 * lands on a later parse, so the tile is correct meanwhile rather than grey.
 * Entry width/height are left alone; the app sizes tiles from them.
 */
function upgradeEntry(entry, proven) {
  const url = entry.url;
  // Cheap rejection first: almost every string in a response is not a URL.
  if (typeof url !== 'string' || url.charCodeAt(0) !== 104 /* h */) return null;
  if (url.indexOf('i.ytimg.com/vi') === -1) return null;

  const match = THUMB_URL_RE.exec(url);
  if (!match) return null;

  const videoId = match[1];
  const currentRank = RANK[match[2]];
  // Unknown basename: an A/B custom variant, a storyboard, something new. There
  // is no safe mapping to a different name, so leave it exactly as sent.
  if (currentRank === undefined) return null;

  const verified = qualityCache.get(videoId);

  let ceiling = proven === undefined ? GUARANTEED_RANK : proven;
  const ceilingBeforeMode = verified !== undefined && verified > ceiling ? verified : ceiling;

  if (verified !== undefined) {
    // A verified answer is the truth for this video and outranks the mode:
    // drawing unproven rungs is a policy for the *unknown*, not a licence to
    // re-emit a rung already watched 404. scheduleProbe is gated on
    // `verified === undefined`, so a wrong answer here would never be revisited.
    ceiling = ceilingBeforeMode;
  } else if (drawsUnproven(qualityMode)) {
    ceiling = usefulRank;
  }

  // Every mode wants the best rung that exists up to its own cap; they differ
  // in whether an *unproven* rung may be rendered while we find out. Not capped
  // by slot width - that would land on hqdefault, matching the ceiling, so
  // nothing would ever want more than was already proven and no probe would run.
  const useful = usefulRank;
  let target = useful > ceiling ? ceiling : useful;
  // Never hand back something worse than YouTube offered.
  if (target < currentRank) target = currentRank;

  // Unresolved means a probe is coming and this entry's answer may still change:
  // upward in safe mode once the rung is confirmed, downward in the modes that
  // draw unproven rungs if the gamble missed. Both need the entry tracked so
  // the answer can be written back.
  const unresolved = verified === undefined && (useful > ceiling || target > ceilingBeforeMode);
  if (unresolved) scheduleProbe(videoId);

  // Above the guarantee we are relying on proof, and that proof is per-family:
  // a probe verifies the exact URL it fetched. At or below it we are relying on
  // hqdefault always existing, which is a `/vi/` guarantee only.
  const next = buildUrl(videoId, QUALITY_NAMES[target], target <= GUARANTEED_RANK);
  // Tracked even when the URL stays as sent: the probe's answer still has to
  // be written back into this entry.
  if (unresolved) trackPending(videoId, entry, ceilingBeforeMode);
  if (next === url) return 0;
  entry.url = next;
  return 1;
}

/**
 * Remember an entry we gambled on, capped so a long session cannot grow it
 * without bound. Eviction is safe: it only costs that entry the write-back, and
 * the DOM sweep still covers it.
 */
function trackPending(videoId, entry, floor) {
  let entries = pendingEntries.get(videoId);
  if (!entries) {
    if (pendingEntries.size >= PENDING_LIMIT) {
      const oldest = pendingEntries.keys().next().value;
      pendingEntries.delete(oldest);
      provenFloor.delete(oldest);
    }
    entries = [];
    pendingEntries.set(videoId, entries);
  }
  // What this video is already known to support, so a correction can never walk
  // an entry below it. Without this a maxres miss on the watch page would drag
  // an hq720 rung YouTube itself shipped down to hqdefault.
  const known = provenFloor.get(videoId);
  if (known === undefined || floor > known) provenFloor.set(videoId, floor);
  if (entries.length < 8) entries.push(entry);
}

/**
 * Rewrite every URL in a thumbnail container in place. Handles both
 * `{ thumbnails: [...] }` (tileRenderer and friends) and `{ sources: [...] }`
 * (the newer *ViewModel schema).
 */
function upgradeContainer(container) {
  if (!container) return 0;
  const list = container.thumbnails || container.sources;
  if (!Array.isArray(list) || list.length === 0) return 0;

  // The highest rung YouTube itself put in this container. Anything it shipped
  // is an existence proof for that derivative, which is free verification: on
  // the watch page the response already carries hq720, so hq720 can be emitted
  // there without a probe and without any risk of a 404.
  let proven = GUARANTEED_RANK;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || typeof entry.url !== 'string') continue;
    const m = THUMB_URL_RE.exec(entry.url);
    const r = m ? RANK[m[2]] : undefined;
    if (r !== undefined && r > proven) proven = r;
  }

  let changed = 0;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry) continue;
    if (typeof entry.url !== 'string') continue;
    changed += upgradeEntry(entry, proven);
  }
  return changed;
}

// --- Item-level paths -----------------------------------------------------
// Everything below is O(1) per item: no recursion, no searching. These are the
// shapes seen in real home / continuation / watch responses, plus the legacy
// renderers kept as cheap insurance.

function upgradeItem(item) {
  if (!item || typeof item !== 'object') return 0;
  let changed = 0;

  // A watch-page playlist row wraps the tile one level deeper.
  const tile = item.tileRenderer || item.playlistPanelVideoWrapperRenderer?.primaryRenderer?.tileRenderer;

  if (tile) {
    const header = tile.header?.tileHeaderRenderer;
    changed += upgradeContainer(header?.thumbnail);
    changed += upgradeContainer(header?.thumbnailViewModel?.image);
    // The long-press menu carries its own copy of the same URL. Rewriting it
    // too keeps both pointing at one file, so opening the menu is an HTTP cache
    // hit instead of a fresh download of the original 320x180.
    changed += upgradeContainer(tile.onLongPressCommand?.showMenuCommand?.thumbnail);
    return changed;
  }

  changed += upgradeContainer(item.previewButtonRenderer?.thumbnail);
  changed += upgradeContainer(item.pivotVideoRenderer?.thumbnail);
  changed += upgradeContainer(item.lockupViewModel?.contentImage?.thumbnailViewModel?.image);
  // Legacy renderers — not produced by current tvhtml5 builds, but free.
  changed += upgradeContainer(item.gridVideoRenderer?.thumbnail);
  changed += upgradeContainer(item.compactVideoRenderer?.thumbnail);
  changed += upgradeContainer(item.videoRenderer?.thumbnail);
  return changed;
}

function upgradeItems(items) {
  if (!Array.isArray(items)) return 0;
  let changed = 0;
  for (let i = 0; i < items.length; i++) changed += upgradeItem(items[i]);
  return changed;
}

function upgradeSectionList(contents) {
  if (!Array.isArray(contents)) return 0;
  let changed = 0;

  for (let i = 0; i < contents.length; i++) {
    const section = contents[i];
    if (!section) continue;

    const shelf = section.shelfRenderer;
    if (shelf) {
      const content = shelf.content;
      if (content) {
        changed += upgradeItems(content.horizontalListRenderer?.items);
        changed += upgradeItems(content.gridRenderer?.items);
        changed += upgradeItems(content.expandedShelfContentsRenderer?.items);
      }
      continue;
    }

    if (section.gridRenderer) {
      changed += upgradeItems(section.gridRenderer.items);
      continue;
    }
    if (section.horizontalListRenderer) {
      changed += upgradeItems(section.horizontalListRenderer.items);
      continue;
    }
    // Search interleaves bare items among the shelves.
    changed += upgradeItem(section);
  }
  return changed;
}

function getByPath(obj, parts) {
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current == null) return undefined;
    current = current[parts[i]];
  }
  return current;
}

// --- Response-type dispatch ----------------------------------------------
// Paths mirror SCHEMA_REGISTRY in adblock.js so both engines agree on where a
// given response keeps its content.

const P = {
  HOME: ['contents', 'tvBrowseRenderer', 'content', 'tvSurfaceContentRenderer', 'content', 'sectionListRenderer', 'contents'],
  TABS: ['contents', 'tvBrowseRenderer', 'content', 'tvSecondaryNavRenderer', 'sections'],
  SEARCH: ['contents', 'sectionListRenderer', 'contents'],
  CONT_SECTION: ['continuationContents', 'sectionListContinuation', 'contents'],
  CONT_TVSURFACE: ['continuationContents', 'tvSurfaceContentContinuation', 'content', 'sectionListRenderer', 'contents'],
  CONT_GRID: ['continuationContents', 'gridContinuation', 'items'],
  CONT_HORIZ: ['continuationContents', 'horizontalListContinuation', 'items'],
  PIVOT: ['contents', 'singleColumnWatchNextResults', 'pivot', 'sectionListRenderer', 'contents'],
  AUTOPLAY: ['contents', 'singleColumnWatchNextResults', 'autoplay', 'autoplay'],
  REPLAY_BG: ['playerOverlays', 'playerOverlayRenderer', 'replay', 'playerOverlayReplayRenderer', 'background'],
  CURRENT_THUMB: ['currentVideoThumbnail'],
  MICROFORMAT: ['microformat', 'playerMicroformatRenderer', 'thumbnail'],
  VIDEO_DETAILS: ['videoDetails', 'thumbnail']
};

function upgradeAutoplaySets(sets) {
  if (!Array.isArray(sets)) return 0;
  let changed = 0;
  for (let i = 0; i < sets.length; i++) {
    const item =
      sets[i]?.nextVideoRenderer?.autoplayVideoWrapperRenderer?.primaryEndpointRenderer?.autoplayEndpointRenderer?.item;
    if (item) changed += upgradeItem(item);
  }
  return changed;
}

function upgradeAutoplay(autoplay) {
  if (!autoplay) return 0;
  let changed = 0;
  changed += upgradeAutoplaySets(autoplay.sets);
  changed += upgradeAutoplaySets(autoplay.modifiedSets);
  changed += upgradeContainer(autoplay.replayVideoRenderer?.pivotVideoRenderer?.thumbnail);
  return changed;
}

function upgradeBrowseTabs(sections) {
  if (!Array.isArray(sections)) return 0;
  let changed = 0;
  for (let i = 0; i < sections.length; i++) {
    const tabs = sections[i]?.tvSecondaryNavSectionRenderer?.tabs;
    if (!Array.isArray(tabs)) continue;
    for (let j = 0; j < tabs.length; j++) {
      const content = tabs[j]?.tabRenderer?.content;
      if (!content) continue;
      changed += upgradeSectionList(content.sectionListRenderer?.contents);
      changed += upgradeSectionList(content.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents);
    }
  }
  return changed;
}

function upgradeActions(actions) {
  if (!Array.isArray(actions)) return 0;
  let changed = 0;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;
    changed += upgradeItems(action.reloadContinuationItemsCommand?.continuationItems);
    changed += upgradeItems(action.appendContinuationItemsAction?.continuationItems);
  }
  return changed;
}

/**
 * Continuation payloads, in all four shapes.
 *
 * Called for every response rather than only for responseType 'CONTINUATION',
 * because a continuation is not always classified as one. A shelf continuation
 * under the playing video arrives with `contents.singleColumnWatchNextResults`
 * still attached, and detectResponseType() checks NEXT before CONTINUATION — so
 * the response is typed NEXT while every thumbnail in it lives under
 * `continuationContents.sectionListContinuation`.
 */
function upgradeContinuation(data) {
  let changed = 0;
  changed += upgradeSectionList(getByPath(data, P.CONT_SECTION));
  changed += upgradeSectionList(getByPath(data, P.CONT_TVSURFACE));
  changed += upgradeItems(getByPath(data, P.CONT_GRID));
  changed += upgradeItems(getByPath(data, P.CONT_HORIZ));
  return changed;
}

// Continuations that carry no video thumbnails: live chat polls every few
// seconds while a stream plays, and a scan of each would cost up to
// SCAN_MAX_NODES for nothing.
const NO_THUMBNAIL_CONTINUATIONS = {
  liveChatContinuation: true,
  commentRepliesContinuation: true,
  commentSectionContinuation: true
};

/** Whether every key of the continuation is one known to hold no thumbnails. */
function isThumbnailFreeContinuation(contents) {
  if (!contents || typeof contents !== 'object') return false;
  let any = false;
  for (const key in contents) {
    if (!NO_THUMBNAIL_CONTINUATIONS[key]) return false;
    any = true;
  }
  return any;
}

/**
 * Last-resort bounded walk, used only when the schema paths produced nothing.
 * Keeps the module working through an InnerTube reshuffle instead of silently
 * doing nothing, without ever putting a full traversal on the hot path.
 */
function scanForThumbnails(root) {
  if (!root || typeof root !== 'object') return 0;
  const queue = [root, 0];
  let index = 0;
  let visited = 0;
  let changed = 0;

  while (index < queue.length) {
    if (++visited > SCAN_MAX_NODES) break;
    const node = queue[index++];
    const depth = queue[index++];
    if (!node || typeof node !== 'object' || depth > SCAN_MAX_DEPTH) continue;

    if (Array.isArray(node.thumbnails) || Array.isArray(node.sources)) changed += upgradeContainer(node);

    const nextDepth = depth + 1;
    for (const key in node) {
      const value = node[key];
      if (value && typeof value === 'object') queue.push(value, nextDepth);
    }
  }
  if (DEBUG && changed) debugLog(`fallback scan upgraded ${changed} (visited ${visited})`);
  return changed;
}

/**
 * Entry point called from adblock.js's JSON.parse hook. `responseType` is the
 * type adblock already detected, so this costs no extra detection pass.
 */
export function upgradeResponseThumbnails(data, responseType) {
  if (!enabled || !data || typeof data !== 'object' || Array.isArray(data)) return 0;

  // Stamped on every parse, including ones that rewrite nothing: an empty
  // continuation is still evidence the surface is moving. drainProbes() reads
  // this to decide whether the app has gone quiet, so without it the whole
  // scroll gate is inert and probes drain straight into an active scroll.
  lastParseAt = now();

  // Checked before the switch: any response type can carry a continuation
  // alongside its own contents, and the type it gets classified as depends on
  // whichever signature detectResponseType() happens to test first.
  let changed = data.continuationContents ? upgradeContinuation(data) : 0;
  let scanned = false;

  switch (responseType) {
    case 'HOME_BROWSE':
      changed += upgradeSectionList(getByPath(data, P.HOME));
      break;
    case 'BROWSE_TABS':
      changed += upgradeBrowseTabs(getByPath(data, P.TABS));
      break;
    case 'SEARCH':
      changed += upgradeSectionList(getByPath(data, P.SEARCH));
      break;
    case 'CONTINUATION':
      // Already handled above. A live chat or comment poll carries no video
      // thumbnails and must not fall through to the scan below.
      if (isThumbnailFreeContinuation(data.continuationContents)) return changed;
      break;
    case 'SHORTS_SEQUENCE':
      changed += upgradeItems(data.entries);
      break;
    case 'ACTION':
      // A body can carry both lists, and the second is not a fallback.
      changed += upgradeActions(data.onResponseReceivedActions);
      changed += upgradeActions(data.onResponseReceivedEndpoints);
      break;
    case 'NEXT':
      changed += upgradeSectionList(getByPath(data, P.PIVOT));
      changed += upgradeAutoplay(getByPath(data, P.AUTOPLAY));
      changed += upgradeContainer(getByPath(data, P.REPLAY_BG));
      changed += upgradeContainer(getByPath(data, P.CURRENT_THUMB));
      break;
    case 'PLAYER':
      changed += upgradeContainer(getByPath(data, P.VIDEO_DETAILS));
      changed += upgradeContainer(getByPath(data, P.MICROFORMAT));
      changed += upgradeContainer(getByPath(data, P.REPLAY_BG));
      break;
    default:
      changed += scanForThumbnails(data);
      scanned = true;
  }

  // A known response type that yielded nothing means the shape moved.
  if (changed === 0 && !scanned) changed += scanForThumbnails(data);

  if (DEBUG && changed) debugLog(`${responseType}: rewrote ${changed} thumbnail URLs`);
  // Not gated on `changed`: a response that rewrote nothing can still have
  // queued probes (a URL already at its rung), and those must start now rather
  // than wait for some later parse that happens to change a URL. deferProbes()
  // returns at once when the queue is empty.
  deferProbes();
  // Scrolling is what brings a stale tile on screen, and scrolling is what
  // produces parses - so this is the cheapest possible trigger for a retry.
  if (pendingPromotions.size > 0 && !promoteTimer) {
    promoteTimer = setTimeout(runPromotionSweep, PROMOTION_DEBOUNCE);
  }
  return changed;
}

/** Whether adblock.js needs to keep its JSON.parse hook installed for us. */
export function thumbnailHookRequired() {
  return enabled;
}

// --- Verification ---------------------------------------------------------

/**
 * Whether the URL exists, by a HEAD request: true, false, UNKNOWN (a timeout),
 * or null when the HEAD could not tell - no readable Content-Length (a
 * cross-origin answer on older Chromium) or a request error, which is also
 * what a cross-origin 404 without CORS headers looks like - in which case the
 * caller loads the image instead. A grey placeholder answered 200 with a tiny
 * body is missing.
 */
function headExists(url) {
  return new Promise((resolve) => {
    let xhr;
    try {
      xhr = new XMLHttpRequest();
      xhr.open('HEAD', url, true);
    } catch {
      resolve(UNKNOWN);
      return;
    }
    xhr.timeout = PROBE_TIMEOUT;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return resolve(false);
      const length = parseInt(xhr.getResponseHeader('Content-Length'), 10);
      resolve(isNaN(length) ? null : length > PLACEHOLDER_MAX_BYTES);
    };
    xhr.onerror = () => resolve(null);
    xhr.ontimeout = () => resolve(UNKNOWN);
    xhr.onabort = () => resolve(UNKNOWN);
    try {
      xhr.send();
    } catch {
      resolve(UNKNOWN);
    }
  });
}

/**
 * Verify by loading the image rather than asking about it.
 *
 * Used for tiles the app has already rendered, where it costs nothing: the
 * browser has been to that URL, so this resolves out of the cache - including
 * the cached 404 that made the tile grey in the first place (its body is the
 * grey placeholder, which loads and is caught on its width). It also sidesteps
 * the one real fragility of the HEAD path, which is that XHR is subject to CORS
 * and a cross-origin 404 from i.ytimg.com need not carry the headers to let us
 * read it, so a HEAD that could not tell falls back to this. An `error` here is
 * a load that never got an answer, not a miss.
 *
 * This is the same signal the network hooks were being asked for, taken at the
 * layer that actually has it - a CSS background-image load never passes through
 * fetch or XMLHttpRequest, so no amount of hooking those would ever see it.
 */
function imageExists(url) {
  return new Promise((resolve) => {
    let img;
    try {
      img = new Image();
    } catch {
      resolve(UNKNOWN);
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    // A missing derivative can also come back 200 with a grey placeholder, which
    // loads fine and has to be caught on its dimensions instead.
    img.onload = () => finish(img.naturalWidth > PLACEHOLDER_MAX_WIDTH);
    // A missing rung loads as the placeholder above; an error is a load that
    // never got an answer, which says nothing about the rung.
    img.onerror = () => finish(UNKNOWN);
    timer = setTimeout(() => finish(UNKNOWN), PROBE_TIMEOUT);
    img.src = url;
  });
}

function scheduleProbe(videoId) {
  if (!enabled) return;
  if (qualityCache.has(videoId)) return;
  // One attempt per video per session, whatever the outcome. A video that was
  // enqueued and never reached, or probed and failed, must not come back: the
  // same tiles stream past on every scroll, and re-queueing them was what
  // turned a settled surface into a permanent trickle of requests. (Only an
  // eviction from the verification cache takes a video out again.)
  if (probeAttempted.has(videoId)) return;
  if (probeAttempted.size >= PROBE_ATTEMPT_LIMIT) return;
  probeAttempted.add(videoId);
  probeQueue.add(videoId);
  queuedByParse.push(videoId);
}

/**
 * The useful rung if it exists, else the guaranteed floor; null when the probe
 * learned nothing (a timeout or a network error).
 */
async function resolveQuality(videoId, onScreen) {
  // On screen: the browser already holds the answer, so ask it. Off screen: a
  // HEAD, because an <img> there would pull down a full image nobody is looking
  // at - the correction path only has to be exact for tiles that are visible.
  const rank = usefulRank;
  const url = buildUrl(videoId, QUALITY_NAMES[rank]);
  let exists = await (onScreen ? imageExists : headExists)(url);
  // A HEAD that could not tell (no readable length, or a request error): ask
  // the image, never assume. A network that is down fails both: UNKNOWN.
  if (exists === null) exists = await imageExists(url);
  if (exists === UNKNOWN) return null;
  return exists ? rank : FLOOR_RANK;
}

/** Rewrite the entries we gambled on now that the answer is known. */
function applyCorrection(videoId, rank) {
  const entries = pendingEntries.get(videoId);
  if (!entries) return;
  pendingEntries.delete(videoId);
  const url = buildUrl(videoId, QUALITY_NAMES[rank], rank <= GUARANTEED_RANK);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i] && entries[i].url !== url) entries[i].url = url;
  }
}

/** Resolved rank clamped to what the video was already known to support. */
function settledRank(videoId, resolved) {
  const floor = provenFloor.get(videoId);
  provenFloor.delete(videoId);
  return floor !== undefined && floor > resolved ? floor : resolved;
}

function onProbeDone(videoId, rank, generation) {
  // Correcting a tile changes what is on screen, so the cached sample is stale.
  visibleSample = null;
  activeProbes--;

  // Answered against a ladder that no longer applies (the mode changed while it
  // was in flight): dropped, and the video is probed again when a parse next
  // mentions it.
  if (generation !== probeGeneration) {
    drainProbes();
    return;
  }

  // Nothing learned (null: a timeout or a network error): nothing is saved, so
  // the next session asks again. The video is not re-queued this session
  // (probeAttempted), so a flaky network cannot turn into a retry loop. The
  // modes that draw unproven rungs keep what they drew - a timeout is no
  // evidence against it - while 'safe' holds the floor for this session. A miss
  // is an answer, and saved.
  const unknown = typeof rank !== 'number';
  if (unknown && drawsUnproven(qualityMode)) {
    pendingEntries.delete(videoId);
    provenFloor.delete(videoId);
    drainProbes();
    return;
  }
  const resolved = unknown ? FLOOR_RANK : rank;
  // A video the cache no longer remembers may be probed again when it comes
  // back; the one-attempt rule is for videos that were never answered.
  const evicted = capSet(qualityCache, videoId, resolved, CACHE_LIMIT);
  if (evicted !== null) {
    probeAttempted.delete(evicted);
    unconfirmed.delete(evicted);
  }
  if (unknown) {
    unconfirmed.add(videoId);
  } else {
    unconfirmed.delete(videoId);
    scheduleSave();
  }

  // Queued unconditionally: the sweep already skips elements that are on the
  // right URL, so letting it decide cannot lose a promotion the way a capped
  // "what did we emit" map would.
  // 1. Write the truth back into the response objects the app still holds. A
  //    tile that has not scrolled into view yet reads `.url` at render time, so
  //    this corrects it before it is ever drawn - no grey frame at all.
  const settled = settledRank(videoId, resolved);
  applyCorrection(videoId, settled);

  // 2. Queue a DOM sweep for tiles that were already on screen.
  if (ENABLE_LIVE_PROMOTION) {
    pendingPromotions.set(videoId, settled);
    if (!promoteTimer) promoteTimer = setTimeout(runPromotionSweep, PROMOTION_DEBOUNCE);
  }

  drainProbes();
}

/**
 * Called from the parse. The first videos this parse queued are the top of the
 * response - what the user is looking at - so a small burst of them goes
 * through immediately; everything else waits for the surface to settle.
 */
function deferProbes() {
  if (!enabled || probeQueue.size === 0) {
    queuedByParse.length = 0;
    return;
  }
  // A parse that queued nothing (a small response among the ones the surface
  // keeps fetching) leaves the latest parse and its budget as they are: its
  // head is still the freshest content on screen.
  if (queuedByParse.length > 0) {
    latestParse.clear();
    for (let i = 0; i < queuedByParse.length; i++) latestParse.add(queuedByParse[i]);
    queuedByParse.length = 0;
    urgentLeft = PROBE_URGENT_BURST;
  }
  visibleBudget = PROBE_VISIBLE_BURST;
  drainProbes();
  if (!probeTimer) probeTimer = setTimeout(drainProbes, PROBE_IDLE_DELAY);
}

/**
 * videoIds the app currently has thumbnails rendered for - a free visibility
 * signal, since the list is virtualised and "has a rendered thumbnail" already
 * means "on or near screen".
 *
 * Not IntersectionObserver: on webOS 3 that polyfill polls
 * getBoundingClientRect() over every observed node, forcing layout each tick.
 * Reading .style.backgroundImage touches no layout at all.
 */
function sampleRenderedIds() {
  const at = now();
  if (visibleSample && at - visibleSampleAt < VISIBLE_SAMPLE_TTL) return visibleSample;

  let nodes;
  try {
    nodes = document.querySelectorAll(DOM_SELECTOR);
  } catch {
    return null;
  }

  const ids = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const background = nodes[i].style && nodes[i].style.backgroundImage;
    if (!background) continue;
    const match = THUMB_IN_CSS_RE.exec(background);
    if (match) ids.add(match[1]);
  }
  // Scrolling new tiles into view is itself a grant of budget. Without this the
  // allowance only refilled on a parse, so scrolling through already-loaded
  // content - which fetches nothing - left on-screen grey boxes waiting behind
  // the idle gate with a full queue in front of them.
  if (visibleSample === null || !sameIds(visibleSample, ids)) {
    visibleBudget = PROBE_VISIBLE_BURST;
  }

  visibleSample = ids;
  visibleSampleAt = at;
  return ids;
}

function sameIds(a, b) {
  if (a.size !== b.size) return false;
  const iterator = a.values();
  let step = iterator.next();
  while (!step.done) {
    if (!b.has(step.value)) return false;
    step = iterator.next();
  }
  return true;
}

/** Appends to `picked`, up to `limit`, the ids of `set` that are queued and not picked yet. */
function takeFrom(set, picked, limit) {
  const iterator = set.values();
  let step = iterator.next();
  while (!step.done && picked.length < limit) {
    const id = step.value;
    if (probeQueue.has(id) && picked.indexOf(id) === -1) picked.push(id);
    step = iterator.next();
  }
}

/**
 * Up to `limit` queued ids: the on-screen ones first, then the latest parse's in
 * the order it queued them, then the head of the queue. Each tier is read from
 * its own small set against the queue, so a pick costs the size of those sets
 * plus `limit`, not a pass over the whole queue (up to PROBE_ATTEMPT_LIMIT ids,
 * drained three at a time).
 */
function pickProbeIds(rendered, limit) {
  const picked = [];
  if (limit <= 0) return picked;
  if (rendered) takeFrom(rendered, picked, limit);
  if (picked.length < limit) takeFrom(latestParse, picked, limit);
  if (picked.length < limit) takeFrom(probeQueue, picked, limit);
  return picked;
}

/**
 * Whether a picked video may go now, spending the budget of its tier. On-screen
 * work goes now, the latest parse's head next, everything else waits for the
 * surface to settle so it never competes with an active scroll. A tile one tier
 * refuses falls through to the tiers below rather than holding the queue.
 */
function admitToTier(videoId, onScreen) {
  if (onScreen && visibleBudget > 0) {
    visibleBudget--;
    return true;
  }
  if (urgentLeft > 0 && latestParse.has(videoId)) {
    urgentLeft--;
    return true;
  }
  return now() - lastParseAt >= PROBE_IDLE_DELAY;
}

function startProbe(videoId, onScreen, generation) {
  probeQueue.delete(videoId);
  latestParse.delete(videoId);
  if (qualityCache.has(videoId)) return;
  activeProbes++;
  resolveQuality(videoId, onScreen).then(
    (rank) => onProbeDone(videoId, rank, generation),
    () => onProbeDone(videoId, null, generation)
  );
}

/** One round of the queue, from the idle callback: as many probes as the slots and tiers allow. */
function runProbeRound() {
  probePump = null;
  if (!enabled || document.hidden) return;

  // The idle callback can land after a key press that arrived in between.
  const paused = navPauseLeft();
  if (paused > 0) {
    // Replace the idle timer, not defer to it: the queue is meant to resume as
    // soon as the remote is quiet, not when the surface settles.
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = setTimeout(drainProbes, paused);
    return;
  }

  // Every slot taken: the probe that lands next drains again.
  const limit = MAX_CONCURRENT_PROBES - activeProbes;
  if (limit <= 0) return;

  // Document order is a decent proxy for visibility at first paint and a poor
  // one afterwards: scroll far enough and the tiles on screen sit behind a few
  // hundred earlier entries, which at three concurrent probes is minutes of
  // waiting for a correction the user is looking at right now.
  const rendered = probeQueue.size >= VISIBILITY_SORT_MIN_QUEUE ? sampleRenderedIds() : null;
  const generation = probeGeneration;
  const ids = pickProbeIds(rendered, limit);
  let heldByIdle = false;
  for (let i = 0; i < ids.length; i++) {
    const onScreen = rendered ? rendered.has(ids[i]) : false;
    if (!admitToTier(ids[i], onScreen)) {
      heldByIdle = true;
      continue;
    }
    startProbe(ids[i], onScreen, generation);
  }

  // Whatever the gate held back gets picked up once the surface goes quiet:
  // for the idle gate that is the rest of its delay, not a whole new one.
  if (probeQueue.size > 0 && !probeTimer) {
    const delay = heldByIdle ? Math.max(50, PROBE_IDLE_DELAY - (now() - lastParseAt)) : PROBE_IDLE_DELAY;
    probeTimer = setTimeout(drainProbes, delay);
  }
}

function drainProbes() {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  if (!enabled || probePump || probeQueue.size === 0) return;

  // Mid-navigation: not even the on-screen tier. A probe for a visible tile is
  // an <img> load that competes with the row animation for decode time, and its
  // result queues a promotion on top. Come back once the remote is quiet.
  const paused = navPauseLeft();
  if (paused > 0) {
    probeTimer = setTimeout(drainProbes, paused);
    return;
  }
  probePump = idle(runProbeRound);
}

/** Arrow keydown, capture phase: just a timestamp, nothing else runs here. */
function onNavKey(e) {
  if (NAV_KEY_CODES[e.keyCode]) lastNavAt = now();
}

/** Milliseconds left on the navigation pause; 0 when the remote is quiet. */
function navPauseLeft() {
  const left = NAV_PAUSE_MS - (now() - lastNavAt);
  return left > 0 ? left : 0;
}

// --- Live promotion -------------------------------------------------------
// Only runs when verification disagrees with what was already emitted, which
// after the first session is rare. Batched into one sweep so N corrections cost
// one querySelectorAll, not N.

function runPromotionSweep() {
  promoteTimer = null;
  if (!enabled || pendingPromotions.size === 0) return;
  if (document.hidden) {
    pendingPromotions.clear();
    return;
  }

  // Mid-navigation: a promotion is a style write that decodes a bigger image
  // and re-rasterises the tile while the rows are moving. Wait for the remote
  // to go quiet; nothing is lost, the pending map keeps the corrections.
  const paused = navPauseLeft();
  if (paused > 0) {
    promoteTimer = setTimeout(runPromotionSweep, paused);
    return;
  }

  let nodes;
  try {
    nodes = document.querySelectorAll(DOM_SELECTOR);
  } catch {
    pendingPromotions.clear();
    return;
  }

  const applied = new Set();
  let patched = 0;
  for (let i = 0; i < nodes.length; i++) {
    const element = nodes[i];
    const background = element.style && element.style.backgroundImage;
    if (!background) continue;

    const match = THUMB_IN_CSS_RE.exec(background);
    if (!match) continue;

    const rank = pendingPromotions.get(match[1]);
    if (rank === undefined) continue;

    const next = buildUrl(match[1], QUALITY_NAMES[rank], rank === FLOOR_RANK);
    if (background.indexOf(next) !== -1) continue;

    // Layered, not replaced: the current image stays visible underneath until
    // the new one has decoded, so a promotion never flashes an empty tile.
    element.style.backgroundImage = 'url("' + next + '"), ' + background;
    applied.add(match[1]);
    patched++;
  }

  // A correction is NOT discarded just because this sweep found no home for it:
  // the list is virtualised, so when a probe lands its tile is often not in the
  // DOM yet. Entries survive a few rounds and then expire, bounding the map.
  pendingPromotions.forEach((rank, videoId) => {
    const attempts = (promotionAttempts.get(videoId) || 0) + 1;
    if (attempts >= PROMOTION_MAX_ATTEMPTS || applied.has(videoId)) {
      pendingPromotions.delete(videoId);
      promotionAttempts.delete(videoId);
    } else {
      promotionAttempts.set(videoId, attempts);
    }
  });
  if (pendingPromotions.size > 0 && !promoteTimer) {
    promoteTimer = setTimeout(runPromotionSweep, PROMOTION_RETRY_DELAY);
  }
  if (DEBUG && patched) debugLog(`promotion sweep patched ${patched} tiles`);
}

// --- Lifecycle ------------------------------------------------------------

function handleVisibilityChange() {
  if (document.hidden) {
    // webOS does not reliably fire pagehide when the app is closed from the
    // launcher, so backgrounding is the last dependable moment to persist.
    flushCache();
  } else {
    deferProbes();
  }
}

function flushCache() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveCache();
  }
}

/** Stops everything queued; `keepCache` false drops the pending save instead of writing it. */
export function cleanup(keepCache = true) {
  probeQueue.clear();
  visibleSample = null;
  visibleBudget = 0;
  pendingEntries.clear();
  provenFloor.clear();
  promotionAttempts.clear();
  queuedByParse.length = 0;
  latestParse.clear();
  urgentLeft = 0;
  probeAttempted.clear();
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  pendingPromotions.clear();
  if (promoteTimer) {
    clearTimeout(promoteTimer);
    promoteTimer = null;
  }
  if (keepCache) {
    flushCache();
  } else if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // In-flight probes are left to settle on their own. Switched off, their
  // results are still worth caching; after a strategy change
  // (resetVerification) the generation they carry is stale and they are dropped.
}

/**
 * Forget every verified rank. The cache is only meaningful against the ladder
 * that produced it: 'sd' records sddefault as a video's answer, the other modes
 * record maxres or the floor. A cached answer is never re-probed, so crossing
 * that line would freeze every known video at the old mode's ceiling. Starting
 * over costs one re-probe per video, spread over normal use.
 */
function resetVerification() {
  probeGeneration++;
  cleanup(false);
  qualityCache.clear();
  unconfirmed.clear();
  dropStoredCache();
}

if (enabled) loadCache();
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('pagehide', flushCache);
// Unconditional and passive: one property read per key press. Registering it
// only while enabled would need matching teardown for no measurable gain.
document.addEventListener('keydown', onNavKey, { capture: true, passive: true });

configAddChangeListener('thumbnailQualityMode', (evt) => {
  const previousUseful = usefulRank;
  qualityMode = evt.detail.newValue;
  usefulRank = usefulRankFor(qualityMode);
  if (usefulRank !== previousUseful) resetVerification();
});

configAddChangeListener('upgradeThumbnails', (evt) => {
  enabled = !!evt.detail.newValue;
  if (enabled) loadCache();
  else cleanup();
});