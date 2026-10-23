/**
 * Forces `isInlinePlaybackNoAd` on outgoing InnerTube player requests.
 *
 * JSON.stringify is a global hook, so YouTube calls it constantly - every
 * localStorage write, every request body, every internal log. The previous
 * implementation ran a breadth-first search over the entire object graph to
 * depth 6 on *every* call, which measured at 3.1x native stringify on a
 * payload containing no playbackContext at all.
 *
 * Two guards fix that:
 *   1. An O(1) direct hit for the shape YouTube actually sends, where
 *      playbackContext sits at the root of the request body.
 *   2. A cheap rejection for everything else: only InnerTube request bodies
 *      carry contentPlaybackContext, and those always carry a `context`
 *      object too. Anything without one is skipped before any walking.
 *
 * The bounded BFS is kept for the case where both are true but the shape has
 * moved, so an InnerTube schema change degrades to "slower" rather than
 * "silently stops working".
 *
 * The flag is set on a copy of the chain down to contentPlaybackContext, never
 * on YouTube's own objects - see withNoAdFlag().
 */
const originalStringify = JSON.stringify;
const MAX_DEPTH = 6;
// Bounds the fallback walk. A request body is a few hundred nodes; anything
// far past that is not the object we are looking for.
const MAX_NODES = 2000;
const DEBUG = false;

/**
 * Path (list of keys) from `root` to the object holding `playbackContext`,
 * or null. The path is what lets stringify() rebuild the chain with copies
 * instead of writing into YouTube's own objects.
 */
function findCtxPath(root: any): string[] | null {
  // Flat queue: [node, depth, parentIndex, key, ...]; parentIndex points at
  // the entry's own slot so the path can be read back once found.
  const queue: any[] = [root, 0, -1, ''];
  let i = 0;
  let visited = 0;
  while (i < queue.length) {
    if (++visited > MAX_NODES) return null;
    const self = i;
    const node = queue[i++];
    const depth = queue[i++];
    i += 2;
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) continue;
    const pc = node.playbackContext;
    if (pc && typeof pc === 'object' && pc.contentPlaybackContext) {
      const path: string[] = [];
      for (let at = self; at > 0; at = queue[at + 2]) path.push(queue[at + 3]);
      return path.reverse();
    }
    const nextDepth = depth + 1;
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') queue.push(v, nextDepth, self, k);
    }
  }
  return null;
}

function copyOf(obj: any): any {
  return Array.isArray(obj) ? obj.slice() : Object.assign({}, obj);
}

/**
 * Copy of `value` with isInlinePlaybackNoAd set on the contentPlaybackContext
 * reached through `path`. Only the chain down to it is copied; everything else
 * is shared.
 *
 * YouTube ships a "locker" that defines isInlinePlaybackNoAd as
 * non-writable/non-configurable (and request bodies can be frozen), so an
 * in-place write silently fails and the server answers with the SABR backoff
 * that stalls playback a few seconds in. JSON.stringify only serializes own
 * enumerable properties, so a shallow copy serializes identically while
 * dropping the locked descriptor.
 */
function withNoAdFlag(value: any, path: string[]): any {
  const root = copyOf(value);
  let node = root;
  for (const key of path) {
    node[key] = copyOf(node[key]);
    node = node[key];
  }
  const pc = copyOf(node.playbackContext);
  pc.contentPlaybackContext = Object.assign({}, pc.contentPlaybackContext, {
    isInlinePlaybackNoAd: true
  });
  node.playbackContext = pc;
  return root;
}

/** `value`, or a copy of it with the flag set when it is a player request. */
function withFlagIfPlayerRequest(value: any): any {
  let path: string[] | null = null;
  // (1) The shape YouTube actually sends - no traversal at all.
  const rootPc = value.playbackContext;
  if (rootPc && typeof rootPc === 'object' && rootPc.contentPlaybackContext) {
    path = [];
  } else if (value.context && typeof value.context === 'object') {
    // (2) Looks like an InnerTube request, but not the expected shape.
    path = findCtxPath(value);
  }
  if (!path) return value;

  let ctx = value;
  for (const key of path) ctx = ctx[key];
  if (ctx.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd === true) return value;
  if (DEBUG) console.info('[JSON.stringify] Set isInlinePlaybackNoAd');
  return withNoAdFlag(value, path);
}

// The try/catch sits alone here, not in stringify(): the engine of webOS 3
// (V8 3.28) does not optimise a function that contains one, and stringify()
// runs on every JSON.stringify the app makes. (From mirijanristic's fork.)
function withFlagSafely(value: any): any {
  try {
    return withFlagIfPlayerRequest(value);
  } catch (e) {
    // our logic must never break YouTube's serialization
    return value;
  }
}

function stringify(value: any, replacer?: any, space?: any): string {
  // Only InnerTube request bodies carry either key; everything else is
  // serialized without another call.
  if (value !== null && typeof value === 'object' && (value.playbackContext || value.context)) {
    value = withFlagSafely(value);
  }
  return originalStringify(value, replacer, space);
}

JSON.stringify = stringify;
