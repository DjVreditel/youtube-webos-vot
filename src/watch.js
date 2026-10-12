import { configRead, configAddChangeListener, configRemoveChangeListener } from './config';
import { debounce } from './utils';
import './watch.css';

// Intl is supported in Chrome 24+, safe for webOS 3. The date is the locale's
// short form ("Oct 12, 2:05 PM", "okt. 12. 14:05").
const CLOCK_FORMATS = {
  time: { hour: 'numeric', minute: 'numeric' },
  datetime: { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' }
};

class Watch {
  constructor(mode) {
    this._formatter = null;
    // Standard properties
    this._watch = null;
    this._timer = null;
    this._globalListeners = [];
    
    // Constants
    this._PLAYER_SELECTOR = 'ytlr-watch-default'; // Kept specific to this clock feature if needed, or could use SELECTORS.PLAYER_CONTAINER if appropriate.
    this._DEBOUNCE_DELAY = 50;
	this._cachedPlayer = null;
    this._cachedOverlay = null;

    // Bind methods
    this.onOledChange = this.onOledChange.bind(this);
    this.updateVisibility = this.updateVisibility.bind(this);
    
    // Use shared debounce
    this.debouncedUpdate = debounce(this.updateVisibility, this._DEBOUNCE_DELAY);

    // Initialize
    this.createElement();
    this.setMode(mode);
    this.startClock();
    this.setupGlobalListeners();
    
    this.applyOledMode(configRead('enableOledCareMode'));
    configAddChangeListener('enableOledCareMode', this.onOledChange);

    // Initial check
    this.updateVisibility();
  }

  onOledChange(evt) {
    this.applyOledMode(evt.detail.newValue);
  }

  applyOledMode(enabled) {
    if (this._watch) {
      this._watch.classList.toggle('oled-mode', enabled);
    }
  }

  createElement() {
    this._watch = document.createElement('div');
    this._watch.className = 'webOs-watch';
    // Accessibility helper
    this._watch.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this._watch);
  }

  /** Time only, or the date with it; shown at once. */
  setMode(mode) {
    this._formatter = new Intl.DateTimeFormat(navigator.language, CLOCK_FORMATS[mode] || CLOCK_FORMATS.time);
    if (this._watch) this._watch.textContent = this._formatter.format(new Date());
  }

  startClock() {
    const nextSeg = (60 - new Date().getSeconds()) * 1000;

    const setTime = () => {
      if (this._watch) {
        // textContent is faster than innerText
        this._watch.textContent = this._formatter.format(new Date());
        
        // Safety check on the minute mark
        this.updateVisibility();
      }
    };

    setTime();
    setTimeout(() => {
      setTime();
      this._timer = setInterval(setTime, 60000);
    }, nextSeg);
  }

  updateVisibility() {
    if (!this._watch) return;

    if (!this._cachedPlayer || !this._cachedPlayer.isConnected) {
        this._cachedPlayer = document.querySelector(this._PLAYER_SELECTOR);
    }
    
    if (!this._cachedPlayer) {
      if (this._watch.style.display !== 'block') {
         this._watch.style.display = 'block';
      }
      return;
    }

    if (!this._cachedOverlay || !this._cachedOverlay.isConnected) {
        this._cachedOverlay = document.querySelector('.AmQJbe');
    }

    const isHybridFocused = this._cachedPlayer.getAttribute('hybridnavfocusable') === 'true';
    const isPlayerElementActive = document.activeElement === this._cachedPlayer || document.activeElement === document.body;
    const isOverlayActive = !!this._cachedOverlay;

    const shouldHide = isHybridFocused || isPlayerElementActive || isOverlayActive;
    
    const newDisplay = shouldHide ? 'none' : 'block';
    
    if (this._watch.style.display !== newDisplay) {
      this._watch.style.display = newDisplay;
    }
  }

  setupGlobalListeners() {
    this.boundStateChange = (e) => {
      const state = e.detail.state;
      if (state === 1 || state === 2 || state === -1) {
          this.debouncedUpdate();
      }
    };
    window.addEventListener('yt-player-state-change', this.boundStateChange);

    const addListener = (type, handler) => {
      document.addEventListener(type, handler, true);
      this._globalListeners.push({ type, fn: handler });
    };

    // focusin only: a focusout is followed by a focusin in every practical
    // case on this platform, and the callback is debounced at 50ms, so the
    // focusout invocation was always coalesced away. Halves the clock's share
    // of the per-keypress focus traffic.
    addListener('focusin', this.debouncedUpdate);
  }

  destroy() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    
    // Note: Debounce internal timer is managed by closure in shared helper, 
    // so strictly speaking we can't cancel it externally easily unless debounce returns a cancel method.
    // For this use case (UI visibility), letting a pending check run once after destroy is harmless, 
    // but the shared debounce usually doesn't expose cancel.
    // If strict cleanup is needed, update the shared debounce to return { run, cancel }.

    configRemoveChangeListener('enableOledCareMode', this.onOledChange);
    
    if (this.boundStateChange) {
        window.removeEventListener('yt-player-state-change', this.boundStateChange);
    }
    
    this._globalListeners.forEach(l => {
      document.removeEventListener(l.type, l.fn, true);
    });
    this._globalListeners = [];
    
    if (this._watch) {
      this._watch.remove();
      this._watch = null;
    }
  }
}

let watchInstance = null;

/** 'off', 'time' or 'datetime' (clockModes in config.js). */
function applyClockMode(mode) {
  if (mode === 'time' || mode === 'datetime') {
    if (watchInstance) watchInstance.setMode(mode);
    else watchInstance = new Watch(mode);
  } else if (watchInstance) {
    watchInstance.destroy();
    watchInstance = null;
  }
}

applyClockMode(configRead('clockMode'));

configAddChangeListener('clockMode', (evt) => {
  applyClockMode(evt.detail.newValue);
});