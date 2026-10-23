/**
 * Autostart can open the app before the TV is online, and YouTube then stops
 * on its error page (webosbrew/youtube-webos#326, idea from PR #487). While the
 * TV reports itself offline, this shows a note and waits for the 'online'
 * event; OK goes on at once.
 *
 * ponytail: trusts navigator.onLine. If a TV says online before it has a route,
 * add an image probe of youtube.com (fetch is a CORS-bound polyfill on webOS 3).
 */
export function whenOnline(go) {
  const nav = window.navigator;
  if (!nav || nav.onLine !== false) {
    go();
    return;
  }

  const note = document.createElement('p');
  note.textContent = 'Waiting for an internet connection. YouTube opens by itself. Press OK to open it now.';
  note.style.cssText = 'position:fixed;top:40%;left:10%;right:10%;margin:0;color:#eee;font:28px sans-serif;text-align:center';
  document.documentElement.style.background = '#111';
  (document.body || document.documentElement).appendChild(note);

  let done = false;
  const onKey = (evt) => {
    if (evt.keyCode === 13) finish();
  };
  function finish() {
    if (done) return;
    done = true;
    window.removeEventListener('online', finish);
    document.removeEventListener('keydown', onKey, true);
    if (note.parentNode) note.parentNode.removeChild(note);
    go();
  }
  window.addEventListener('online', finish);
  document.addEventListener('keydown', onKey, true);
}
