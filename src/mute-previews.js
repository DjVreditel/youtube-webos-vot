import { configRead, configAddChangeListener } from './config.js';
import { isWatchPage, isShortsPage, getVideo } from './utils.js';

/**
 * Mute Video Previews: the previews that play when a tile on the home screen
 * or in search is focused start with sound; with this on they are muted.
 *
 * The TV app plays previews and real playback in one shared <video>, and a
 * preview that is opened carries on in it, so the mute is undone as soon as
 * the page becomes a watch or Shorts page. Only a mute this module set is ever
 * undone. (From MickLesk's fork; webosbrew/youtube-webos#25.)
 */

let mutedByUs = null;

function isPreview() {
  return !isWatchPage() && !isShortsPage();
}

function update(video) {
  const shouldMute = configRead('mutePreviews') && isPreview();
  if (shouldMute) {
    if (video && !video.muted) {
      video.muted = true;
      mutedByUs = video;
    }
  } else if (mutedByUs) {
    mutedByUs.muted = false;
    mutedByUs = null;
  }
}

// Capture: media events do not bubble.
const onPlay = (evt) => {
  if (evt.target instanceof HTMLVideoElement) update(evt.target);
};
document.addEventListener('play', onPlay, true);
document.addEventListener('playing', onPlay, true);

window.addEventListener('ytaf-page-update', () => update(getVideo()));
configAddChangeListener('mutePreviews', () => update(isPreview() ? getVideo() : null));
