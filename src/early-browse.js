import { filterParsedResponse } from './adblock.js';

/**
 * The first home screen, filtered too (aktiwers' fix, webosbrew/youtube-webos
 * PR #488).
 *
 * YouTube's /tv page fetches the first home screen itself, from an inline
 * script that runs before webOS injects the userScript:
 * `window.pendingEarlyBrowse` is set about 0.5 s after the page starts and
 * resolves about 2.5 s in, parsed with the native JSON.parse. The userScript
 * comes about 3 s in, so the JSON.parse hook in adblock.js never sees that
 * response: its ad tiles ("Sponsored") lead the first shelf, Shorts and the
 * other feed filters are not applied, and its thumbnails stay low-res. The app
 * takes the response about 4 s in, so there is time to filter it in place,
 * with everything the hook does.
 *
 * Only a fresh start fetches it: a preloaded launch skips it, which is why the
 * ads came back only sometimes.
 */
const pending = window.pendingEarlyBrowse;
if (pending && typeof pending.then === 'function') {
  pending.then(
    (early) => {
      if (early && filterParsedResponse(early.response)) console.info('[EarlyBrowse] Filtered the first home screen');
    },
    // The page handles its own failure.
    () => {}
  );
}
