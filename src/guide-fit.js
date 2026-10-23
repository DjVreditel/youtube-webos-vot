import './guide-fit.css';
import { configRead, configAddChangeListener } from './config.js';

/**
 * Fit Page Beside Menu: while the guide (left menu) is open, the page is
 * shrunk to fit beside it instead of being pushed off the right edge of the
 * screen (guide-fit.css). Measured, not hard-coded, so a YouTube update that
 * changes the guide's width still fits.
 *
 * Ported from Dazzyelv/youtube-webos-trends (src/guide-fit).
 */

const GAP = 12;
const MIN_SCALE = 0.5;
// On <html>, as an attribute: YouTube rewrites body.className on every navigation.
const OPEN_ATTRIBUTE = 'data-ytaf-guide-open';

// The measured fit, in a style element of ours: YouTube rewrites html's style attribute.
const fitStyle = document.createElement('style');

// The collapsed guide is as wide as the page's left inset; 156 on webOS.
let collapsedWidth = 156;
let wasOpen = false;
let watched = null;

/**
 * The shift and scale (origin top left) that put the page's content, which
 * starts `contentInset` px from its left edge, `gap` px past the guide's
 * right edge, while its right edge stays on the screen.
 */
export function fitBesideGuide(viewWidth, contentInset, guideEdge, gap) {
  const start = guideEdge + gap;
  if (start <= contentInset) return { shift: 0, scale: 1 };
  const scale = Math.max(MIN_SCALE, (viewWidth - start) / (viewWidth - contentInset));
  return { shift: viewWidth * (1 - scale), scale };
}

// The guide's background reaches past its own box; take the widest child.
function rightEdge(guide) {
  let right = guide.getBoundingClientRect().right;
  for (const child of Array.from(guide.children)) {
    right = Math.max(right, child.getBoundingClientRect().right);
  }
  return right;
}

function update(guide) {
  const width = guide.getBoundingClientRect().width;
  const open = configRead('fitPageBesideGuide') && width > collapsedWidth * 1.5;
  const root = document.documentElement;
  if (open) {
    const { shift, scale } = fitBesideGuide(window.innerWidth, collapsedWidth, rightEdge(guide), GAP);
    const vars = `html { --ytaf-guide-shift: ${shift}px; --ytaf-guide-scale: ${scale}; }`;
    if (fitStyle.textContent !== vars) fitStyle.textContent = vars;
    if (!fitStyle.isConnected) document.head.appendChild(fitStyle);
    root.setAttribute(OPEN_ATTRIBUTE, '');
  } else {
    if (width > 0 && width <= collapsedWidth * 1.5) collapsedWidth = width;
    root.removeAttribute(OPEN_ATTRIBUTE);
  }
  if (open !== wasOpen) {
    wasOpen = open;
    // Lets YouTube's lists re-measure, so the rows fill the taller page.
    window.dispatchEvent(new Event('resize'));
  }
}

// The guide appears after start-up and can be re-created; keep watching,
// and re-check now and then in case a navigation reset the page's state.
function watch() {
  const guide = document.querySelector('ytlr-guide-response');
  if (guide && guide !== watched) {
    watched = guide;
    new ResizeObserver(() => update(guide)).observe(guide);
  }
  if (watched) update(watched);
}

if (typeof ResizeObserver === 'function' && typeof document !== 'undefined') {
  watch();
  setInterval(watch, 2000);
  configAddChangeListener('fitPageBesideGuide', watch);
}
