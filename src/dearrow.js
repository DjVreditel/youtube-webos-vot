/**
 * DeArrow (https://dearrow.ajay.app): titles, and optionally thumbnails,
 * submitted by the community in place of clickbait ones. Same servers and the
 * same privacy scheme as SponsorBlock: a request names only the first four
 * characters of the SHA-256 of a video id, and the answer holds every video
 * whose hash starts with them. (Idea from MickLesk's fork.)
 *
 * A tile is rewritten inside the response, before YouTube draws it. A video
 * not looked up yet is fetched in the background; its tile is rewritten in
 * place when the answer comes, which reaches the tiles YouTube has not drawn
 * yet (further along a row, rows further down), and every later page that
 * shows the video.
 */
import sha256 from 'tiny-sha256';
import { fetchJsonWithTimeout } from './fetch-timeout.js';

const BRANDING_API = 'https://sponsor.ajay.app/api/branding/';
const THUMBNAIL_API = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail';
const TIMEOUT_MS = 5000;
// A home screen sends a hundred tiles at once; a few requests at a time keep
// the TV's network and the server's rate limit out of trouble.
const MAX_IN_FLIGHT = 3;
const MAX_CACHED = 2000;
const VIDEO_ID_RE = /^[\w-]{11}$/;

// videoId -> { title, time } (null: nothing better than the original).
const cache = new Map();
// Hash prefix -> the tiles waiting for it.
const waiting = new Map();
const queue = [];
let inFlight = 0;

function remember(videoId, branding) {
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
  cache.set(videoId, branding);
}

/**
 * The submission DeArrow would show: the first one that is trusted (locked,
 * or not voted down). When that is the original, there is nothing to replace.
 */
function pick(list) {
  if (!Array.isArray(list)) return null;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || !(entry.locked || entry.votes >= 0)) continue;
    return entry.original ? null : entry;
  }
  return null;
}

function brandingFrom(entry) {
  if (!entry) return null;
  const title = pick(entry.titles);
  const thumbnail = pick(entry.thumbnails);
  const branding = {
    // A leading ">" asks DeArrow clients not to reformat the title.
    title: title && typeof title.title === 'string' ? title.title.replace(/^>/, '').trim() || null : null,
    time: thumbnail && typeof thumbnail.timestamp === 'number' ? thumbnail.timestamp : null
  };
  return branding.title || branding.time !== null ? branding : null;
}

export function videoIdOf(item) {
  const tile = item.tileRenderer;
  let id = null;
  if (tile) id = tile.contentId || tile.onSelectCommand?.watchEndpoint?.videoId;
  else if (item.lockupViewModel) {
    const lockup = item.lockupViewModel;
    if (lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') id = lockup.contentId;
  } else {
    const video = item.videoRenderer || item.gridVideoRenderer || item.compactVideoRenderer;
    if (video) id = video.videoId;
  }
  return typeof id === 'string' && VIDEO_ID_RE.test(id) ? id : null;
}

function rewrite(item, videoId, branding, thumbnails) {
  if (branding.title) {
    const tile = item.tileRenderer;
    const lockup = item.lockupViewModel;
    const video = item.videoRenderer || item.gridVideoRenderer || item.compactVideoRenderer;
    if (tile && tile.metadata?.tileMetadataRenderer) {
      tile.metadata.tileMetadataRenderer.title = { simpleText: branding.title };
    } else if (lockup && lockup.metadata?.lockupMetadataViewModel?.title) {
      lockup.metadata.lockupMetadataViewModel.title = { content: branding.title };
    } else if (video) {
      video.title = { runs: [{ text: branding.title }] };
    }
  }

  if (thumbnails && branding.time !== null) {
    // officialTime: the time is a submitted one, so the server makes the
    // frame now when it has none cached, instead of answering empty.
    const url = THUMBNAIL_API + '?videoID=' + encodeURIComponent(videoId) + '&time=' + branding.time +
      '&officialTime=true&generateNow=true';
    const sources = [{ url, width: 1280, height: 720 }];
    const tileThumb = item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail;
    const lockupImage = item.lockupViewModel?.contentImage?.thumbnailViewModel?.image;
    const video = item.videoRenderer || item.gridVideoRenderer || item.compactVideoRenderer;
    if (tileThumb) tileThumb.thumbnails = sources;
    else if (lockupImage) lockupImage.sources = sources;
    else if (video && video.thumbnail) video.thumbnail.thumbnails = sources;
  }
}

function settle(prefix, answer) {
  const tiles = waiting.get(prefix) || [];
  waiting.delete(prefix);
  // The answer covers every video under the prefix; cache them all, so the
  // next page that shows one needs no request.
  if (answer && typeof answer === 'object') {
    for (const id in answer) {
      if (VIDEO_ID_RE.test(id)) remember(id, brandingFrom(answer[id]));
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    const { item, videoId, thumbnails } = tiles[i];
    // A video the answer does not name has no submissions.
    if (!cache.has(videoId)) remember(videoId, null);
    const branding = cache.get(videoId);
    if (branding) rewrite(item, videoId, branding, thumbnails);
  }
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const prefix = queue.shift();
    inFlight++;
    fetchJsonWithTimeout(BRANDING_API + prefix, TIMEOUT_MS).then(
      // 404: no video under this prefix has a submission.
      (res) => settle(prefix, res.ok ? res.data : null),
      () => {
        // A failed request is tried again the next time a tile asks for it.
        waiting.delete(prefix);
      }
    ).then(() => {
      inFlight--;
      pump();
    });
  }
}

/**
 * Rewrites the item's title (and thumbnail, with `thumbnails`) with DeArrow's,
 * now when the video is known, otherwise once the lookup answers.
 */
export function applyDeArrow(item, thumbnails) {
  const videoId = videoIdOf(item);
  if (!videoId) return;

  if (cache.has(videoId)) {
    const branding = cache.get(videoId);
    if (branding) rewrite(item, videoId, branding, thumbnails);
    return;
  }

  const prefix = sha256(videoId).substring(0, 4);
  const tiles = waiting.get(prefix);
  if (tiles) {
    tiles.push({ item, videoId, thumbnails });
    return;
  }
  waiting.set(prefix, [{ item, videoId, thumbnails }]);
  queue.push(prefix);
  pump();
}
