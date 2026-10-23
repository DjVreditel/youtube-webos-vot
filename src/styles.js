// Every stylesheet of the bundle in one <style> element, put in the page once.
// Each CSS import hands its text here while its module is evaluated
// (tools/css-collect-loader.cjs), in import order, and the element goes in
// once the bundle has run: one sheet, parsed once. style-loader added a
// <style> per stylesheet, each one parsed on its own. (From mirijanristic's
// fork.)
const pending = [];

function insertPending() {
  const style = document.createElement('style');
  style.textContent = pending.join('');
  pending.length = 0;
  (document.head || document.documentElement).appendChild(style);
}

/** Queues a stylesheet's text; the first one schedules the insertion, after the bundle's run. */
export function addStyle(css) {
  if (pending.length === 0) Promise.resolve().then(insertPending);
  pending.push(css);
}
