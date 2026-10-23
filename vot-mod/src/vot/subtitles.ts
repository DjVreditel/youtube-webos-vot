import { configRead, configAddChangeListener } from '../config';
import { getPlayerManager } from './player';
import { getYandexSubtitles } from './client';
import type { YandexSubtitleTrack } from './client';
import { isSourceLang, isTargetLang } from './langs';
import { videoAudioLanguage } from './translation';
import { findLineAt, splitLine } from './subtitle-core';

type SubtitleLine = { text: string; startMs: number; durationMs: number };

export type SubtitlesMode = 'off' | 'translated' | 'original';

export const SUBTITLE_MODES: [SubtitlesMode, string][] = [
  ['off', 'Выкл'],
  ['translated', 'Переведённые'],
  ['original', 'Оригинальные']
];

const MAX_CHARS = 80;
const RETRY_MS = 20_000;
const MAX_ATTEMPTS = 15;

let overlay: HTMLDivElement | null = null;
let lines: SubtitleLine[] = [];
let video: HTMLVideoElement | null = null;
let abortController: AbortController | null = null;
let shownText = '';
let status = '';
let statusListener: (() => void) | null = null;

export function subtitlesStatus(): string {
  return status;
}

export function onSubtitlesStatus(listener: () => void) {
  statusListener = listener;
}

function setStatus(next: string) {
  status = next;
  statusListener?.();
}

function ensureOverlay(): HTMLDivElement {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'ytaf-vot-subtitles';
  }
  if (!document.body.contains(overlay)) document.body.appendChild(overlay);
  return overlay;
}

function onTimeUpdate() {
  if (!video) return;
  const text = findLineAt(lines, video.currentTime * 1000)?.text ?? '';
  if (text === shownText) return;
  shownText = text;
  const el = ensureOverlay();
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

function clearSubtitles() {
  abortController?.abort();
  abortController = null;
  video?.removeEventListener('timeupdate', onTimeUpdate);
  video = null;
  lines = [];
  shownText = '';
  if (overlay) overlay.style.display = 'none';
}

function pickTrack(
  tracks: YandexSubtitleTrack[],
  mode: SubtitlesMode,
  toLang: string
): string | null {
  if (mode === 'translated') {
    const translated = tracks.find((t) => t.translatedLanguage === toLang && t.translatedUrl);
    if (translated) return translated.translatedUrl;
    return tracks.find((t) => t.language === toLang && t.url)?.url ?? null;
  }
  return tracks.find((t) => t.url)?.url ?? null;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function loadSubtitles(videoId: string, audioLang: string) {
  clearSubtitles();
  const mode = configRead('votSubtitles') as SubtitlesMode;
  if (mode === 'off') {
    setStatus('');
    return;
  }

  const controller = new AbortController();
  abortController = controller;
  const { signal } = controller;
  const chosenFrom = String(configRead('votFromLang'));
  const fromLang = isSourceLang(chosenFrom) && chosenFrom !== 'auto'
    ? chosenFrom
    : isSourceLang(audioLang) ? audioLang : 'auto';
  const configuredTo = String(configRead('votToLang'));
  const toLang = isTargetLang(configuredTo) ? configuredTo : 'ru';

  try {
    setStatus('загрузка…');
    let url: string | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !signal.aborted; attempt++) {
      const res = await getYandexSubtitles(videoId, fromLang, signal);
      url = pickTrack(res.tracks, mode, toLang);
      if (url || !res.waiting) break;
      setStatus('готовятся…');
      await wait(RETRY_MS, signal);
    }
    if (signal.aborted) return;
    if (!url) {
      setStatus('нет для этого видео');
      return;
    }

    const res = await fetch(url, { signal });
    const data = (await res.json()) as { subtitles?: SubtitleLine[] };
    if (signal.aborted) return;
    lines = (data.subtitles ?? [])
      .filter((l) => l && typeof l.text === 'string')
      .map((l) => ({ text: l.text, startMs: l.startMs, durationMs: l.durationMs }))
      .sort((a, b) => a.startMs - b.startMs)
      .reduce<SubtitleLine[]>((all, l) => all.concat(splitLine(l, MAX_CHARS)), []);
    video = document.querySelector('video');
    video?.addEventListener('timeupdate', onTimeUpdate);
    onTimeUpdate();
    setStatus(lines.length ? '' : 'нет для этого видео');
  } catch (err) {
    if (signal.aborted) return;
    console.warn('[VOT] subtitles failed:', err);
    setStatus('ошибка');
  }
}

let currentVideoId: string | null = null;

async function reload() {
  const manager = await getPlayerManager();
  currentVideoId = manager.currentVideoID;
  if (currentVideoId) await loadSubtitles(currentVideoId, videoAudioLanguage(manager));
  else clearSubtitles();
}

export async function initVotSubtitles() {
  const manager = await getPlayerManager();
  manager.addEventListener('newVideo', (evt) => {
    if (evt.detail === currentVideoId) return;
    currentVideoId = evt.detail;
    void loadSubtitles(evt.detail, videoAudioLanguage(manager));
  });
  manager.addEventListener('noVideo', () => {
    currentVideoId = null;
    clearSubtitles();
  });
  for (const key of ['votSubtitles', 'votFromLang', 'votToLang']) {
    configAddChangeListener(key, () => void reload());
  }
}
