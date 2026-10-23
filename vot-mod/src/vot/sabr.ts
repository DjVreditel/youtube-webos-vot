import { parseFields, encodeFields, parseUmp } from './sabr-core';

type Field = { num: number; wire: number; value: number | Uint8Array };

type Template = { url: string; body: Uint8Array };

type Segment = {
  num: number;
  isInit: boolean;
  startMs: number;
  durationMs: number;
  data: Uint8Array;
};

type MediaHeader = {
  videoId: string;
  itag: number;
  isInit: boolean;
  num: number;
  startMs: number;
  durationMs: number;
};

const PART_MEDIA_HEADER = 20;
const PART_MEDIA = 21;
const PART_MEDIA_END = 22;
const PART_NEXT_REQUEST_POLICY = 35;
const PART_SABR_REDIRECT = 43;
const PART_SABR_ERROR = 44;
const PART_STREAM_PROTECTION_STATUS = 58;

const AUDIO_ONLY = 1;
const MAX_REQUESTS = 400;
const MAX_STALLS = 3;

let nativeFetch: typeof fetch | null = null;
let template: Template | null = null;

function varintField(num: number, value: number): Field {
  return { num, wire: 0, value };
}

function bytesField(num: number, value: Uint8Array): Field {
  return { num, wire: 2, value };
}

function fieldValue(fields: Field[], num: number): number | Uint8Array | undefined {
  return fields.find((f) => f.num === num)?.value;
}

function text(bytes: Uint8Array | number | undefined): string {
  return bytes instanceof Uint8Array ? new TextDecoder().decode(bytes) : '';
}


function parseMediaHeader(data: Uint8Array): { headerId: number; header: MediaHeader } {
  const f = parseFields(data);
  const num = (n: number) => (fieldValue(f, n) as number | undefined) ?? 0;
  return {
    headerId: num(1),
    header: {
      videoId: text(fieldValue(f, 2)),
      itag: num(3),
      isInit: num(8) === 1,
      num: num(9),
      startMs: num(11),
      durationMs: num(12)
    }
  };
}

export function installSabrCapture() {
  if (nativeFetch) return;
  nativeFetch = window.fetch;
  const original = nativeFetch;
  window.fetch = function (input: RequestInfo, init?: RequestInit): Promise<Response> {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (url && url.indexOf('videoplayback') !== -1 && url.indexOf('sabr=1') !== -1) {
        const body =
          typeof input !== 'string' && input.clone
            ? input.clone().arrayBuffer()
            : init?.body instanceof ArrayBuffer
              ? Promise.resolve(init.body)
              : null;
        body?.then(
          (ab) => {
            if (ab.byteLength) template = { url, body: new Uint8Array(ab) };
          },
          () => undefined
        );
      }
    } catch (err) {
      console.warn('[VOT] SABR capture failed:', err);
    }
    return original.call(window, input, init);
  } as typeof fetch;
}

function buildRequest(
  base: Field[],
  playerTimeMs: number,
  audioFormat: Uint8Array,
  audioItag: number,
  initDone: boolean,
  bufferedRange: Uint8Array | null,
  playbackCookie: Uint8Array | null
): Uint8Array {
  const out: Field[] = [];
  for (const f of base) {
    if (f.num === 1 && f.value instanceof Uint8Array) {
      const state = parseFields(f.value).filter((s) => s.num !== 28 && s.num !== 40);
      state.push(varintField(28, playerTimeMs), varintField(40, AUDIO_ONLY));
      out.push(bytesField(1, encodeFields(state)));
    } else if (f.num === 19 && f.value instanceof Uint8Array && playbackCookie) {
      const ctx = parseFields(f.value).filter((c) => c.num !== 3);
      ctx.push(bytesField(3, playbackCookie));
      out.push(bytesField(19, encodeFields(ctx)));
    } else if (![2, 3, 16, 17, 22].includes(f.num)) {
      out.push(f);
    }
  }
  if (initDone) out.push(bytesField(2, audioFormat));
  if (bufferedRange) out.push(bytesField(3, bufferedRange));
  out.push(bytesField(16, audioFormat));
  if (!out.some((f) => f.num === 23)) out.push(varintField(23, audioItag));
  return encodeFields(out);
}

