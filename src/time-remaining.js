import { configRead, configAddChangeListener } from './config.js';
import { isWatchPage, getVideo } from './utils.js';
import { formatTime, cssString } from './sponsorblock-labels.js';
import './time-remaining.css';

/**
 * Show Remaining Time and End Time: "-41:58 · ends 21:45" in front of the
 * duration under the seek bar, the end time on the TV's clock and in its
 * locale's format. (Idea from MickLesk's fork.)
 *
 * Like the SponsorBlock readouts in sponsorblock-labels.js, it is a
 * pseudo-element whose content this module writes into one <style>: a node
 * added to YouTube's controls would be deleted by incremental-dom, and the
 * rule applies by itself whenever the controls are rebuilt.
 *
 * The text is refreshed once a second on the watch page, and only while the
 * seek bar is on screen: a stylesheet write restyles the page, which is not
 * free on webOS 3, and nobody sees the text while the controls are hidden. A
 * live stream has no end, so it shows nothing.
 */

const TIME_SELECTOR = '[idomkey="time-label"] [idomkey="duration"]::before';
const BAR_SELECTOR = 'ytlr-progress-bar, ytlr-multi-markers-player-bar-renderer';
const TICK_MS = 1000;

let styleEl = null;
let css = '';
let timer = null;
let endFormatter = null;

function write(next) {
  if (next === css && (!next || (styleEl && styleEl.isConnected))) return;
  css = next;
  if (!styleEl || !styleEl.isConnected) {
    if (!next) return;
    styleEl = document.createElement('style');
    styleEl.id = 'ytaf-time-remaining';
    (document.head || document.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = next;
}

/** The controls are up: the time label exists and the seek bar is not hidden. */
function controlsVisible() {
  if (!document.querySelector('[idomkey="time-label"]')) return false;
  const bar = document.querySelector(BAR_SELECTOR);
  return !bar || !(bar.classList.contains('zylon-hidden') || bar.style.opacity === '0');
}

function formatEnd(ms) {
  // Intl is in Chrome 24+, so on webOS 3 too.
  if (!endFormatter) endFormatter = new Intl.DateTimeFormat(navigator.language, { hour: 'numeric', minute: 'numeric' });
  return endFormatter.format(new Date(ms));
}

/** The rule for the video's current position, or '' when there is nothing to show. */
export function buildCss(duration, currentTime, playbackRate, now) {
  if (!(duration > 0) || !isFinite(duration) || isNaN(currentTime)) return '';
  const remaining = Math.max(0, duration - currentTime) / (playbackRate > 0 ? playbackRate : 1);
  const text = `-${formatTime(remaining)} · ends ${formatEnd(now + remaining * 1000)}`;
  return `${TIME_SELECTOR}{content:${cssString(text)};}`;
}

function tick() {
  if (!controlsVisible()) return;
  const video = getVideo();
  write(video ? buildCss(video.duration, video.currentTime, video.playbackRate, Date.now()) : '');
}

function sync() {
  const on = configRead('showTimeRemaining') && isWatchPage();
  if (on && !timer) {
    timer = setInterval(tick, TICK_MS);
    tick();
  } else if (!on && timer) {
    clearInterval(timer);
    timer = null;
    write('');
  }
}

window.addEventListener('ytaf-page-update', sync);
configAddChangeListener('showTimeRemaining', sync);
sync();
