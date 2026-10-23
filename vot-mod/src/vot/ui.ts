import './vot.css';
import { configRead, configWrite } from '../config';
import {
  startTranslation,
  stopTranslation,
  isTranslationActive,
  isTranslationInProgress,
  setVolumeTranslation,
  setOriginalVolumeReduction,
  setStatusCallback,
  setManuallyStopped
} from './translation';
import { getPlayerManager } from './player';
import {
  isAuthServerConfigured,
  startDeviceAuth,
  waitForDeviceToken,
  qrImageUrl
} from './auth';
import type { VotTranslationStatus } from './types';
import { SOURCE_LANGS, TARGET_LANGS } from './langs';
import { SUBTITLE_MODES, onSubtitlesStatus, subtitlesStatus } from './subtitles';

const KEY_LEFT = 37;
const KEY_UP = 38;
const KEY_RIGHT = 39;
const KEY_DOWN = 40;
const KEY_ENTER = 13;
const BACK_KEYS = [27, 461, 8];

const AUTO_HIDE_MS = 4000;
const ERROR_HIDE_MS = 10000;

const LANG_NAMES_RU: Record<string, string> = {
  auto: 'Авто',
  ru: 'Русский',
  en: 'Английский',
  zh: 'Китайский',
  ko: 'Корейский',
  ar: 'Арабский',
  fr: 'Французский',
  it: 'Итальянский',
  es: 'Испанский',
  de: 'Немецкий',
  ja: 'Японский',
  kk: 'Казахский'
};

type MenuRow = {
  label: string;
  value: () => string;
  change?: (step: number) => void;
  activate?: () => void;
};

let root: HTMLDivElement | null = null;
let bar: HTMLDivElement | null = null;
let mainBtn: HTMLButtonElement | null = null;
let mainLabel: HTMLSpanElement | null = null;
let voiceBtn: HTMLButtonElement | null = null;
let menuBtn: HTMLButtonElement | null = null;
let ccBtn: HTMLButtonElement | null = null;
let menu: HTMLDivElement | null = null;
let menuRows: { row: MenuRow; el: HTMLDivElement; valueEl: HTMLSpanElement }[] = [];

let visible = false;
let focused = false;
let menuOpen = false;
let menuIndex = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let focusBeforeOpen: HTMLElement | null = null;
let lastStatus: VotTranslationStatus = 'idle';
let lastMessage = '';

function langName(code: string): string {
  return LANG_NAMES_RU[code] ?? code;
}

function cycle(options: [string, string][], current: string, step: number): string {
  const idx = Math.max(0, options.findIndex(([c]) => c === current));
  return options[(idx + step + options.length) % options.length]![0];
}

function stepVolume(key: string, step: number, apply: (v: number) => void) {
  const next = Math.min(1, Math.max(0, Math.round((configRead(key) + step * 0.1) * 10) / 10));
  configWrite(key, next);
  apply(next);
}

function livelyAvailable(): boolean {
  return configRead('votToLang') === 'ru';
}

function voiceText(): string {
  if (!livelyAvailable()) return 'Обычный';
  return configRead('votLivelyVoice') ? 'Живой' : 'Обычный';
}

function subtitlesText(): string {
  const mode = String(configRead('votSubtitles'));
  const name = SUBTITLE_MODES.find(([m]) => m === mode)?.[1] ?? 'Выкл';
  const extra = mode !== 'off' ? subtitlesStatus() : '';
  return extra ? `${name} (${extra})` : name;
}

function cycleSubtitles(step: number) {
  configWrite('votSubtitles', cycle(SUBTITLE_MODES, String(configRead('votSubtitles')), step));
  render();
}

function isBusy(): boolean {
  return isTranslationActive() || isTranslationInProgress();
}

function statusLabel(status: VotTranslationStatus, message: string): string {
  switch (status) {
    case 'loading':
      return 'Перевод…';
    case 'retrying':
      return 'Обработка…';
    case 'waiting': {
      const upload = /^upload (\d+)\/(\d+)$/.exec(message);
      if (upload) return `Загрузка аудио ${upload[1]}/${upload[2]}`;
      const download = /^download (\d+)%$/.exec(message);
      if (download) return `Скачивание аудио ${download[1]}%`;
      const eta = /^~(\d+)s$/.exec(message);
      if (eta) {
        const seconds = Number(eta[1]);
        return seconds >= 90
          ? `Перевод через ~${Math.round(seconds / 60)} мин`
          : `Перевод через ~${seconds} с`;
      }
      if (message.startsWith('lively')) return 'Живой голос недоступен, обычный…';
      return 'Перевод…';
    }
    case 'playing':
      return 'Выключить перевод';
    case 'error':
      return message ? `Ошибка: ${message}` : 'Ошибка перевода';
    default:
      return 'Перевести видео';
  }
}

