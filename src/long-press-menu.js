/**
 * More entries in the menu a long press on a video tile opens: "Not
 * interested", "Don't recommend channel" and "Block channel". Where YouTube
 * opens its feedback panel instead of a menu, a menu with the usual entries
 * (Play, Watch later, Save to playlist) and these is put in its place.
 *
 * From MickLesk's fork, which adapted it from TizenTube
 * (https://github.com/reisxd/TizenTube, mods/features/adblock.js and
 * mods/utils/innerTubeCalls.js). The queue entry of that fork is left out.
 */
import { configRead, configWrite } from './config.js';
import { showNotification } from './notifications.js';
import { ResolveCommandRegistry } from './app_api/index';

// Marks our own menu entries, so a tile seen twice does not get them twice,
// and our commands, so the resolveCommand hook knows them from YouTube's.
const MARKER = 'ytafMenuEntry';
const ACTION_KEY = 'ytafAction';

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.runs)) {
    let text = '';
    for (let i = 0; i < value.runs.length; i++) text += (value.runs[i] && value.runs[i].text) || '';
    return text;
  }
  return '';
}

function serviceItem(text, serviceEndpoint) {
  return { menuServiceItemRenderer: { text: { runs: [{ text }] }, serviceEndpoint, trackingParams: null, [MARKER]: true } };
}

function navigationItem(text, navigationEndpoint) {
  return { menuNavigationItemRenderer: { text: { runs: [{ text }] }, navigationEndpoint, trackingParams: null } };
}

/**
 * A service endpoint that runs one of our actions. Menus only take endpoints
 * YouTube knows, so it rides in a playlistEditEndpoint that the hook below
 * takes back out before YouTube sees it.
 */
function actionEndpoint(action, params) {
  return { clickTrackingParams: null, playlistEditEndpoint: { [ACTION_KEY]: { action, params } } };
}

/** What the menu needs from a tile or a lockup, or null for anything else. */
function tileInfo(item) {
  const tile = item.tileRenderer;
  if (tile) {
    if (tile.style !== 'TILE_STYLE_YTLR_DEFAULT') return null;
    const watchEndpoint = tile.onSelectCommand?.watchEndpoint;
    if (!watchEndpoint || typeof tile.contentId !== 'string') return null;
    const meta = tile.metadata?.tileMetadataRenderer;
    return {
      videoId: tile.contentId,
      title: textOf(meta?.title),
      channel: textOf(meta?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text).trim(),
      thumbnails: tile.header?.tileHeaderRenderer?.thumbnail?.thumbnails,
      watchEndpoint,
      holder: tile,
      holderKey: 'onLongPressCommand'
    };
  }

  const lockup = item.lockupViewModel;
  if (lockup) {
    if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || typeof lockup.contentId !== 'string') return null;
    const context = lockup.rendererContext?.commandContext;
    const watchEndpoint = context?.onTap?.innertubeCommand?.watchEndpoint;
    if (!context || !watchEndpoint) return null;
    const meta = lockup.metadata?.lockupMetadataViewModel;
    return {
      videoId: lockup.contentId,
      title: textOf(meta?.title),
      channel: textOf(meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text).trim(),
      thumbnails: lockup.contentImage?.thumbnailViewModel?.image?.sources,
      watchEndpoint,
      holder: context,
      holderKey: 'onLongPress'
    };
  }
  return null;
}

/** The long-press command, out of its innertubeCommand wrapper if it has one. */
function longPressCommand(info) {
  const raw = info.holder[info.holderKey];
  if (!raw || typeof raw !== 'object') return null;
  return raw.innertubeCommand && typeof raw.innertubeCommand === 'object' ? raw.innertubeCommand : raw;
}

/** The feedback panel a long press opens instead of a menu, if it does. */
function feedbackPanel(command) {
  const endpoint = command && command.showEngagementPanelEndpoint;
  const panelId = endpoint?.identifier?.tag;
  const params = endpoint?.globalConfiguration?.params;
  return typeof panelId === 'string' && typeof params === 'string' ? { panelId, params } : null;
}

function feedbackItems(panel) {
  return [
    serviceItem('Not interested', actionEndpoint('feedback', { panelId: panel.panelId, params: panel.params, index: 0 })),
    serviceItem("Don't recommend channel", actionEndpoint('feedback', { panelId: panel.panelId, params: panel.params, index: 1 }))
  ];
}

function blockChannelItem(info) {
  if (!info.channel) return null;
  return serviceItem('Block channel: ' + info.channel, actionEndpoint('blockChannel', { name: info.channel }));
}

function buildMenu(info, extraItems) {
  const inWatchLater = info.watchEndpoint.playlistId === 'WL';
  const watchLaterAction = inWatchLater
    ? { removedVideoId: info.videoId, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }
    : { addedVideoId: info.videoId, action: 'ACTION_ADD_VIDEO' };
  const items = [
    navigationItem('Play', { clickTrackingParams: null, watchEndpoint: info.watchEndpoint }),
    {
      menuServiceItemRenderer: {
        text: { runs: [{ text: inWatchLater ? 'Remove from Watch later' : 'Save to Watch later' }] },
        serviceEndpoint: {
          clickTrackingParams: null,
          commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse/edit_playlist' } },
          playlistEditEndpoint: { playlistId: 'WL', actions: [watchLaterAction] }
        },
        trackingParams: null
      }
    },
    navigationItem('Save to playlist', { clickTrackingParams: null, addToPlaylistEndpoint: { videoId: info.videoId } })
  ];
  for (let i = 0; i < extraItems.length; i++) items.push(extraItems[i]);
  return {
    clickTrackingParams: null,
    showMenuCommand: {
      contentId: info.videoId,
      thumbnail: { thumbnails: info.thumbnails },
      title: { simpleText: info.title },
      subtitle: { simpleText: info.channel },
      menu: { menuRenderer: { items, trackingParams: null, accessibility: { accessibilityData: { label: 'Video options' } } } }
    }
  };
}

