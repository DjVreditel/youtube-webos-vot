// Dev diagnostics, aliased to an empty module unless built with `--env perf`.
// MUST stay first: perf_mon installs "inner" probes underneath every other hook.
import './perf_mon.js';

// polyfills.js before whatwg-fetch: the fetch polyfill decides at load time
// whether URLSearchParams exists, and on webOS 3 a URLSearchParams body was
// otherwise sent as "[object Object]".
import './polyfills.js';
import 'whatwg-fetch';
import './adblock.js';
import './hooks/json-stringify';
import './force-codec.js';
import './subtitle-translate.js';

import { SELECTORS } from './utils';
import { handleLaunch, extractLaunchParams } from './launch.js';
import { attemptActiveBypass, resetActiveBypass } from './auto-login.js';
import { isWebOS25, simulatorMode } from './webos-utils.js';
import { initBlockWebOSCast } from './block-webos-cast';
import './app_api/index';
import './ui.js'; // Registers the green-key handler, options panel, video-quality, global styles
import './keyboard-search.js';
import './sponsorblock.js';
import './emoji-font.js';
import './screensaver-fix.js';
import './yt-fixes.css';
import './comments-fix.js';
import './watch.js';
import './mute-previews.js';
import './guide-fit.js';
import './start-page.js';
import './time-remaining.js';
import './lang-settings-fix';

import { initBufferLimit } from './hooks/buffer-limit.js';
import { getWebOSVersion } from './webos-utils.js';

if (typeof initBufferLimit === 'function' && getWebOSVersion() <= 4) {
	initBufferLimit();
	console.info('Initiating buffer limit');
}

(function oneTimeParamsCheck() {
    const params = extractLaunchParams();
    if (params && Object.keys(params).length > 0) {
        attemptActiveBypass();
    }
})();

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    // Only the names, as handleLaunch logs them.
    console.info('RELAUNCH:', evt.detail && typeof evt.detail === 'object' ? Object.keys(evt.detail) : typeof evt.detail);
	resetActiveBypass();
    if (document.body && document.body.classList.contains(SELECTORS.ACCOUNT_SELECTOR)) {
        console.info('[Main] Relaunch detected on Account Selector. Triggering bypass.');
        attemptActiveBypass(true);
    }
    handleLaunch(evt.detail);
  },
  true
);

if (isWebOS25() && simulatorMode === false) {
  console.info('[Main] Enabling webOS Google Cast Block');
  initBlockWebOSCast();
}