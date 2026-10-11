import { configRead } from './config.js';

/**
 * Auto-translated subtitles in a language of the viewer's choosing.
 *
 * The TV (leanback) client gets a truncated `translationLanguages` list in the
 * /player response - about 16 entries where the web client gets about 125 - so
 * most languages (Hungarian, Serbian, Czech, ...) never appear in the TV's
 * Auto-translate menu, and on many videos there is no translated track to
 * pick at all.
 *
 * The translation itself is done server side: YouTube's timedtext endpoint
 * machine-translates any translatable track when the request carries
 * `&tlang=<code>`, whichever client asked for the track. So two edits to the
 * /player response are enough:
 *
 *   1. The chosen language is added to `translationLanguages` (pinned to the
 *      top, so it is not a hundred presses away on a remote), and ASR tracks
 *      the TV client forgot to flag as translatable are flagged.
 *   2. When the video has no track in that language, a ready-made
 *      "<Language> (auto-translated)" track is added: a copy of an existing
 *      track's baseUrl (auth/signature params kept) with `tlang` set. It is
 *      registered on every audio track, because the captions menu is built
 *      from `captionTrackIndices`, not from `captionTracks` directly.
 *
 * Ported and generalised from the forks of DavidVodus (English), relianceai
 * (Serbian) and ZUI-WebOS (Turkish).
 */

export const subtitleTranslateLanguages = {
  off: 'Off',
  hu: 'Magyar (Hungarian)',
  en: 'English',
  de: 'Deutsch (German)',
  es: 'Español (Spanish)',
  fr: 'Français (French)',
  it: 'Italiano (Italian)',
  pt: 'Português (Portuguese)',
  nl: 'Nederlands (Dutch)',
  pl: 'Polski (Polish)',
  cs: 'Čeština (Czech)',
  sk: 'Slovenčina (Slovak)',
  ro: 'Română (Romanian)',
  hr: 'Hrvatski (Croatian)',
  sr: 'Српски (Serbian)',
  sl: 'Slovenščina (Slovenian)',
  bg: 'Български (Bulgarian)',
  el: 'Ελληνικά (Greek)',
  tr: 'Türkçe (Turkish)',
  uk: 'Українська (Ukrainian)',
  ru: 'Русский (Russian)',
  sv: 'Svenska (Swedish)',
  da: 'Dansk (Danish)',
  fi: 'Suomi (Finnish)',
  no: 'Norsk (Norwegian)',
  ar: 'العربية (Arabic)',
  hi: 'हिन्दी (Hindi)',
  id: 'Bahasa Indonesia',
  vi: 'Tiếng Việt (Vietnamese)',
  th: 'ไทย (Thai)',
  ja: '日本語 (Japanese)',
  ko: '한국어 (Korean)',
  'zh-Hans': '中文 简体 (Chinese, Simplified)'
};

const LOG_PREFIX = '[SubtitleTranslate]';
const DEBUG = false;

/** Display name for the injected entries, in the language itself. */
function nativeName(code) {
  const label = subtitleTranslateLanguages[code] || code;
  const paren = label.indexOf(' (');
  return paren === -1 ? label : label.slice(0, paren);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `en` matches `en`, `en-GB`, `en-US`...; `zh-Hans` matches only itself. */
function sameLanguage(code, target) {
  if (typeof code !== 'string') return false;
  const a = code.toLowerCase();
  const b = target.toLowerCase();
  return a === b || (b.indexOf('-') === -1 && a.split('-')[0] === b);
}

/**
 * YouTube renders names either as `{ simpleText }` or `{ runs: [{ text }] }`
 * depending on client and version; mirror whatever shape it already sent.
 */
function makeName(template, text) {
  if (isObject(template) && Array.isArray(template.runs)) return { runs: [{ text }] };
  return { simpleText: text };
}

function withTlang(baseUrl, code) {
  if (typeof baseUrl !== 'string') return null;
  try {
    const url = new URL(baseUrl, document.location.href);
    url.searchParams.set('tlang', code);
    return url.toString();
  } catch {
    // URL with no usable constructor (very old engines): append by hand.
    if (/[?&]tlang=/.test(baseUrl)) return baseUrl.replace(/([?&]tlang=)[^&]*/, '$1' + encodeURIComponent(code));
    return baseUrl + (baseUrl.indexOf('?') === -1 ? '?' : '&') + 'tlang=' + encodeURIComponent(code);
  }
}

function addTranslationLanguage(renderer, code) {
  const list = renderer.translationLanguages;
  // No list means nothing on this video is translatable; an entry would be a
  // dead option.
  if (!Array.isArray(list) || list.length === 0) return;

  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (isObject(list[i]) && list[i].languageCode === code) { index = i; break; }
  }

  let entry;
  if (index === -1) {
    entry = { languageCode: code, languageName: makeName(isObject(list[0]) ? list[0].languageName : null, nativeName(code)) };
  } else {
    entry = list.splice(index, 1)[0];
  }
  list.unshift(entry);
}

