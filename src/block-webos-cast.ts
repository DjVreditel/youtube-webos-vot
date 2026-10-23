/**
 * Fixes webosbrew/youtube-webos/issues/343 without breaking casting
 * (webosbrew/youtube-webos/issues/401): the webOS Chromecast service is only
 * kept asleep when the app was not started by a cast launch, and the block
 * can be switched off from the settings panel.
 */

import { configRead } from './config';
import { FetchRegistry } from './hooks';

// `dialLaunch`/`pairingCode` mark a DIAL launch, `cc2` a Cast Connect one.
const CAST_LAUNCH_PARAMS = ['dialLaunch', 'pairingCode', 'cc2'];

function hasCastParams(query: string) {
  try {
    const params = new URLSearchParams(query);
    return CAST_LAUNCH_PARAMS.some((key) => params.has(key));
  } catch {
    return false;
  }
}

function isCastLaunch(params: any) {
  const { target, contentTarget = target } = params ?? {};
  if (typeof contentTarget !== 'string') return false;

  const queryStart = contentTarget.indexOf('?');

  return hasCastParams(
    queryStart === -1 ? contentTarget : contentTarget.slice(queryStart + 1)
  );
}

export function initBlockWebOSCast() {
  console.info('[Block WebOS Cast] Initialized');

  // handleLaunch() folds the launch params into the YouTube URL.
  let castLaunch = hasCastParams(window.location.search);

  document.addEventListener(
    'webOSRelaunch',
    (evt: any) => {
      if (isCastLaunch(evt.detail)) castLaunch = true;
    },
    true
  );

  FetchRegistry.getInstance().addEventListener('request', (evt) => {
    const { url } = evt.detail;
    if (url.pathname !== '/wake_cast_core') return;
    if (castLaunch || !configRead('blockWebosCast')) return;
    evt.preventDefault();
  });
}