function render() {
  if (!bar || !mainLabel || !voiceBtn) return;
  bar.className = `ytaf-vot-bar ytaf-vot-bar--${lastStatus}`;
  mainLabel.textContent = statusLabel(lastStatus, lastMessage);
  voiceBtn.textContent = voiceText();
  if (ccBtn) ccBtn.classList.toggle('ytaf-vot-seg--on', configRead('votSubtitles') !== 'off');
  for (const { row, valueEl } of menuRows) valueEl.textContent = row.value();
}

function clearHideTimer() {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide() {
  clearHideTimer();
  if (menuOpen) return;
  hideTimer = setTimeout(
    () => setVisible(false),
    lastStatus === 'error' ? ERROR_HIDE_MS : AUTO_HIDE_MS
  );
}

function setVisible(next: boolean, takeFocus = false) {
  if (!root) return;
  if (!document.body.contains(root)) document.body.appendChild(root);
  visible = next;
  root.style.display = next ? 'block' : 'none';
  if (!next) {
    clearHideTimer();
    setMenuOpen(false);
    if (focused) {
      focused = false;
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (focusBeforeOpen && document.body.contains(focusBeforeOpen)) focusBeforeOpen.focus();
      focusBeforeOpen = null;
    }
    return;
  }
  if (takeFocus) {
    if (!focused) {
      const active = document.activeElement as HTMLElement | null;
      focusBeforeOpen = active && !root.contains(active) ? active : null;
    }
    focused = true;
    mainBtn?.focus();
    setTimeout(() => {
      if (focused && root && !root.contains(document.activeElement)) mainBtn?.focus();
    }, 100);
  }
  scheduleHide();
}

function setMenuOpen(next: boolean) {
  if (!menu) return;
  menuOpen = next;
  menu.style.display = next ? 'block' : 'none';
  if (next) {
    clearHideTimer();
    menuIndex = 0;
    focusMenuRow();
  } else if (focused) {
    mainBtn?.focus();
  }
}

function focusMenuRow() {
  menuRows.forEach(({ el }, i) => el.classList.toggle('ytaf-vot-row--focused', i === menuIndex));
  menuRows[menuIndex]?.el.focus();
}

async function restartIfRunning() {
  if (!isBusy()) return;
  const manager = await getPlayerManager();
  const videoId = manager.currentVideoID;
  await stopTranslation();
  if (videoId) {
    setManuallyStopped(null);
    await startTranslation(videoId);
  }
}

async function toggleTranslation() {
  try {
    if (isBusy()) {
      const manager = await getPlayerManager();
      setManuallyStopped(manager.currentVideoID);
      await stopTranslation();
      return;
    }
    setManuallyStopped(null);
    onStatus('loading');
    const manager = await Promise.race([
      getPlayerManager(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('плеер не отвечает')), 5000)
      )
    ]);
    const videoId = manager.currentVideoID;
    if (!videoId) {
      onStatus('error', 'видео не открыто');
      return;
    }
    await startTranslation(videoId);
  } catch (err) {
    onStatus('error', err instanceof Error ? err.message : String(err));
  }
}

function toggleVoice() {
  if (!livelyAvailable()) return;
  configWrite('votLivelyVoice', !configRead('votLivelyVoice'));
  render();
  void restartIfRunning();
}

