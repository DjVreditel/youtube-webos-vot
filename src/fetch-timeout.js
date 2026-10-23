// fetch() of a JSON answer with one deadline that covers the body as well as
// the headers. Clearing the timer when the headers arrived left `res.json()`
// with no deadline at all: a server that stalled mid-body hung the caller for
// good (no fallback server, no retry, no next refresh). The timer is cleared
// on every outcome, so a request that won the race leaves nothing to fire.
// Ported from mirijanristic's fork (src/core/fetch-timeout.js).

const HAS_ABORT_CONTROLLER = typeof AbortController !== 'undefined';

function abortError() {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return error;
}

/**
 * Resolves with `{ ok, status, data }`: the parsed body of a 2xx answer, or
 * `data: null` (body unread) for any other status. Rejects like fetch() does,
 * with Error('timeout') once `timeoutMs` passes - headers or body - and with
 * an AbortError when `opts.signal` aborts.
 *
 * The request runs on its own AbortController where the engine has one, so a
 * timeout drops the connection too. Without one (webOS 3 and 4) the request
 * itself runs on, but its answer is never handed out after the deadline.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @param {{ signal?: AbortSignal }} [opts] caller's signal, to cancel early
 */
export function fetchJsonWithTimeout(url, timeoutMs, opts) {
    const outer = opts && opts.signal ? opts.signal : null;
    const controller = HAS_ABORT_CONTROLLER ? new AbortController() : null;
    let timer = null;
    let onOuterAbort = null;

    const cutoff = new Promise((_, reject) => {
        // Rejected before the controller aborts: the request's own AbortError
        // would otherwise win the race and a timeout would read as an abort.
        timer = setTimeout(() => {
            timer = null;
            reject(new Error('timeout'));
            if (controller) controller.abort();
        }, timeoutMs);

        if (outer) {
            onOuterAbort = () => {
                reject(abortError());
                if (controller) controller.abort();
            };
            if (outer.aborted) onOuterAbort();
            else outer.addEventListener('abort', onOuterAbort);
        }
    });

    const request = (controller ? fetch(url, { signal: controller.signal }) : fetch(url)).then(
        response => (response.ok
            ? response.json().then(data => ({ ok: true, status: response.status, data }))
            : { ok: false, status: response.status, data: null })
    );
    // The losing side of the race must not surface as an unhandled rejection.
    request.catch(() => {});

    const cleanup = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (outer && onOuterAbort) outer.removeEventListener('abort', onOuterAbort);
    };

    return Promise.race([request, cutoff]).then(
        (result) => { cleanup(); return result; },
        (error) => { cleanup(); throw error; }
    );
}
