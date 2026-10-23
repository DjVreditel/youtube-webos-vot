// Rows loaded ahead (From mirijanristic's fork). The app asks for the next
// rows of a vertical list (the home feed, a browse tab, search results) once
// fewer rows than a threshold are left below the focused one: the response's
// own nextContinuationData.autoloadThresholdItemsFromEnd when above 0, else
// the section_list_continuation_threshold flag, else 3. YouTube sends the flag
// as 1, so the next rows are asked for only on the last row, and a quick run
// down the home screen reaches rows that have not arrived. The response's
// value outranks the flag, so the parse hook (adblock.js) raises it on every
// section list a response carries. A list filled on visibility
// (autoloadEnabled with autoloadOnVisible) does not read the threshold, and a
// reloadContinuationData is left as sent.

/** Rows left below the focused one when the app asks for the next ones. */
export const ROWS_AHEAD = 4;

// The section lists themselves (their `continuations` sit beside `contents`),
// per response type as adblock.js detects it.
const SECTION_LISTS = {
  HOME_BROWSE: [['contents', 'tvBrowseRenderer', 'content', 'tvSurfaceContentRenderer', 'content', 'sectionListRenderer']],
  SEARCH: [['contents', 'sectionListRenderer']],
  CONTINUATION: [
    ['continuationContents', 'sectionListContinuation'],
    ['continuationContents', 'tvSurfaceContentContinuation', 'content', 'sectionListRenderer']
  ]
};
const BROWSE_TABS_NAV = ['contents', 'tvBrowseRenderer', 'content', 'tvSecondaryNavRenderer'];

function getByPath(obj, parts) {
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current == null) return undefined;
    current = current[parts[i]];
  }
  return current;
}

function raiseList(list) {
  const continuations = list && list.continuations;
  if (!Array.isArray(continuations)) return;
  for (let i = 0; i < continuations.length; i++) {
    const next = continuations[i] && continuations[i].nextContinuationData;
    if (!next) continue;
    // `>=` is false for undefined, so a missing value is raised as well.
    if (!(next.autoloadThresholdItemsFromEnd >= ROWS_AHEAD)) next.autoloadThresholdItemsFromEnd = ROWS_AHEAD;
  }
}

/** Each tab of every section of a browse-tabs response, in either content shape. */
function raiseTabs(sections) {
  if (!Array.isArray(sections)) return;
  for (let i = 0; i < sections.length; i++) {
    const tabs = sections[i]?.tvSecondaryNavSectionRenderer?.tabs;
    if (!Array.isArray(tabs)) continue;
    for (let j = 0; j < tabs.length; j++) {
      const content = tabs[j]?.tabRenderer?.content;
      if (!content) continue;
      raiseList(content.sectionListRenderer);
      raiseList(content.tvSurfaceContentRenderer?.content?.sectionListRenderer);
    }
  }
}

/** Raises the threshold on every section list of a response of `type`. */
export function raiseRowsAhead(data, type) {
  if (type === 'BROWSE_TABS') {
    raiseTabs(getByPath(data, BROWSE_TABS_NAV)?.sections);
    return;
  }
  const lists = SECTION_LISTS[type];
  if (!lists) return;
  for (let i = 0; i < lists.length; i++) raiseList(getByPath(data, lists[i]));
}
