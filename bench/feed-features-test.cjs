/**
 * The features ported from MickLesk's fork in fork-watch #26: the feed
 * filters (watched, length, channels, title keywords), Prefer Original Audio,
 * the long-press menu entries and their actions, DeArrow, the panel rows and
 * list editors, the Left/Right seek step and the Start Page.
 *
 * Usage: node bench/feed-features-test.cjs [dist/webOSUserScripts/userScript.js]
 */
const fs = require('fs');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyChrome38Downgrade, UA, setUserAgent, dispatchTrusted } = require('./chrome38-env.cjs');

const bundlePath = process.argv[2] || 'dist/webOSUserScripts/userScript.js';
const GREEN = 404;
const ENTER = 13;
const RIGHT = 39;
const pad = 'z'.repeat(600);

function boot(cfg, opts = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(`<!doctype html><html><body class="${opts.bodyClass || 'WEB_PAGE_TYPE_BROWSE'}"><ytlr-app>${opts.html || ''}</ytlr-app></body></html>`,
    { runScripts: 'outside-only', url: opts.url || 'https://www.youtube.com/tv', virtualConsole: vc, pretendToBeVisual: true });
  const win = dom.window;
  setUserAgent(win, UA.webos23);
  win.launchParams = opts.launchParams || '{}';
  win.XMLHttpRequest = class { open(){} send(){} setRequestHeader(){} getResponseHeader(){return null;} addEventListener(){} };
  let rafQ = [];
  win.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
  win.cancelAnimationFrame = () => {};
  if (opts.yttv) win._yttv = opts.yttv(win);
  const NS = win.JSON.stringify;
  win.localStorage.setItem('ytaf-configuration', NS(Object.assign({
    enableAdBlock: true, enableLegacyEmojiFix: false, enableSponsorBlock: false,
    enableReturnYouTubeDislike: false, upgradeThumbnails: false, enableAutoLogin: false
  }, cfg)));
  applyChrome38Downgrade(win);
  // After the downgrade, which takes fetch away (Chrome 38 had none): the
  // bundle's polyfill then leaves this one in place.
  win.fetch = opts.fetch || (() => Promise.reject(new Error('offline')));
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  const parse = (obj) => win.JSON.parse(NS(obj));
  const config = () => JSON.parse(win.localStorage.getItem('ytaf-configuration'));
  return { win, errors, parse, config, pump: () => { const q = rafQ; rafQ = []; for (const cb of q) cb(Date.now()); } };
}

function key(win, code, target, type = 'keydown') {
  const e = new win.KeyboardEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { get: () => code, configurable: true });
  dispatchTrusted(target || win.document.activeElement || win.document.body, e);
  return e;
}

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '\n     ' + extra : '')); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Items in the shapes YouTube sends ---

function tile(id, { title = 'Video ' + id, channel = 'Some Channel', watched, duration = '10:00', style = 'TILE_STYLE_YTLR_DEFAULT', longPress } = {}) {
  const overlays = [];
  if (duration) overlays.push({ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: duration } } });
  if (watched !== undefined) overlays.push({ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: watched } });
  return { tileRenderer: {
    style, contentId: id,
    onSelectCommand: { watchEndpoint: { videoId: id } },
    header: { tileHeaderRenderer: { thumbnailOverlays: overlays, thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' }] } } },
    metadata: { tileMetadataRenderer: { title: { simpleText: title }, lines: [
      { lineRenderer: { items: [{ lineItemRenderer: { text: { runs: [{ text: channel }] } } }] } }
    ] } },
    onLongPressCommand: longPress
  } };
}

function lockup(id, { title = 'Video ' + id, channel = 'Some Channel', watched, duration = '10:00', longPress } = {}) {
  const badges = duration ? [{ thumbnailBadgeViewModel: { text: duration, badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' } }] : [];
  const bottom = { badges };
  if (watched !== undefined) bottom.progressBar = { thumbnailOverlayProgressBarViewModel: { startPercent: watched } };
  return { lockupViewModel: {
    contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: { thumbnailViewModel: { image: { sources: [{ url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' }] },
      overlays: [{ thumbnailBottomOverlayViewModel: bottom }] } },
    metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: {
      metadataRows: [{ metadataParts: [{ text: { content: channel } }] }] } } } },
    rendererContext: { commandContext: { onTap: { innertubeCommand: { watchEndpoint: { videoId: id } } }, onLongPress: longPress } }
  } };
}

function browse(items, browseId) {
  const responseContext = { _pad: pad };
  if (browseId) responseContext.serviceTrackingParams = [{ service: 'GFEEDBACK', params: [{ key: 'browse_id', value: browseId }] }];
  return { responseContext, contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: {
    sectionListRenderer: { contents: [{ shelfRenderer: { title: { runs: [{ text: 'Recommended' }] },
      content: { horizontalListRenderer: { items } } } }] } } } } } } };
}
const itemsOf = (r) => r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content
  .sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items;