function addTranslatedTrack(renderer, code) {
  const tracks = renderer.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return;

  for (let i = 0; i < tracks.length; i++) {
    if (isObject(tracks[i]) && sameLanguage(tracks[i].languageCode, code)) return; // already offered
  }

  // Prefer a human-made track as the source: machine-translating machine
  // transcription compounds the errors.
  let source = null;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (!isObject(t) || typeof t.baseUrl !== 'string' || t.isTranslatable === false) continue;
    if (t.kind !== 'asr') { source = t; break; }
    if (!source) source = t;
  }
  if (!source) return;

  const baseUrl = withTlang(source.baseUrl, code);
  if (!baseUrl) return;

  const label = `${nativeName(code)} (auto-translated)`;
  // A clean track rather than a copy of the source: copying would drag along
  // wrong fields (rtl from an Arabic source, kind: 'asr'). A distinct vssId and
  // languageCode keep the menu from folding it into the source as a duplicate.
  const newIndex = tracks.push({
    baseUrl,
    name: makeName(source.name, label),
    vssId: `.${code}`,
    languageCode: code,
    isTranslatable: false,
    trackName: label
  }) - 1;

  const audioTracks = renderer.audioTracks;
  if (Array.isArray(audioTracks)) {
    for (const at of audioTracks) {
      if (isObject(at) && Array.isArray(at.captionTrackIndices) && at.captionTrackIndices.indexOf(newIndex) === -1) {
        at.captionTrackIndices.push(newIndex);
      }
    }
  }
  if (DEBUG) console.info(LOG_PREFIX, 'Added translated track', code, 'from', source.languageCode);
}

function patchRenderer(renderer, code) {
  const tracks = renderer.captionTracks;
  if (Array.isArray(tracks)) {
    for (const t of tracks) {
      // ASR tracks are always translatable server side; the TV client
      // sometimes omits the flag, which hides the Auto-translate menu.
      if (isObject(t) && t.kind === 'asr' && t.isTranslatable !== true) t.isTranslatable = true;
    }
  }
  addTranslationLanguage(renderer, code);
  addTranslatedTrack(renderer, code);
}

function patchResponse(res, code) {
  const containers = [res, res.playerResponse];
  for (const c of containers) {
    if (!isObject(c) || !isObject(c.captions)) continue;
    const renderer = c.captions.playerCaptionsTracklistRenderer;
    if (isObject(renderer)) patchRenderer(renderer, code);
  }
}

function currentTarget() {
  const code = configRead('subtitleTranslateLang');
  return code && code !== 'off' && subtitleTranslateLanguages[code] ? code : null;
}

// Installed once and gated internally, like force-codec.js: unwinding a
// JSON.parse wrapper after other modules have stacked theirs would drop them.
const origParse = JSON.parse;
JSON.parse = function (text, reviver) {
  const out = origParse.call(this, text, reviver);
  // A /player response is tens of kilobytes; the small blobs YouTube parses
  // constantly never get past the first check.
  if (typeof text !== 'string' || text.length < 1000 || !out || typeof out !== 'object') return out;
  if (!out.captions && !(out.playerResponse && out.playerResponse.captions)) return out;
  const code = currentTarget();
  if (!code) return out;
  try {
    patchResponse(out, code);
  } catch (err) {
    // Never let a caption edge case break playback.
    console.warn(LOG_PREFIX, 'Failed to patch captions:', err);
  }
  return out;
};