function buildMenuRows(): MenuRow[] {
  const rows: MenuRow[] = [
    {
      label: 'Язык видео',
      value: () => langName(configRead('votFromLang')),
      change: (step) => {
        configWrite('votFromLang', cycle(SOURCE_LANGS, configRead('votFromLang'), step));
        void restartIfRunning();
      }
    },
    {
      label: 'Язык перевода',
      value: () => langName(configRead('votToLang')),
      change: (step) => {
        configWrite('votToLang', cycle(TARGET_LANGS, configRead('votToLang'), step));
        void restartIfRunning();
      }
    },
    {
      label: 'Голос',
      value: () => (livelyAvailable() ? voiceText() : 'Обычный (живой — только на русский)'),
      change: () => toggleVoice(),
      activate: () => toggleVoice()
    },
    {
      label: 'Субтитры',
      value: subtitlesText,
      change: (step) => cycleSubtitles(step),
      activate: () => cycleSubtitles(1)
    },
    {
      label: 'Громкость перевода',
      value: () => `${Math.round(configRead('votTranslationVolume') * 100)}%`,
      change: (step) => stepVolume('votTranslationVolume', step, setVolumeTranslation)
    },
    {
      label: 'Громкость видео',
      value: () => `${Math.round(configRead('votOriginalVolume') * 100)}%`,
      change: (step) => stepVolume('votOriginalVolume', step, setOriginalVolumeReduction)
    },
    {
      label: 'Переводить автоматически',
      value: () => (configRead('enableVot') ? 'Вкл' : 'Выкл'),
      change: () => configWrite('enableVot', !configRead('enableVot')),
      activate: () => configWrite('enableVot', !configRead('enableVot'))
    }
  ];
  if (isAuthServerConfigured()) {
    rows.push({
      label: 'Аккаунт Яндекса',
      value: () => (configRead('votAccountToken') ? 'Войти заново (QR)' : 'Войти (QR)'),
      activate: () => void runQrLogin(render)
    });
  }
  return rows;
}

function onKey(evt: KeyboardEvent) {
  const code = evt.keyCode;
  const handled = [KEY_LEFT, KEY_UP, KEY_RIGHT, KEY_DOWN, KEY_ENTER, ...BACK_KEYS].includes(code);
  if (!handled) return;
  evt.preventDefault();
  evt.stopPropagation();
  clearHideTimer();

  if (menuOpen) {
    const current = menuRows[menuIndex];
    if (code === KEY_UP || code === KEY_DOWN) {
      menuIndex = (menuIndex + (code === KEY_DOWN ? 1 : -1) + menuRows.length) % menuRows.length;
      focusMenuRow();
    } else if (code === KEY_LEFT || code === KEY_RIGHT) {
      current?.row.change?.(code === KEY_RIGHT ? 1 : -1);
    } else if (code === KEY_ENTER) {
      (current?.row.activate ?? (() => current?.row.change?.(1)))();
    } else {
      setMenuOpen(false);
    }
    render();
    return;
  }

  const segments = [mainBtn, voiceBtn, ccBtn, menuBtn].filter(Boolean) as HTMLElement[];
  const at = Math.max(0, segments.indexOf(document.activeElement as HTMLElement));
  if (code === KEY_LEFT || code === KEY_RIGHT) {
    segments[(at + (code === KEY_RIGHT ? 1 : -1) + segments.length) % segments.length]?.focus();
  } else if (code === KEY_DOWN) {
    setMenuOpen(true);
  } else if (code === KEY_ENTER) {
    (document.activeElement as HTMLElement | null)?.click?.();
  } else if (code !== KEY_UP) {
    setVisible(false);
    return;
  }
  scheduleHide();
}

function onStatus(status: VotTranslationStatus, message?: string) {
  const changed = status !== lastStatus;
  lastStatus = status;
  lastMessage = message ?? '';
  render();
  if (changed && status !== 'idle') setVisible(true, focused);
}

function createSegment(className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `ytaf-vot-seg ${className}`;
  btn.addEventListener('click', onClick);
  return btn;
}

function createUi(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'ytaf-vot-root';
  container.style.display = 'none';

  bar = document.createElement('div');
  bar.className = 'ytaf-vot-bar ytaf-vot-bar--idle';

  mainBtn = createSegment('ytaf-vot-seg--main', () => void toggleTranslation());
  const icon = document.createElement('span');
  icon.className = 'ytaf-vot-icon';
  icon.textContent = '文A';
  mainLabel = document.createElement('span');
  mainBtn.appendChild(icon);
  mainBtn.appendChild(mainLabel);

  voiceBtn = createSegment('ytaf-vot-seg--voice', toggleVoice);
  ccBtn = createSegment('ytaf-vot-seg--cc', () => cycleSubtitles(1));
  ccBtn.textContent = 'CC';
  menuBtn = createSegment('ytaf-vot-seg--menu', () => setMenuOpen(!menuOpen));
  menuBtn.textContent = '⋮';

  bar.appendChild(mainBtn);
  bar.appendChild(voiceBtn);
  bar.appendChild(ccBtn);
  bar.appendChild(menuBtn);
  container.appendChild(bar);

  menu = document.createElement('div');
  menu.className = 'ytaf-vot-menu';
  menu.style.display = 'none';
  const title = document.createElement('div');
  title.className = 'ytaf-vot-menu-title';
  title.textContent = 'Настройки перевода';
  menu.appendChild(title);
  menuRows = buildMenuRows().map((row) => {
    const el = document.createElement('div');
    el.className = 'ytaf-vot-row';
    el.setAttribute('tabindex', '-1');
    const labelEl = document.createElement('span');
    labelEl.className = 'ytaf-vot-row-label';
    labelEl.textContent = row.label;
    const valueEl = document.createElement('span');
    valueEl.className = 'ytaf-vot-row-value';
    el.appendChild(labelEl);
    el.appendChild(valueEl);
    menu!.appendChild(el);
    return { row, el, valueEl };
  });
  container.appendChild(menu);

  container.addEventListener('keydown', onKey, true);
  container.addEventListener('focusout', (evt) => {
    if (!focused || qrOverlay) return;
    const to = evt.relatedTarget as Node | null;
    if (to && container.contains(to)) return;
    setTimeout(() => {
      if (focused && !qrOverlay && root && !root.contains(document.activeElement)) {
        (menuOpen ? menuRows[menuIndex]?.el : mainBtn)?.focus();
      }
    }, 0);
  });

  setStatusCallback(onStatus);
  onSubtitlesStatus(render);
  return container;
}

