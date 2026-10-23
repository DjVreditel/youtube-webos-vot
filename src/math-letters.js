// Fancy "font" channel names and titles (𝐁𝐨𝐥𝐝, 𝓢𝓬𝓻𝓲𝓹𝓽, 𝕯𝖔𝖚𝖇𝖑𝖊...) are
// Mathematical Alphanumeric Symbols, U+1D400-1D7FF. No webOS system font has
// glyphs for them, so they render as empty boxes (NicholasBly/youtube-webos#122).
// The only fix this mod had was the Noto Sans Math web font in emoji-font.css,
// which the modern build leaves out and which only applies with the legacy
// emoji fix on webOS 3/4.
//
// Rather than ship a font, each such character is replaced by its plain
// letter or digit (its NFKC compatibility form: 𝐁 -> B). That needs no
// network, no font-family override of YouTube's text (whose selectors drift),
// and works on every webOS version and both builds. Only this block is
// touched - a whole-string NFKC would also rewrite ligatures, full-width
// letters, superscripts and the like that do render.
//
// Every character of the block is a surrogate pair led by U+D835, so one
// indexOf rejects the plain text that makes up nearly every mutation.

const LEAD = '\uD835';
const MATH_CHAR_RE = /\uD835[\uDC00-\uDFFF]/g;
const canNormalize = typeof String.prototype.normalize === 'function';

const toPlain = (ch) => {
  const plain = ch.normalize('NFKC');
  // A reserved code point (there are a few holes in the block) stays as is.
  return plain.length && plain !== ch ? plain : ch;
};

function fixTextNode(node) {
  const text = node.data;
  if (text.indexOf(LEAD) === -1) return;
  const fixed = text.replace(MATH_CHAR_RE, toPlain);
  if (fixed !== text) node.data = fixed;
}

function fixSubtree(root) {
  if (root.nodeType === 3) { fixTextNode(root); return; }
  if (root.nodeType !== 1 || (root.textContent || '').indexOf(LEAD) === -1) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while ((node = walker.nextNode())) fixTextNode(node);
}

/**
 * True while the legacy emoji fix (webOS 3/4) styles text with Noto Sans
 * Math, which draws these characters as intended - nothing to replace then.
 */
const mathFontActive = () => document.documentElement.classList.contains('ytaf-legacy-emoji');

function onMutations(records) {
  if (mathFontActive()) return;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.type === 'characterData') {
      fixTextNode(rec.target);
      continue;
    }
    const added = rec.addedNodes;
    for (let j = 0; j < added.length; j++) fixSubtree(added[j]);
  }
}

export function initMathLetters() {
  if (!canNormalize || typeof MutationObserver === 'undefined') return;
  const start = () => {
    if (!mathFontActive()) fixSubtree(document.body);
    new MutationObserver(onMutations).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}