function audioFormatOf(base: Field[]): { format: Uint8Array; itag: number } {
  const lastAudioItag = fieldValue(base, 23) as number | undefined;
  const formats = base
    .filter((f) => (f.num === 2 || f.num === 16) && f.value instanceof Uint8Array)
    .map((f) => f.value as Uint8Array);
  const match = formats.find((fmt) => fieldValue(parseFields(fmt), 1) === lastAudioItag);
  if (!lastAudioItag || !match) throw new Error('SABR: no audio format in the player request');
  return { format: match, itag: lastAudioItag };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hasSabrTemplate(): boolean {
  return template !== null;
}

export async function downloadAudioViaSabr(
  videoId: string,
  durationMs: number,
  signal: AbortSignal,
  onProgress?: (doneMs: number, totalMs: number) => void
): Promise<Uint8Array> {
  if (!template || !nativeFetch) throw new Error('SABR: no player request captured yet');
  const base = parseFields(template.body);
  const { format: audioFormat, itag: audioItag } = audioFormatOf(base);
  let url = template.url;
  let playbackCookie: Uint8Array | null = null;
  let requestNumber = 1;
  let stalls = 0;
  let initSegment: Uint8Array | null = null;
  const segments = new Map<number, Segment>();

  const coveredUntil = () => {
    let end = 0;
    let first = Infinity;
    let last = -1;
    for (const s of segments.values()) {
      end = Math.max(end, s.startMs + s.durationMs);
      first = Math.min(first, s.num);
      last = Math.max(last, s.num);
    }
    return { end, first, last };
  };

  for (let request = 0; request < MAX_REQUESTS; request++) {
    if (signal.aborted) throw new Error('aborted');
    const { end, first, last } = coveredUntil();
    if (initSegment && end >= durationMs - 1000) break;

    const bufferedRange =
      last >= 0
        ? encodeFields([
            bytesField(1, audioFormat),
            varintField(2, 0),
            varintField(3, end),
            varintField(4, first),
            varintField(5, last)
          ])
        : null;
    const body = buildRequest(base, end, audioFormat, audioItag, !!initSegment, bufferedRange, playbackCookie);
    const requestUrl = url.replace(/([?&])rn=\d+/, `$1rn=${requestNumber++}`);
    const res = await nativeFetch(requestUrl, {
      method: 'POST',
      body: body.buffer as ArrayBuffer,
      headers: { 'content-type': 'application/x-protobuf', accept: 'application/vnd.yt-ump' }
    });
    if (!res.ok) throw new Error(`SABR: HTTP ${res.status}`);
    const parts = parseUmp(new Uint8Array(await res.arrayBuffer()));

    const headers = new Map<number, MediaHeader>();
    const buffers = new Map<number, Uint8Array[]>();
    let backoffMs = 0;
    let gotAudio = false;
    for (const part of parts) {
      if (part.type === PART_MEDIA_HEADER) {
        const { headerId, header } = parseMediaHeader(part.data);
        if (header.videoId && header.videoId !== videoId) {
          throw new Error('SABR: the captured player request is for another video');
        }
        headers.set(headerId, header);
        buffers.set(headerId, []);
      } else if (part.type === PART_MEDIA) {
        buffers.get(part.data[0]!)?.push(part.data.subarray(1));
      } else if (part.type === PART_MEDIA_END) {
        const headerId = part.data[0]!;
        const header = headers.get(headerId);
        const data = concat(buffers.get(headerId) ?? []);
        if (header && header.itag === audioItag && data.length) {
          gotAudio = true;
          if (header.isInit) initSegment = initSegment ?? data;
          else segments.set(header.num, { ...header, data });
        }
      } else if (part.type === PART_NEXT_REQUEST_POLICY) {
        const policy = parseFields(part.data);
        const cookie = fieldValue(policy, 7);
        if (cookie instanceof Uint8Array) playbackCookie = cookie;
        backoffMs = (fieldValue(policy, 4) as number | undefined) ?? 0;
      } else if (part.type === PART_SABR_REDIRECT) {
        const next = text(fieldValue(parseFields(part.data), 1));
        if (next) url = next;
      } else if (part.type === PART_SABR_ERROR) {
        const err = parseFields(part.data);
        throw new Error(`SABR error ${text(fieldValue(err, 1))} ${fieldValue(err, 2) ?? ''}`);
      } else if (part.type === PART_STREAM_PROTECTION_STATUS) {
        if (fieldValue(parseFields(part.data), 1) === 3) {
          throw new Error('SABR: stream protection requires attestation');
        }
      }
    }

    onProgress?.(coveredUntil().end, durationMs);
    stalls = gotAudio ? 0 : stalls + 1;
    if (stalls >= MAX_STALLS) break;
    if (backoffMs) await wait(backoffMs);
  }

  if (!initSegment || segments.size === 0) throw new Error('SABR: no audio received');
  const ordered = Array.from(segments.values()).sort((a, b) => a.num - b.num);
  return concat([initSegment, ...ordered.map((s) => s.data)]);
}