let qrOverlay: HTMLDivElement | null = null;
let qrCancelled = false;

function closeQrOverlay() {
  qrCancelled = true;
  if (qrOverlay && qrOverlay.parentNode) {
    qrOverlay.parentNode.removeChild(qrOverlay);
  }
  qrOverlay = null;
  if (focused) menuRows[menuIndex]?.el.focus();
}

async function runQrLogin(onDone: () => void) {
  if (qrOverlay) return;
  qrCancelled = false;

  const overlay = document.createElement('div');
  overlay.className = 'ytaf-vot-qr-overlay';
  overlay.setAttribute('tabindex', '0');
  qrOverlay = overlay;

  const box = document.createElement('div');
  box.className = 'ytaf-vot-qr-box';
  overlay.appendChild(box);

  const title = document.createElement('div');
  title.className = 'ytaf-vot-qr-title';
  title.textContent = 'Вход в Яндекс';
  box.appendChild(title);

  const info = document.createElement('div');
  info.className = 'ytaf-vot-qr-info';
  info.textContent = 'Подготовка…';
  box.appendChild(info);

  overlay.addEventListener(
    'keydown',
    (evt) => {
      const code = evt.keyCode;
      if (BACK_KEYS.includes(code) || code === KEY_ENTER) {
        evt.preventDefault();
        evt.stopPropagation();
        closeQrOverlay();
      }
    },
    true
  );

  document.body.appendChild(overlay);
  overlay.focus();

  try {
    const start = await startDeviceAuth();

    const img = document.createElement('img');
    img.className = 'ytaf-vot-qr-img';
    img.src = qrImageUrl(start.verification_url);
    box.insertBefore(img, info);

    const codeEl = document.createElement('div');
    codeEl.className = 'ytaf-vot-qr-code';
    codeEl.textContent = start.user_code;
    box.insertBefore(codeEl, info);

    info.innerHTML =
      `Отсканируйте QR или откройте<br><b>${start.verification_url}</b><br>` +
      'на телефоне и введите код выше.';

    const token = await waitForDeviceToken(
      start.device_code,
      start.interval,
      start.expires_in,
      (left) => {
        if (!qrCancelled)
          info.innerHTML = `Ждём подтверждения… ${left} с<br>Код: <b>${start.user_code}</b>`;
      },
      () => qrCancelled
    );

    if (qrCancelled) return;

    if (token) {
      info.textContent = 'Готово! Живой голос доступен.';
      onDone();
      setTimeout(closeQrOverlay, 1500);
    } else {
      info.textContent = 'Время ожидания истекло. Попробуйте ещё раз.';
      setTimeout(closeQrOverlay, 2500);
    }
  } catch (err) {
    info.textContent =
      'Не удалось войти: ' + (err instanceof Error ? err.message : String(err));
    setTimeout(closeQrOverlay, 3000);
  }
}

export function isVotUiFocused(): boolean {
  return visible && focused;
}

export function showVotPanel(show?: boolean): string {
  if (!root) {
    root = createUi();
    document.body.appendChild(root);
  }
  const next = show ?? !(visible && focused);
  render();
  setVisible(next, next);
  return next ? 'opened' : 'closed';
}

let votPanelInitialized = false;

export function initVotPanel() {
  if (votPanelInitialized) return;
  votPanelInitialized = true;

  root = createUi();
  document.body.appendChild(root);
  render();
}
