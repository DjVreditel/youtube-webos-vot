/**
 * What the feed filters read from a video item: its title, its channel, its
 * length and how much of it was watched. The items come in three shapes - the
 * tileRenderer of the older TV layouts, the lockupViewModel of the current one,
 * and the video renderers some surfaces (search, watch-next) still send - and
 * each field is looked for in all three. (Idea from MickLesk's fork.)
 *
 * Every reader returns null (or 0) when the item has no such field, so a
 * channel, a playlist or a live stream without a length is never dropped for a
 * field it does not have.
 */

// Our own emoji sentinels (adblock.js) and the other invisible marks a title
// can carry; they must not stop a keyword or a channel name from matching.
const INVISIBLE_RE = /[\u200B\u200C\u2060\uFEFF]/g;
const DURATION_RE = /^\d{1,2}(?::\d{2}){1,2}$/;

/** The text of simpleText, runs, a view model's content, or a plain string. */
function textOf(value) {
  if (!value) return null;
  let text = null;
  if (typeof value === 'string') text = value;
  else if (typeof value.simpleText === 'string') text = value.simpleText;
  else if (typeof value.content === 'string') text = value.content;
  else if (Array.isArray(value.runs)) {
    text = '';
    for (let i = 0; i < value.runs.length; i++) {
      const run = value.runs[i];
      if (run && typeof run.text === 'string') text += run.text;
    }
  }
  return text === null ? null : text.replace(INVISIBLE_RE, '').trim();
}

function videoRendererOf(item) {
  return item.videoRenderer || item.gridVideoRenderer || item.compactVideoRenderer || null;
}

function lockupOverlays(item) {
  const overlays = item.lockupViewModel?.contentImage?.thumbnailViewModel?.overlays;
  return Array.isArray(overlays) ? overlays : null;
}

function tileOverlays(item) {
  const overlays = item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays;
  return Array.isArray(overlays) ? overlays : null;
}

export function itemTitle(item) {
  const tile = item.tileRenderer;
  if (tile) return textOf(tile.metadata?.tileMetadataRenderer?.title);
  const lockup = item.lockupViewModel;
  if (lockup) return textOf(lockup.metadata?.lockupMetadataViewModel?.title);
  const video = videoRendererOf(item);
  return video ? textOf(video.title) : null;
}

/** The channel: the first metadata line of a tile or a lockup, a video's byline. */
export function itemChannel(item) {
  const tile = item.tileRenderer;
  if (tile) {
    return textOf(tile.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text);
  }
  const lockup = item.lockupViewModel;
  if (lockup) {
    const rows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
    return textOf(rows?.[0]?.metadataParts?.[0]?.text);
  }
  const video = videoRendererOf(item);
  if (!video) return null;
  return textOf(video.ownerText) || textOf(video.shortBylineText) || textOf(video.longBylineText);
}

function parseDuration(text) {
  if (!text || !DURATION_RE.test(text)) return null;
  const parts = text.split(':');
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) seconds = seconds * 60 + Number(parts[i]);
  return seconds;
}

function badgeDuration(badges) {
  if (!Array.isArray(badges)) return null;
  for (let i = 0; i < badges.length; i++) {
    const seconds = parseDuration(textOf(badges[i]?.thumbnailBadgeViewModel?.text));
    if (seconds !== null) return seconds;
  }
  return null;
}

/** The length in seconds, from the duration on the thumbnail, or null. */
export function itemDurationSeconds(item) {
  const tiles = tileOverlays(item);
  if (tiles) {
    for (let i = 0; i < tiles.length; i++) {
      const seconds = parseDuration(textOf(tiles[i]?.thumbnailOverlayTimeStatusRenderer?.text));
      if (seconds !== null) return seconds;
    }
    return null;
  }
  const lockups = lockupOverlays(item);
  if (lockups) {
    for (let i = 0; i < lockups.length; i++) {
      const overlay = lockups[i];
      if (!overlay) continue;
      const seconds = badgeDuration(overlay.thumbnailBottomOverlayViewModel?.badges) ??
        badgeDuration(overlay.thumbnailOverlayBadgeViewModel?.thumbnailBadges);
      if (seconds !== null) return seconds;
    }
    return null;
  }
  const video = videoRendererOf(item);
  return video ? parseDuration(textOf(video.lengthText)) : null;
}

function resumePercent(overlays) {
  if (!Array.isArray(overlays)) return 0;
  for (let i = 0; i < overlays.length; i++) {
    const pct = overlays[i]?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
    if (typeof pct === 'number') return pct;
  }
  return 0;
}

/** How much of the video was watched, 0-100: the red bar under the thumbnail. */
export function itemWatchedPercent(item) {
  const tiles = tileOverlays(item);
  if (tiles) return resumePercent(tiles);
  const lockups = lockupOverlays(item);
  if (lockups) {
    for (let i = 0; i < lockups.length; i++) {
      const overlay = lockups[i];
      if (!overlay) continue;
      const bar = overlay.thumbnailBottomOverlayViewModel?.progressBar?.thumbnailOverlayProgressBarViewModel ||
        overlay.thumbnailOverlayProgressBarViewModel;
      if (bar && typeof bar.startPercent === 'number') return bar.startPercent;
    }
    return 0;
  }
  const video = videoRendererOf(item);
  return video ? resumePercent(video.thumbnailOverlays) : 0;
}

/**
 * The browse page a response belongs to: the browse_id the response names in
 * its tracking parameters, else the page in the address (`#/browse?c=FE...`).
 * A continuation names no page of its own, so the address is what tells it.
 */
function browseIdOf(data) {
  const services = data && data.responseContext && data.responseContext.serviceTrackingParams;
  if (Array.isArray(services)) {
    for (let i = 0; i < services.length; i++) {
      const params = services[i] && services[i].params;
      if (!Array.isArray(params)) continue;
      for (let j = 0; j < params.length; j++) {
        if (params[j] && params[j].key === 'browse_id' && typeof params[j].value === 'string') return params[j].value;
      }
    }
  }
  const match = /[?&]c=([^&]+)/.exec(window.location.hash || '');
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Whether watched videos stay in this response: the history, the library and
 * playlists (Watch later included) list videos because they were watched or
 * saved, and would empty out without them.
 */
export function keepsWatchedVideos(data) {
  const id = browseIdOf(data);
  return id === 'FEhistory' || id === 'FElibrary' || id === 'FEmy_youtube' || id.slice(0, 2) === 'VL';
}
