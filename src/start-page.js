/**
 * Start Page: opens Subscriptions, the Library or the History instead of Home
 * when the app starts. Only a plain start counts: a launch into a video, a
 * cast, a voice search or a relaunch is left alone. (From MickLesk's fork.)
 */
import { configRead } from './config.js';
import { extractLaunchParams } from './launch.js';

// The browse page of each Start Page choice. 'home' opens nothing.
const BROWSE_IDS = {
  subscriptions: 'FEsubscriptions',
  library: 'FEmy_youtube',
  history: 'FEhistory'
};
const GIVE_UP_MS = 120000;
// What the address carries on a launch that goes somewhere (handleLaunch):
// a video, a playlist, a voice query, a search.
const LAUNCH_TARGET_RE = /[?&](?:[cv]|list|vq|va|launch|inApp|search_query)=/;

/** Whether the address is Home with nothing to open on top of it. */
function isPlainHome() {
  const hash = (window.location.hash || '').replace(/^#/, '');
  const query = hash.indexOf('?');
  const path = query === -1 ? hash : hash.slice(0, query);
  if (path !== '' && path !== '/') return false;
  return !LAUNCH_TARGET_RE.test(query === -1 ? '' : hash.slice(query));
}

function launchedWithTarget() {
  const params = extractLaunchParams();
  return !!(params && (params.contentTarget || params.target));
}

function initStartPage() {
  const browseId = BROWSE_IDS[configRead('startPage')];
  if (!browseId || launchedWithTarget() || !isPlainHome()) return;

  let observer = null;
  let giveUpTimer = null;
  const stop = () => {
    if (observer) { observer.disconnect(); observer = null; }
    if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
    window.removeEventListener('hashchange', onHashChange);
  };
  function onHashChange() {
    // The viewer went somewhere first: leave them there.
    if (!isPlainHome()) stop();
  }

  // Once Home is up (after "Who's watching", if that comes first), and only if
  // the viewer is still on it.
  const check = () => {
    if (!document.body || !document.body.classList.contains('WEB_PAGE_TYPE_BROWSE')) return;
    stop();
    if (!isPlainHome()) return;
    console.info('[StartPage] Opening', browseId);
    window.location.hash = '#/browse?c=' + browseId;
  };

  const watch = () => {
    observer = new MutationObserver(check);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('hashchange', onHashChange);
    giveUpTimer = setTimeout(stop, GIVE_UP_MS);
    check();
  };
  if (document.body) watch();
  else document.addEventListener('DOMContentLoaded', watch);
}

initStartPage();