/** Adds our entries to the long-press menu of a video tile, in place. */
export function extendLongPressMenu(item) {
  const info = tileInfo(item);
  if (!info) return;

  const command = longPressCommand(info);
  const items = command?.showMenuCommand?.menu?.menuRenderer?.items;
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      if (items[i] && items[i].menuServiceItemRenderer && items[i].menuServiceItemRenderer[MARKER]) return;
    }
    const block = blockChannelItem(info);
    if (block) items.push(block);
    return;
  }

  const panel = feedbackPanel(command);
  if (!panel || !info.title) return;
  const extra = feedbackItems(panel);
  const block = blockChannelItem(info);
  if (block) extra.push(block);
  const menu = buildMenu(info, extra);
  info.holder[info.holderKey] = info.holderKey === 'onLongPress' ? { innertubeCommand: menu } : menu;
}

/* --- The TV client's API, for the feedback ---------------------------- */

function findServiceMap() {
  const yttv = window._yttv;
  if (!yttv) return null;
  for (const key in yttv) {
    const candidate = yttv[key];
    if (candidate && candidate.mappings && typeof candidate.get === 'function') return candidate;
  }
  return null;
}

/** A call to YouTube's API through the TV client, which signs it in itself. */
function innertubeFetch(path, payload) {
  const map = findServiceMap();
  let client = null;
  try { client = map ? map.get('KabukiInnerTubeClient') : null; } catch { client = null; }
  if (!client || typeof client.fetch !== 'function') return Promise.reject(new Error('API client not found'));
  return new Promise((resolve, reject) => {
    client.fetch({ path, payload }).subscribe((res) => resolve(res || {}), reject);
  });
}

function findFeedbackToken(node, depth) {
  if (depth > 32 || !node || typeof node !== 'object') return null;
  if (typeof node.feedbackToken === 'string') return node.feedbackToken;
  for (const key in node) {
    const found = findFeedbackToken(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

// The panel holds the feedback entries in order: "Not interested" first, then
// "Don't recommend channel". Their tokens are read from it and sent.
function sendFeedback(panel, index) {
  return innertubeFetch('/youtubei/v1/get_panel', { panelId: panel.panelId, params: panel.params }).then((res) => {
    const listItems = res?.content?.engagementPanelSectionListRenderer?.content?.listViewModel?.listItems;
    const tokens = [];
    if (Array.isArray(listItems)) {
      for (let i = 0; i < listItems.length; i++) {
        const token = findFeedbackToken(listItems[i] && listItems[i].listItemViewModel, 0);
        if (token) tokens.push(token);
      }
    }
    const token = tokens[index];
    if (!token) throw new Error('no feedback token');
    return innertubeFetch('/youtubei/v1/feedback', { feedbackTokens: [token] });
  }).then(() => {
    showNotification(index === 0 ? 'Not interested: YouTube will show fewer videos like this'
      : 'YouTube will not recommend this channel');
  });
}

/** Adds a channel to Blocked Channels (Filters tab). */
export function blockChannel(name) {
  const channel = String(name || '').trim();
  if (!channel) return;
  const list = configRead('blockedChannels');
  const lower = channel.toLowerCase();
  for (let i = 0; i < list.length; i++) {
    if (String(list[i]).toLowerCase() === lower) {
      showNotification('Already blocked: ' + channel);
      return;
    }
  }
  configWrite('blockedChannels', list.concat([channel]));
  showNotification('Channel blocked: ' + channel);
}

function runAction(custom) {
  const params = custom.params || {};
  if (custom.action === 'blockChannel') {
    blockChannel(params.name);
  } else if (custom.action === 'feedback') {
    const panel = { panelId: String(params.panelId), params: String(params.params) };
    sendFeedback(panel, Number(params.index) || 0).catch((err) => {
      console.warn('[LongPress] Feedback failed:', err);
      showNotification('Feedback not available');
    });
  }
}

function customAction(command) {
  const endpoint = command && command.playlistEditEndpoint;
  return endpoint && typeof endpoint === 'object' ? endpoint[ACTION_KEY] : null;
}

function safeRunAction(custom) {
  try { runAction(custom); }
  catch (err) { console.warn('[LongPress] Action failed:', custom.action, err); }
}

ResolveCommandRegistry.getInstance().then((registry) => {
  registry.setHook('playlistEditEndpoint', (resolveCommand, payload, extra) => {
    const custom = customAction(payload);
    if (!custom) return resolveCommand(payload, extra);
    safeRunAction(custom);
    return true;
  });
  // Newer clients (webOS 25) wrap a menu entry's endpoint, after a
  // CLOSE_POPUP signal, in a commandExecutorCommand, and run its commands
  // without coming back through the hook above: YouTube then gets our
  // endpoint and shows "Something went wrong".
  registry.setHook('commandExecutorCommand', (resolveCommand, payload, extra) => {
    const commands = payload.commandExecutorCommand?.commands;
    if (!Array.isArray(commands) || !commands.some(customAction)) return resolveCommand(payload, extra);
    for (let i = 0; i < commands.length; i++) {
      const custom = customAction(commands[i]);
      if (custom) safeRunAction(custom);
      else resolveCommand(commands[i], extra);
    }
    return true;
  });
}).catch((err) => {
  console.warn('[LongPress] resolveCommand hook not installed:', err);
});