const ids = (r) => itemsOf(r).map((i) => (i.tileRenderer || i.lockupViewModel).contentId).join(',');

(async () => {
  // ---- Feed filters ----
  {
    const filters = { hideWatchedVideos: true, minVideoLength: '5', blockedChannels: ['Spam Channel'], blockedKeywords: ['clickbait'] };
    const feed = () => browse([
      tile('watched95__', { watched: 95 }),
      tile('watched50__', { watched: 50 }),
      lockup('short310___', { duration: '3:10' }),
      lockup('long1234___', { duration: '12:34', channel: 'Good' }),
      lockup('spamchan___', { channel: 'SPAM channel' }),
      tile('keyword____', { title: 'This CLICKBAIT will shock you' }),
      lockup('lockwatch__', { watched: 100 }),
      lockup('noduration_', { duration: null }),
      lockup('hourlong___', { duration: '1:02:03' })
    ]);
    const { win, parse, errors } = boot(filters);
    t('feed filters drop watched, short, blocked channel and keyword items',
      ids(parse(feed())) === 'watched50__,long1234___,noduration_,hourlong___', ids(parse(feed())));

    t('the history keeps watched videos (browse_id in the response)',
      ids(parse(Object.assign(feed(), browse(itemsOf(feed()), 'FEhistory')))).indexOf('watched95__') !== -1);
    win.location.hash = '#/browse?c=VLWL';
    t('a playlist in the address keeps watched videos', ids(parse(feed())).indexOf('lockwatch__') !== -1);
    win.location.hash = '#/browse?c=FEsubscriptions';
    t('Subscriptions hides watched videos', ids(parse(feed())).indexOf('watched95__') === -1);

    const watchNext = {
      responseContext: { _pad: pad },
      contents: { singleColumnWatchNextResults: { pivot: { sectionListRenderer: { contents: [
        { shelfRenderer: { content: { horizontalListRenderer: { items: [lockup('pivotspam__', { channel: 'Spam Channel' }), lockup('pivotok____')] } } } }
      ] } } } }
    };
    const next = parse(watchNext);
    const pivotIds = next.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents[0]
      .shelfRenderer.content.horizontalListRenderer.items.map((i) => i.lockupViewModel.contentId).join(',');
    t('the videos beside the player are filtered too', pivotIds === 'pivotok____', pivotIds);
    t('no jsdomError (feed filters)', errors.length === 0, errors[0]);
  }
  {
    const { parse } = boot({ enableAdBlock: false, hideWatchedVideos: true, blockedKeywords: ['clickbait'] });
    const r = parse(browse([tile('watched95__', { watched: 95 }), tile('keyword____', { title: 'clickbait' })]));
    t('feed filters do nothing with Ad Blocking off', ids(r) === 'watched95__,keyword____', ids(r));
  }

  // ---- Prefer Original Audio ----
  {
    const b64url = (str) => Buffer.from(str, 'latin1').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const xtags = (kind) => b64url('\n\u0015\n\u0005acont\u0012\f' + kind);
    const player = (formats) => ({ responseContext: { _pad: pad }, streamingData: { adaptiveFormats: formats } });
    const video = { itag: 137, mimeType: 'video/mp4' };
    const audio = (itag, id, isDefault, kind) => {
      const f = { itag, mimeType: 'audio/mp4', audioTrack: { id, displayName: id, audioIsDefault: isDefault } };
      if (kind) f.xtags = xtags(kind);
      return f;
    };
    const itags = (r) => r.streamingData.adaptiveFormats.map((f) => f.itag).join(',');

    const { parse } = boot({ forceOriginalAudio: true });
    t('original audio: the default track is kept, the dub dropped',
      itags(parse(player([video, audio(140, 'en.4', true), audio(141, 'de.3', false)]))) === '137,140');
    t('original audio: xtags win over audioIsDefault',
      itags(parse(player([video, audio(140, 'de.3', true, 'dubbed-auto'), audio(141, 'en.4', false, 'original')]))) === '137,141');
    t('original audio: one track is left alone',
      itags(parse(player([video, audio(140, 'en.4', true), audio(139, 'en.4', true)]))) === '137,140,139');
    t('original audio: formats without tracks are left alone',
      itags(parse(player([video, { itag: 140, mimeType: 'audio/mp4' }]))) === '137,140');
    const wrapped = parse({ responseContext: { _pad: pad }, playerResponse: player([video, audio(140, 'en.4', true), audio(141, 'de.3', false)]),
      contents: { singleColumnWatchNextResults: {} } });
    t('original audio: a playerResponse inside a watch response',
      itags(wrapped.playerResponse) === '137,140', itags(wrapped.playerResponse));

    const off = boot({ forceOriginalAudio: false });
    t('original audio off: nothing dropped',
      itags(off.parse(player([video, audio(140, 'en.4', true), audio(141, 'de.3', false)]))) === '137,140,141');
  }

  // ---- Long-press menu ----
  {
    const resolved = [];
    const feedback = [];
    let blockItem = null;
    const yttv = (win) => ({
      resolver: Object.assign(function Resolver() {}, { instance: { resolveCommand: (cmd) => { resolved.push(cmd); return 'original'; } } }),
      services: { mappings: {}, get: (name) => (name === 'KabukiInnerTubeClient' ? { fetch: ({ path, payload }) => ({ subscribe: (next) => {
        feedback.push({ path, payload });
        if (path === '/youtubei/v1/get_panel') {
          next({ content: { engagementPanelSectionListRenderer: { content: { listViewModel: { listItems: [
            { listItemViewModel: { rendererContext: { commandContext: { onTap: { innertubeCommand: { feedbackEndpoint: { feedbackToken: 'TOKEN_NOT_INTERESTED' } } } } } } },
            { listItemViewModel: { title: 'Save' } },
            { listItemViewModel: { rendererContext: { commandContext: { onTap: { innertubeCommand: { feedbackEndpoint: { feedbackToken: 'TOKEN_NO_CHANNEL' } } } } } } }
          ] } } } } });
        } else next({});
      } }) } : null) }
    });
    const { win, parse, config } = boot({ extendLongPressMenu: true }, { yttv });
    await wait(50);

    const menu = { showMenuCommand: { menu: { menuRenderer: { items: [{ menuServiceItemRenderer: { text: { runs: [{ text: 'Save' }] } } }] } } } };
    const panel = { innertubeCommand: { showEngagementPanelEndpoint: { identifier: { tag: 'PANEL_ID' }, globalConfiguration: { params: 'PARAMS' } } } };
    const r = parse(browse([tile('tilemenu___', { channel: 'Chan', longPress: menu }), lockup('lockpanel__', { channel: 'Other', longPress: panel }),
      tile('shorttile__', { style: 'TILE_STYLE_YTLR_SHORTS', longPress: menu })]));
    const [tileItem, lockItem, shortItem] = itemsOf(r);

    const menuItems = tileItem.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items;
    blockItem = menuItems[menuItems.length - 1];
    t('long press: a menu gets "Block channel"', menuItems.length === 2 &&
      blockItem.menuServiceItemRenderer.text.runs[0].text === 'Block channel: Chan', JSON.stringify(menuItems[1]));
    const built = lockItem.lockupViewModel.rendererContext.commandContext.onLongPress.innertubeCommand;
    const builtTexts = built && built.showMenuCommand ? built.showMenuCommand.menu.menuRenderer.items.map((i) =>
      (i.menuServiceItemRenderer || i.menuNavigationItemRenderer).text.runs[0].text) : [];
    t('long press: the feedback panel becomes a menu with the feedback entries',
      builtTexts.join('|') === "Play|Save to Watch later|Save to playlist|Not interested|Don't recommend channel|Block channel: Other",
      builtTexts.join('|'));
    t('long press: Shorts tiles are left alone',
      shortItem.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.length === 1);

    const resolve = win._yttv.resolver.instance.resolveCommand;
    t('long press: our action is not passed to YouTube', resolve(blockItem.menuServiceItemRenderer.serviceEndpoint) === true && resolved.length === 0);
    await wait(300);
    t('long press: Block channel adds the channel', JSON.stringify(config().blockedChannels) === '["Chan"]', JSON.stringify(config().blockedChannels));
    t('long press: YouTube\'s own playlist edits pass through',
      resolve({ playlistEditEndpoint: { playlistId: 'WL', actions: [] } }) === 'original' && resolved.length === 1);
    // webOS 25 wraps the entry's endpoint after a CLOSE_POPUP signal.
    const blockOther = built.showMenuCommand.menu.menuRenderer.items[5].menuServiceItemRenderer.serviceEndpoint;
    const wrapped = resolve({ commandExecutorCommand: { commands: [{ signalAction: { signal: 'CLOSE_POPUP' } }, blockOther] } });
    await wait(300);
    t('long press: a wrapped action runs, and the signal beside it still reaches YouTube',
      wrapped === true && JSON.stringify(config().blockedChannels) === '["Chan","Other"]' &&
      resolved.length === 2 && resolved[1].signalAction?.signal === 'CLOSE_POPUP', JSON.stringify(config().blockedChannels));

    const notInterested = built.showMenuCommand.menu.menuRenderer.items[3].menuServiceItemRenderer.serviceEndpoint;
    const noChannel = built.showMenuCommand.menu.menuRenderer.items[4].menuServiceItemRenderer.serviceEndpoint;
    resolve(notInterested);
    resolve(noChannel);
    await wait(20);
    const sent = feedback.filter((f) => f.path === '/youtubei/v1/feedback').map((f) => f.payload.feedbackTokens[0]).join(',');
    t('long press: the feedback entries send their panel\'s tokens',
      sent === 'TOKEN_NOT_INTERESTED,TOKEN_NO_CHANNEL' && feedback[0].payload.panelId === 'PANEL_ID', sent);

    const off = boot({ extendLongPressMenu: false });
    const r2 = off.parse(browse([tile('tilemenu___', { channel: 'Chan', longPress: menu })]));
    t('long press off: the menu is left alone',
      itemsOf(r2)[0].tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.length === 1);
  }

  // ---- DeArrow ----
  {
    const urls = [];
    const answers = {};
    const fetch = (url) => {
      urls.push(url);
      const prefix = url.split('/').pop();
      const body = answers[prefix];
      return Promise.resolve(body ? { ok: true, status: 200, json: () => Promise.resolve(body) } : { ok: false, status: 404 });
    };
    const prefixOf = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 4);
    const better = 'abcdefghijk';
    const keepsOriginal = 'zyxwvutsrqp';
    answers[prefixOf(better)] = Object.assign(answers[prefixOf(better)] || {}, { [better]: {
      titles: [{ title: '>The honest title', original: false, votes: 2, locked: false }, { title: 'Clickbait', original: true, votes: 0 }],
      thumbnails: [{ timestamp: 42.5, original: false, votes: 1, locked: false }]
    } });
    answers[prefixOf(keepsOriginal)] = Object.assign(answers[prefixOf(keepsOriginal)] || {}, { [keepsOriginal]: {
      titles: [{ title: 'Original wins', original: true, votes: 5, locked: false }, { title: 'Worse', original: false, votes: 0 }],
      thumbnails: []
    } });

    const { parse } = boot({ enableDeArrow: true, enableDeArrowThumbnails: true }, { fetch });
    const first = parse(browse([tile(better, { title: 'YOU WON\'T BELIEVE' }), lockup(keepsOriginal, { title: 'Original wins' })]));
    t('DeArrow asks by hash prefix only', urls.length === 2 && urls.every((u) => /^https:\/\/sponsor\.ajay\.app\/api\/branding\/[0-9a-f]{4}$/.test(u)) &&
      urls.indexOf('https://sponsor.ajay.app/api/branding/' + prefixOf(better)) !== -1, urls.join(' '));
    await wait(30);
    const [rewritten, untouched] = itemsOf(first);
    t('DeArrow rewrites the tile once the answer is in',
      rewritten.tileRenderer.metadata.tileMetadataRenderer.title.simpleText === 'The honest title',
      JSON.stringify(rewritten.tileRenderer.metadata.tileMetadataRenderer.title));
    t('DeArrow thumbnail is the submitted frame',
      /dearrow-thumb\.ajay\.app\/api\/v1\/getThumbnail\?videoID=abcdefghijk&time=42\.5/.test(rewritten.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url));
    t('DeArrow keeps a title the community kept original',
      untouched.lockupViewModel.metadata.lockupMetadataViewModel.title.content === 'Original wins');
    const again = parse(browse([lockup(better, { title: 'YOU WON\'T BELIEVE' })]));
    t('DeArrow: a known video is rewritten before YouTube sees it, without a request',
      itemsOf(again)[0].lockupViewModel.metadata.lockupMetadataViewModel.title.content === 'The honest title' && urls.length === 2, urls.length);

    const off = boot({ enableDeArrow: false }, { fetch: (u) => { urls.push(u); return Promise.reject(new Error('x')); } });
    const before = urls.length;
    off.parse(browse([tile('qwertyuiopa')]));
    t('DeArrow off: no request', urls.length === before);

    // An answer naming thousands of other videos must not evict the asked one.
    const crowded = 'crowdedvid1';
    const big = { [crowded]: { titles: [{ title: 'Calm title', original: false, votes: 1 }], thumbnails: [] } };
    for (let i = 0; i < 2500; i++) big['f' + String(i).padStart(10, '0')] = { titles: [{ title: 'x', original: false, votes: 1 }], thumbnails: [] };
    answers[prefixOf(crowded)] = big;
    const busy = boot({ enableDeArrow: true }, { fetch });
    busy.parse(browse([tile(crowded)]));
    await wait(30);
    const asked = urls.length;
    const seen = busy.parse(browse([lockup(crowded)]));
    t('DeArrow: a big answer does not evict the asked video',
      itemsOf(seen)[0].lockupViewModel.metadata.lockupMetadataViewModel.title.content === 'Calm title' && urls.length === asked, urls.length - asked);
  }

  // ---- Settings panel ----
  {
    const { win, pump, config, errors } = boot({});
    key(win, GREEN, win.document.body);
    for (let i = 0; i < 20; i++) pump();
    const filters = win.document.querySelector('#ytaf-page-filters');
    const titles = Array.from(filters.querySelectorAll('.section-title')).map((e) => e.textContent);
    t('Filters tab has a Feed Filters section', titles.indexOf('Feed Filters') !== -1, titles.join('|'));
    const inputs = filters.querySelectorAll('.ytaf-text-input');
    t('two list editors with a text box each', inputs.length === 2, inputs.length);

    const keywords = inputs[1];
    keywords.focus();
    const typed = key(win, 65, keywords);
    t('typing in the text box is not blocked by the panel', !typed.defaultPrevented);
    keywords.value = 'ab';
    keywords.setSelectionRange(1, 1);
    key(win, RIGHT, keywords);
    t('Right inside the text moves the cursor, not the focus', win.document.activeElement === keywords);
    keywords.value = '  Spoiler  ';
    key(win, ENTER, keywords);
    keywords.value = 'spoiler';
    key(win, ENTER, keywords);
    await wait(300);
    t('OK in the text box adds the entry once', JSON.stringify(config().blockedKeywords) === '["Spoiler"]', JSON.stringify(config().blockedKeywords));
    const entry = keywords.closest('.ytaf-list-editor').querySelector('.ytaf-list-entries .ytaf-list-btn');
    t('the entry is listed as a button', entry && entry.textContent.indexOf('Spoiler') !== -1);
    entry.click();
    await wait(300);
    t('pressing the entry removes it', JSON.stringify(config().blockedKeywords) === '[]');
    t('the focus stays in the panel after a removal', filters.contains(win.document.activeElement));

    const adBlock = filters.querySelector('input[type=checkbox]');
    adBlock.checked = false;
    adBlock.dispatchEvent(new win.Event('change'));
    t('the feed filters are greyed out with Ad Blocking off', keywords.disabled && filters.querySelector('.ytaf-list-btn').disabled);
    adBlock.checked = true;
    adBlock.dispatchEvent(new win.Event('change'));
    t('and come back with it', !keywords.disabled);

    const labels = (sel) => Array.from(win.document.querySelectorAll(sel + ' .label-text, ' + sel + ' .shortcut-label')).map((e) => e.textContent.trim());
    const player = labels('#ytaf-page-player');
    t('Player tab: Prefer Original Audio and the seek step', player.indexOf('Prefer Original Audio over Dubbed') !== -1 &&
      player.some((l) => l.indexOf('Left/Right Seek Step') !== -1), player.join('|'));
    const iface = labels('#ytaf-page-ui-tweaks');
    t('UI Tweaks tab: Start Page, long-press menu and DeArrow', iface.some((l) => l.indexOf('Start Page') !== -1) &&
      iface.indexOf('More Options in the Long-Press Menu') !== -1 && iface.indexOf('DeArrow: Replace Clickbait Titles') !== -1, iface.join('|'));
    t('no jsdomError (panel)', errors.length === 0, errors[0]);
  }

  // ---- Left/Right seek step ----
  {
    const { win } = boot({ seekStep: '10' }, { bodyClass: 'WEB_PAGE_TYPE_WATCH', html: '<video></video><yt-focus-container idomkey="controls"></yt-focus-container>' });
    await wait(10);
    const video = win.document.querySelector('video');
    let time = 100;
    Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { get: () => time, set: (v) => { time = v; }, configurable: true });
    const down = key(win, RIGHT, win.document.body);
    key(win, RIGHT, win.document.body);
    await wait(260);
    t('Right with the controls hidden seeks by the step, presses add up', time === 120 && down.defaultPrevented, 'time ' + time);
    win.document.querySelector('yt-focus-container').classList.add('zylon-focus');
    key(win, RIGHT, win.document.body);
    await wait(260);
    t('with the controls shown Right is left to YouTube', time === 120, 'time ' + time);

    const unknown = boot({ seekStep: '10' }, { bodyClass: 'WEB_PAGE_TYPE_WATCH', html: '<video></video>' });
    const u = key(unknown.win, RIGHT, unknown.win.document.body);
    t('without the controls in the page Right is left to YouTube', !u.defaultPrevented);

    const off = boot({ seekStep: '0' }, { bodyClass: 'WEB_PAGE_TYPE_WATCH', html: '<video></video><yt-focus-container idomkey="controls"></yt-focus-container>' });
    const e = key(off.win, RIGHT, off.win.document.body);
    t('seek step off: Right is left to YouTube', !e.defaultPrevented);
  }

  // ---- Start Page ----
  {
    const start = (opts) => {
      const b = boot({ startPage: 'subscriptions' }, Object.assign({ bodyClass: '' }, opts));
      b.win.document.body.className = 'WEB_PAGE_TYPE_BROWSE';
      return b;
    };
    let b = start({ url: 'https://www.youtube.com/tv#/?env_forceFullAnimation=1' });
    await wait(20);
    t('Start Page opens Subscriptions on a plain start', b.win.location.hash === '#/browse?c=FEsubscriptions', b.win.location.hash);
    b = start({ url: 'https://www.youtube.com/tv#/?env_forceFullAnimation=1&v=abcdefghijk' });
    await wait(20);
    t('Start Page leaves a launch into a video alone', b.win.location.hash.indexOf('v=abcdefghijk') !== -1, b.win.location.hash);
    b = start({ url: 'https://www.youtube.com/tv#/', launchParams: '{"contentTarget":"v=abcdefghijk"}' });
    await wait(20);
    t('Start Page leaves a launch with a target alone', b.win.location.hash === '#/', b.win.location.hash);
    b = boot({ startPage: 'home' }, { url: 'https://www.youtube.com/tv#/' });
    await wait(20);
    t('Start Page Home changes nothing', b.win.location.hash === '#/', b.win.location.hash);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
