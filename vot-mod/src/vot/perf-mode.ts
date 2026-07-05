import { configRead, configAddChangeListener } from '../config';

// Old TVs (webOS 4.x, Chromium 53, weak GPU) spend most of a focus-move
// repaint on YouTube's CSS animations/transitions — killing them makes the
// remote feel responsive again.
//
// 0.001s instead of 0s: transitionend/animationend do not fire for
// zero-duration effects, and YouTube's UI code waits on those events.
const STYLE_ID = 'ytaf-vot-perf-mode';
const PERF_CSS = `
*, *::before, *::after {
  animation-duration: 0.001s !important;
  animation-delay: 0s !important;
  transition-duration: 0.001s !important;
  transition-delay: 0s !important;
}
html {
  scroll-behavior: auto !important;
}
/* Keep loading spinners animated — a frozen loader looks broken. CSS can't
   restore the original duration on old Chromium (no revert), so use a
   typical 1s spin. */
[class*="spinner" i], [class*="spinner" i] *,
[class*="loader" i], [class*="loader" i] *,
[class*="loading" i] [class*="icon" i] {
  animation-duration: 1s !important;
}
`;

function applyPerfMode(enabled: boolean) {
  const existing = document.getElementById(STYLE_ID);
  if (enabled && !existing) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PERF_CSS;
    document.head.appendChild(style);
  } else if (!enabled && existing) {
    existing.remove();
  }
}

export function initPerfMode() {
  applyPerfMode(!!configRead('votPerfMode'));
  configAddChangeListener('votPerfMode', (evt: Event) => {
    const detail = (evt as CustomEvent<{ newValue: unknown }>).detail;
    applyPerfMode(!!detail.newValue);
  });
}
