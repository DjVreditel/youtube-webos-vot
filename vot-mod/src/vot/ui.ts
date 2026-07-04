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
import { getPlayerManager } from '../player_api';
import type { VotTranslationStatus } from './types';

declare const navigate: (direction: string) => void;

const ARROW_KEY_CODE: Record<number, string> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down'
};

const SUPPORTED_LANGS: [string, string][] = [
  ['ar', 'Arabic'],
  ['be', 'Belarusian'],
  ['bg', 'Bulgarian'],
  ['zh', 'Chinese'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['nl', 'Dutch'],
  ['en', 'English'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['hu', 'Hungarian'],
  ['id', 'Indonesian'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['kk', 'Kazakh'],
  ['ko', 'Korean'],
  ['nb', 'Norwegian'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['ro', 'Romanian'],
  ['ru', 'Russian'],
  ['sk', 'Slovak'],
  ['es', 'Spanish'],
  ['sv', 'Swedish'],
  ['th', 'Thai'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['uz', 'Uzbek'],
  ['vi', 'Vietnamese']
];

const SOURCE_LANGS: [string, string][] = [['auto', 'Auto'], ...SUPPORTED_LANGS];

const STATUS_TEXT: Record<VotTranslationStatus, string> = {
  idle: 'Off',
  loading: 'Loading...',
  waiting: 'Waiting...',
  retrying: 'Processing...',
  playing: 'Active',
  error: 'Error'
};

function createLangPicker(
  options: [string, string][],
  currentValue: string,
  onChange: (value: string) => void
): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'ytaf-vot-lang-picker';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'ytaf-vot-btn ytaf-vot-btn--icon';
  prevBtn.textContent = '‹';

  const display = document.createElement('span');
  display.className = 'ytaf-vot-lang-display';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'ytaf-vot-btn ytaf-vot-btn--icon';
  nextBtn.textContent = '›';

  let idx = options.findIndex(([v]) => v === currentValue);
  if (idx < 0) idx = 0;
  display.textContent = options[idx]?.[1] ?? '';

  const update = () => {
    display.textContent = options[idx]?.[1] ?? '';
    onChange(options[idx]![0]);
  };

  prevBtn.addEventListener('click', () => {
    idx = (idx - 1 + options.length) % options.length;
    update();
  });

  nextBtn.addEventListener('click', () => {
    idx = (idx + 1) % options.length;
    update();
  });

  wrapper.appendChild(prevBtn);
  wrapper.appendChild(display);
  wrapper.appendChild(nextBtn);
  return wrapper;
}

function createRow(labelText: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'ytaf-vot-panel-row';

  const label = document.createElement('span');
  label.className = 'ytaf-vot-panel-label';
  label.textContent = labelText;

  row.appendChild(label);
  row.appendChild(control);
  return row;
}

let panelVisible = false;
let panel: HTMLDivElement | null = null;
let statusEl: HTMLSpanElement | null = null;
let statusMsgEl: HTMLDivElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let autoStartBtn: HTMLButtonElement | null = null;
let volumeDisplay: HTMLSpanElement | null = null;
let origVolumeDisplay: HTMLSpanElement | null = null;

function updateStatusDisplay(status: VotTranslationStatus, message?: string) {
  if (!statusEl || !statusMsgEl || !toggleBtn) return;

  statusEl.textContent =
    status === 'waiting' && message
      ? `Waiting ${message}`
      : STATUS_TEXT[status];
  statusEl.className = `ytaf-vot-status ytaf-vot-status--${status}`;
  statusMsgEl.textContent = status === 'error' ? (message ?? '') : '';

  const active =
    status === 'playing' ||
    status === 'loading' ||
    status === 'waiting' ||
    status === 'retrying';
  toggleBtn.textContent = active ? 'Stop' : 'Start';
}

function createPanel(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'ytaf-vot-panel';
  container.style.display = 'none';
  container.setAttribute('tabindex', '0');

  // The YouTube app steals focus back from the panel; while the panel is
  // visible, pull focus back unless it moved to one of our own controls
  container.addEventListener('focusout', (evt) => {
    if (!panelVisible) return;
    const to = evt.relatedTarget as Node | null;
    if (to && container.contains(to)) return;
    setTimeout(() => {
      if (panelVisible && !container.contains(document.activeElement)) {
        container.focus();
      }
    }, 0);
  });

  const heading = document.createElement('h2');
  heading.textContent = 'VOT Translation';
  container.appendChild(heading);

  statusEl = document.createElement('span');
  statusEl.className = 'ytaf-vot-status ytaf-vot-status--idle';
  statusEl.textContent = STATUS_TEXT.idle;
  container.appendChild(createRow('Status:', statusEl));

  toggleBtn = document.createElement('button');
  toggleBtn.className = 'ytaf-vot-btn';
  toggleBtn.textContent = isTranslationActive() ? 'Stop' : 'Start';
  container.appendChild(createRow('Translation:', toggleBtn));

  const autoStartEnabled = configRead('enableVot');
  autoStartBtn = document.createElement('button');
  autoStartBtn.className = `ytaf-vot-btn${autoStartEnabled ? ' ytaf-vot-btn--active' : ''}`;
  autoStartBtn.textContent = autoStartEnabled ? 'On' : 'Off';
  container.appendChild(createRow('Auto-start:', autoStartBtn));

  // Experimental: works anonymously only if the server allows it (upstream
  // gates lively voice behind a Yandex account); falls back automatically
  const livelyEnabled = configRead('votLivelyVoice');
  const livelyBtn = document.createElement('button');
  livelyBtn.className = `ytaf-vot-btn${livelyEnabled ? ' ytaf-vot-btn--active' : ''}`;
  livelyBtn.textContent = livelyEnabled ? 'On' : 'Off';
  livelyBtn.addEventListener('click', () => {
    const next = !configRead('votLivelyVoice');
    configWrite('votLivelyVoice', next);
    livelyBtn.className = `ytaf-vot-btn${next ? ' ytaf-vot-btn--active' : ''}`;
    livelyBtn.textContent = next ? 'On' : 'Off';
  });
  container.appendChild(createRow('Live voice:', livelyBtn));

  const fromPicker = createLangPicker(
    SOURCE_LANGS,
    configRead('votFromLang'),
    (val) => {
      configWrite('votFromLang', val);
    }
  );
  container.appendChild(createRow('From:', fromPicker));

  const toPicker = createLangPicker(
    SUPPORTED_LANGS,
    configRead('votToLang'),
    (val) => {
      configWrite('votToLang', val);
    }
  );
  container.appendChild(createRow('To:', toPicker));

  const currentVolume = Math.round(configRead('votTranslationVolume') * 100);
  volumeDisplay = document.createElement('span');
  volumeDisplay.className = 'ytaf-vot-volume-display';
  volumeDisplay.textContent = `${currentVolume}%`;

  const volRow = document.createElement('div');
  volRow.className = 'ytaf-vot-panel-row';

  const volLabel = document.createElement('span');
  volLabel.className = 'ytaf-vot-panel-label';
  volLabel.textContent = 'Volume:';

  const volDownBtn = document.createElement('button');
  volDownBtn.className = 'ytaf-vot-btn';
  volDownBtn.textContent = '−';

  const volUpBtn = document.createElement('button');
  volUpBtn.className = 'ytaf-vot-btn';
  volUpBtn.textContent = '+';

  volRow.appendChild(volLabel);
  volRow.appendChild(volDownBtn);
  volRow.appendChild(volumeDisplay);
  volRow.appendChild(volUpBtn);
  container.appendChild(volRow);

  const currentOrigVol = Math.round(configRead('votOriginalVolume') * 100);
  origVolumeDisplay = document.createElement('span');
  origVolumeDisplay.className = 'ytaf-vot-volume-display';
  origVolumeDisplay.textContent = `${currentOrigVol}%`;

  const origVolRow = document.createElement('div');
  origVolRow.className = 'ytaf-vot-panel-row';

  const origVolLabel = document.createElement('span');
  origVolLabel.className = 'ytaf-vot-panel-label';
  origVolLabel.textContent = 'Orig. vol:';

  const origVolDownBtn = document.createElement('button');
  origVolDownBtn.className = 'ytaf-vot-btn';
  origVolDownBtn.textContent = '−';

  const origVolUpBtn = document.createElement('button');
  origVolUpBtn.className = 'ytaf-vot-btn';
  origVolUpBtn.textContent = '+';

  origVolRow.appendChild(origVolLabel);
  origVolRow.appendChild(origVolDownBtn);
  origVolRow.appendChild(origVolumeDisplay);
  origVolRow.appendChild(origVolUpBtn);
  container.appendChild(origVolRow);

  statusMsgEl = document.createElement('div');
  statusMsgEl.className = 'ytaf-vot-status-msg';
  container.appendChild(statusMsgEl);

  setStatusCallback((status, message) => updateStatusDisplay(status, message));

  toggleBtn.addEventListener('click', async () => {
    // Every failure path must surface in the Status row — a silent return
    // here reads as "the button does nothing" on a TV with no console
    try {
      if (isTranslationActive() || isTranslationInProgress()) {
        const manager = await getPlayerManager();
        setManuallyStopped(manager.currentVideoID);
        await stopTranslation();
        return;
      }
      setManuallyStopped(null);
      updateStatusDisplay('loading');
      const manager = await Promise.race([
        getPlayerManager(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Player API timeout')), 5000)
        )
      ]);
      const videoId = manager.currentVideoID;
      if (!videoId) {
        updateStatusDisplay('error', 'No video is open');
        return;
      }
      await startTranslation(videoId);
    } catch (err) {
      updateStatusDisplay(
        'error',
        err instanceof Error ? err.message : String(err)
      );
    }
  });

  autoStartBtn.addEventListener('click', () => {
    const next = !configRead('enableVot');
    configWrite('enableVot', next);
    if (autoStartBtn) {
      autoStartBtn.className = `ytaf-vot-btn${next ? ' ytaf-vot-btn--active' : ''}`;
      autoStartBtn.textContent = next ? 'On' : 'Off';
    }
  });

  const changeVolume = (delta: number) => {
    const current = configRead('votTranslationVolume');
    const next = Math.min(
      1,
      Math.max(0, Math.round((current + delta) * 10) / 10)
    );
    configWrite('votTranslationVolume', next);
    setVolumeTranslation(next);
    if (volumeDisplay) {
      volumeDisplay.textContent = `${Math.round(next * 100)}%`;
    }
  };

  volDownBtn.addEventListener('click', () => changeVolume(-0.1));
  volUpBtn.addEventListener('click', () => changeVolume(0.1));

  const changeOrigVolume = (delta: number) => {
    const current = configRead('votOriginalVolume');
    const next = Math.min(
      1,
      Math.max(0, Math.round((current + delta) * 10) / 10)
    );
    configWrite('votOriginalVolume', next);
    setOriginalVolumeReduction(next);
    if (origVolumeDisplay) {
      origVolumeDisplay.textContent = `${Math.round(next * 100)}%`;
    }
  };

  origVolDownBtn.addEventListener('click', () => changeOrigVolume(-0.1));
  origVolUpBtn.addEventListener('click', () => changeOrigVolume(0.1));

  container.addEventListener(
    'keydown',
    (evt) => {
      const code = evt.keyCode;
      const direction = ARROW_KEY_CODE[code];
      if (direction) {
        navigate(direction);
      } else if (code === 13) {
        (document.activeElement as HTMLElement).click?.();
      } else if (code === 27) {
        showVotPanel(false);
      }
      evt.preventDefault();
      evt.stopPropagation();
    },
    true
  );

  return container;
}

// Returns a status string — surfaced as a debug toast by the patched
// upstream ui.js when votShowKeyCodes is enabled
export function showVotPanel(visible?: boolean): string {
  visible ??= !panelVisible;

  let state = '';
  if (!panel) {
    panel = createPanel();
    document.body.appendChild(panel);
    state = 'late-init ';
  } else if (!document.body.contains(panel)) {
    // The YouTube app re-rendered body and detached our node
    document.body.appendChild(panel);
    state = 'reattached ';
  }

  if (visible && !panelVisible) {
    panelVisible = true;
    panel.style.display = 'block';
    panel.focus();
    // The YouTube app may re-grab focus right after we open — take it back
    setTimeout(() => {
      if (panelVisible && panel && !panel.contains(document.activeElement)) {
        panel.focus();
      }
    }, 100);
    return state + 'opened';
  } else if (!visible && panelVisible) {
    // Flag first: the focusout handler must not fight the deliberate blur
    panelVisible = false;
    panel.style.display = 'none';
    panel.blur();
    return state + 'closed';
  }
  return state + 'no-op';
}

let votPanelInitialized = false;

// The RED button itself is handled by the patched upstream ui.js event
// handler (same code path as the GREEN settings button) — see patch.cjs.
export function initVotPanel() {
  if (votPanelInitialized) return;
  votPanelInitialized = true;

  panel = createPanel();
  document.body.appendChild(panel);
}
