import type { VotTranslationResult } from './types';

const WORKER_HOST = 'https://vot-new.toil-dump.workers.dev';

const POLL_INTERVAL_MS = 20_000;
const MAX_RETRIES = 30;
// Anonymous lively-voice requests are queued by the server but never
// complete (upstream requires a Yandex account) — cap the wait and fall
// back to the standard voice instead of burning the whole retry budget
const LIVELY_MAX_ATTEMPTS = 4;
const AUDIO_UPLOAD_TIMEOUT_MS = 120_000;
const AUDIO_CHUNK_SIZE = 1_048_576; // 1MB per chunk
// Uploading tens of MB through the TV freezes the app (slow CPU + tight
// memory); beyond this size ask the server to fetch the audio itself
const MAX_AUDIO_UPLOAD_BYTES = 30 * 1_048_576;
const AUDIO_DOWNLOAD_TYPE = 'web_api_steal_sig_and_n';
const YT_BASE = 'https://www.youtube.com';
const INNERTUBE_ANDROID_VR_VERSION = '1.60.19';
const INNERTUBE_ANDROID_VERSION = '19.44.38';
const INNERTUBE_IOS_VERSION = '19.45.4';
const INNERTUBE_CLIENT_ORDER = [
  'ANDROID_VR',
  'ANDROID',
  'IOS',
  'WEB',
  'MWEB'
] as const;
const YT_STREAM_HEADERS = {
  accept: '*/*',
  origin: YT_BASE,
  referer: `${YT_BASE}/`
} as const;

const COMPONENT_VERSION = '25.12.4.1198';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 YaBrowser/25.12.0.0 Safari/537.36';
const HMAC_KEY = 'bt8xH3VOlb4mqf0nqAibnDOoiPlXsisf';

const PROTO_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'application/x-protobuf',
  'Accept-Language': 'en',
  'Content-Type': 'application/x-protobuf',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache'
};

// --- Minimal protobuf writer ---

class ProtoWriter {
  private readonly buf: number[] = [];

  private writeVarint(value: number) {
    while (value > 0x7f) {
      this.buf.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.buf.push(value & 0x7f);
  }

  int32(fieldNumber: number, value: number): this {
    if (value === 0) return this;
    this.writeVarint(fieldNumber << 3);
    this.writeVarint(value >>> 0);
    return this;
  }

  bool(fieldNumber: number, value: boolean): this {
    if (!value) return this;
    this.writeVarint(fieldNumber << 3);
    this.buf.push(1);
    return this;
  }

  string(fieldNumber: number, value: string): this {
    if (!value) return this;
    const bytes = new TextEncoder().encode(value);
    this.writeVarint((fieldNumber << 3) | 2);
    this.writeVarint(bytes.length);
    for (const b of bytes) this.buf.push(b);
    return this;
  }

  double(fieldNumber: number, value: number): this {
    if (value === 0) return this;
    this.writeVarint((fieldNumber << 3) | 1);
    const tmp = new DataView(new ArrayBuffer(8));
    tmp.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) this.buf.push(tmp.getUint8(i));
    return this;
  }

  bytes(fieldNumber: number, value: Uint8Array): this {
    this.writeVarint((fieldNumber << 3) | 2);
    this.writeVarint(value.length);
    for (const b of value) this.buf.push(b);
    return this;
  }

  finish(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

// --- Minimal protobuf reader ---

class ProtoReader {
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  get length() {
    return this.buf.length;
  }
  get position() {
    return this.pos;
  }

  private readVarint(): number {
    let result = 0;
    let shift = 0;
    while (this.pos < this.buf.length) {
      const b = this.buf[this.pos++] ?? 0;
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  readTag(): { field: number; type: number } {
    const tag = this.readVarint();
    return { field: tag >>> 3, type: tag & 0x07 };
  }

  readInt32(): number {
    return this.readVarint();
  }

  readString(): string {
    const len = this.readVarint();
    const bytes = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(bytes);
  }

  skip(type: number) {
    switch (type) {
      case 0:
        this.readVarint();
        break;
      case 1:
        this.pos += 8;
        break;
      case 2:
        this.pos += this.readVarint();
        break;
      case 5:
        this.pos += 4;
        break;
    }
  }
}

// --- Protobuf encode/decode ---

function encodeTranslationRequest(
  url: string,
  duration: number,
  fromLang: string,
  toLang: string,
  bypassCache = false,
  useLivelyVoice = false
): Uint8Array {
  return new ProtoWriter()
    .string(3, url)
    .bool(5, true)
    .double(6, duration)
    .int32(7, 1)
    .string(8, fromLang)
    .string(14, toLang)
    .int32(15, 1)
    .int32(16, 2)
    .bool(17, bypassCache)
    .bool(18, useLivelyVoice)
    .finish();
}

type TranslationResponse = {
  url: string;
  status: number;
  remainingTime: number;
  message: string;
  translationId: string;
  shouldRetry: number;
};

function decodeTranslationResponse(data: ArrayBuffer): TranslationResponse {
  const reader = new ProtoReader(new Uint8Array(data));
  const result: TranslationResponse = {
    url: '',
    status: 0,
    remainingTime: 0,
    message: '',
    translationId: '',
    shouldRetry: 0
  };

  while (reader.position < reader.length) {
    const { field, type } = reader.readTag();
    switch (field) {
      case 1:
        result.url = reader.readString();
        break;
      case 4:
        result.status = reader.readInt32();
        break;
      case 5:
        result.remainingTime = reader.readInt32();
        break;
      case 7:
        result.translationId = reader.readString();
        break;
      case 9:
        result.message = reader.readString();
        break;
      case 12:
        result.shouldRetry = reader.readInt32();
        break;
      default:
        reader.skip(type);
    }
  }

  return result;
}

const STATUS_FAILED = 0;
const STATUS_FINISHED = 1;
const STATUS_PART_CONTENT = 5;
const STATUS_AUDIO_REQUESTED = 6;
const STATUS_SESSION_REQUIRED = 7;

// --- HMAC-SHA256 ---

async function getSignature(data: Uint8Array): Promise<string> {
  const keyBytes = new TextEncoder().encode(HMAC_KEY);
  const keyBuf = new Uint8Array(keyBytes).buffer;
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const dataBuf = new Uint8Array(data).buffer;
  const sig = await crypto.subtle.sign('HMAC', key, dataBuf);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- Session ---

type Session = {
  secretKey: string;
  uuid: string;
  expires: number;
  timestamp: number;
};

let cachedSession: Session | null = null;

function generateUUID(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function decodeSessionResponse(data: ArrayBuffer): {
  secretKey: string;
  expires: number;
} {
  const reader = new ProtoReader(new Uint8Array(data));
  let secretKey = '';
  let expires = 0;

  while (reader.position < reader.length) {
    const { field, type } = reader.readTag();
    switch (field) {
      case 1:
        secretKey = reader.readString();
        break;
      case 2:
        expires = reader.readInt32();
        break;
      default:
        reader.skip(type);
    }
  }

  return { secretKey, expires };
}

// --- XHR transport ---

type WorkerResponse = {
  success: boolean;
  data: ArrayBuffer | string;
  status: number;
};

function xhrPost(
  path: string,
  payload: string,
  signal?: AbortSignal
): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ success: false, data: 'Aborted', status: 0 });
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${WORKER_HOST}${path}`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 10_000;
    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve({
          success: true,
          data: xhr.response as ArrayBuffer,
          status: 200
        });
      } else {
        const text = xhr.response
          ? new TextDecoder().decode(xhr.response as ArrayBuffer)
          : String(xhr.status);
        resolve({ success: false, data: text, status: xhr.status });
      }
    };
    xhr.onerror = () =>
      resolve({ success: false, data: 'Network error', status: 0 });
    xhr.ontimeout = () =>
      resolve({ success: false, data: 'Timeout', status: 0 });

    const onAbort = () => {
      xhr.abort();
      resolve({ success: false, data: 'Aborted', status: 0 });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort);

    xhr.send(payload);
  });
}

function xhrPut(
  path: string,
  payload: string,
  signal?: AbortSignal,
  timeoutMs = 10_000
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${WORKER_HOST}${path}`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = timeoutMs;
    xhr.onload = () => resolve();
    xhr.onerror = () => resolve();
    xhr.ontimeout = () => resolve();

    const onAbort = () => {
      xhr.abort();
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort);

    xhr.send(payload);
  });
}

function buildWorkerPayload(
  body: Uint8Array,
  extraHeaders: Record<string, string>
): string {
  // body.join() instead of JSON.stringify(Array.from(body)): materializing
  // a multi-megabyte number[] per audio chunk stalls the TV main thread
  return (
    '{"headers":' +
    JSON.stringify({ ...PROTO_HEADERS, ...extraHeaders }) +
    ',"body":[' +
    body.join(',') +
    ']}'
  );
}

// --- Vtrans auth headers ---

async function getVtransHeaders(
  session: Session,
  body: Uint8Array,
  path: string
): Promise<Record<string, string>> {
  const token = `${session.uuid}:${path}:${COMPONENT_VERSION}`;
  const tokenSign = await getSignature(new TextEncoder().encode(token));
  const bodySign = await getSignature(body);
  return {
    'Vtrans-Signature': bodySign,
    'Sec-Vtrans-Sk': session.secretKey,
    'Sec-Vtrans-Token': `${tokenSign}:${token}`
  };
}

// --- Session management ---

async function getSession(): Promise<Session> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedSession && cachedSession.timestamp + cachedSession.expires > now) {
    return cachedSession;
  }

  const uuid = generateUUID();
  const body = new ProtoWriter()
    .string(1, uuid)
    .string(2, 'video-translation')
    .finish();
  const signature = await getSignature(body);
  const payload = buildWorkerPayload(body, { 'Vtrans-Signature': signature });
  const res = await xhrPost('/session/create', payload);

  if (
    !res.success ||
    !(res.data instanceof ArrayBuffer) ||
    res.data.byteLength === 0
  ) {
    throw new Error(
      `Failed to create VOT session: ${res.data instanceof ArrayBuffer ? 'empty response' : String(res.data)}`
    );
  }

  const { secretKey, expires } = decodeSessionResponse(res.data);
  cachedSession = { secretKey, uuid, expires, timestamp: now };
  return cachedSession;
}

// --- Translation requests ---

async function sendTranslationRequest(
  body: Uint8Array,
  session: Session,
  signal: AbortSignal
): Promise<WorkerResponse> {
  const path = '/video-translation/translate';
  const headers = await getVtransHeaders(session, body, path);
  return xhrPost(path, buildWorkerPayload(body, headers), signal);
}

async function sendFailAudioJs(
  url: string,
  signal: AbortSignal
): Promise<void> {
  const path = '/video-translation/fail-audio-js';
  const bodyStr = JSON.stringify({ video_url: url });
  const payload = JSON.stringify({
    headers: {
      ...PROTO_HEADERS,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: bodyStr
  });
  await xhrPut(path, payload, signal);
}

// --- Innertube API types ---

type InnertubeContext = {
  apiKey: string;
  clientVersion: string;
  signatureTimestamp?: number;
  visitorData?: string;
};

type InnertubeAdaptiveFormat = {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
};

type InnertubePlayerResponse = {
  streamingData?: {
    adaptiveFormats?: InnertubeAdaptiveFormat[];
  };
};

type ResolvedAudioStream = {
  format: InnertubeAdaptiveFormat;
  streamUrl: string;
};

// --- Innertube helpers ---

function extractFirstMatch(
  html: string,
  patterns: readonly RegExp[]
): string | undefined {
  for (const p of patterns) {
    const m = p.exec(html)?.[1];
    if (m) return m;
  }
  return undefined;
}

function makeCPN(length = 16): string {
  const alphabet =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length] ?? 'a').join(
    ''
  );
}

async function fetchInnertubeContext(
  videoId: string,
  signal: AbortSignal
): Promise<InnertubeContext> {
  const url = `${YT_BASE}/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const res = await fetch(url, { headers: YT_STREAM_HEADERS, signal });
  if (!res.ok) throw new Error(`Watch page fetch failed: ${res.status}`);
  const html = await res.text();

  const apiKey = extractFirstMatch(html, [
    /"INNERTUBE_API_KEY":"([^"]+)"/,
    /['"]INNERTUBE_API_KEY['"]\s*:\s*"([^"]+)"/
  ]);
  const clientVersion = extractFirstMatch(html, [
    /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/,
    /['"]INNERTUBE_CLIENT_VERSION['"]\s*:\s*"([^"]+)"/
  ]);
  if (!apiKey || !clientVersion)
    throw new Error('Failed to extract Innertube context from watch page');

  const stsRaw = extractFirstMatch(html, [
    /"STS":(\d+)/,
    /['"]STS['"]\s*:\s*(\d+)/
  ]);
  const visitorData = extractFirstMatch(html, [
    /"VISITOR_DATA":"([^"]+)"/,
    /"visitorData":"([^"]+)"/,
    /['"](?:VISITOR_DATA|visitorData)['"]\s*:\s*"([^"]+)"/
  ]);

  const ctx: InnertubeContext = { apiKey, clientVersion };
  if (stsRaw) {
    const sts = Number.parseInt(stsRaw, 10);
    if (Number.isFinite(sts)) ctx.signatureTimestamp = sts;
  }
  if (visitorData) {
    ctx.visitorData = visitorData
      .replaceAll('\\u0026', '&')
      .replaceAll('\\/', '/');
  }
  return ctx;
}

type InnertubeClientName = (typeof INNERTUBE_CLIENT_ORDER)[number];

function buildInnertubeClientContext(
  clientName: InnertubeClientName,
  ctx: InnertubeContext,
  videoId: string
): Record<string, unknown> {
  switch (clientName) {
    case 'ANDROID_VR':
      return {
        clientName: 'ANDROID_VR',
        clientVersion: INNERTUBE_ANDROID_VR_VERSION,
        hl: 'en',
        gl: 'US',
        androidSdkVersion: 31,
        osName: 'Android',
        osVersion: '12',
        platform: 'MOBILE'
      };
    case 'ANDROID':
      return {
        clientName: 'ANDROID',
        clientVersion: INNERTUBE_ANDROID_VERSION,
        hl: 'en',
        gl: 'US',
        androidSdkVersion: 34,
        osName: 'Android',
        osVersion: '14',
        platform: 'MOBILE'
      };
    case 'IOS':
      return {
        clientName: 'IOS',
        clientVersion: INNERTUBE_IOS_VERSION,
        hl: 'en',
        gl: 'US',
        platform: 'MOBILE',
        osName: 'iPhone',
        osVersion: '18.0.0.22A3354',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2'
      };
    case 'MWEB':
      return {
        clientName: 'MWEB',
        clientVersion: ctx.clientVersion,
        hl: 'en',
        gl: 'US',
        originalUrl: `${YT_BASE}/watch?v=${videoId}`
      };
    default:
      return {
        clientName: 'WEB',
        clientVersion: ctx.clientVersion,
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
        originalUrl: `${YT_BASE}/watch?v=${videoId}`
      };
  }
}

async function fetchInnertubePlayerResponse(
  videoId: string,
  ctx: InnertubeContext,
  clientName: InnertubeClientName,
  signal: AbortSignal
): Promise<InnertubePlayerResponse> {
  const client = buildInnertubeClientContext(clientName, ctx, videoId);
  if (ctx.visitorData) client.visitorData = ctx.visitorData;

  const body: Record<string, unknown> = {
    context: { client },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true
  };
  if (ctx.signatureTimestamp) {
    body.playbackContext = {
      contentPlaybackContext: { signatureTimestamp: ctx.signatureTimestamp }
    };
  }

  const endpoint = `${YT_BASE}/youtubei/v1/player?key=${encodeURIComponent(ctx.apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...YT_STREAM_HEADERS,
      ...(ctx.visitorData ? { 'x-goog-visitor-id': ctx.visitorData } : {})
    },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw new Error(`Player API [${clientName}]: ${res.status}`);
  return res.json() as Promise<InnertubePlayerResponse>;
}

function pickBestAudioFormat(
  formats: InnertubeAdaptiveFormat[]
): InnertubeAdaptiveFormat {
  const audioOnly = formats.filter((f) => {
    const mime = f.mimeType?.toLowerCase() ?? '';
    return !!f.url && mime.includes('audio/') && !mime.includes('video/');
  });
  if (!audioOnly.length)
    throw new Error('No audio-only adaptive formats found');

  // Prefer m4a/aac for wider compatibility, fallback to any audio
  const m4a = audioOnly.filter((f) =>
    f.mimeType?.toLowerCase().includes('audio/mp4')
  );
  const pool = m4a.length ? m4a : audioOnly;

  // Pick lowest bitrate (best efficiency)
  return pool.reduce<InnertubeAdaptiveFormat>(
    (best, f) => ((f.bitrate ?? 0) < (best.bitrate ?? Infinity) ? f : best),
    pool[0] ?? {}
  );
}

async function resolveAudioStream(
  videoId: string,
  ctx: InnertubeContext,
  signal: AbortSignal
): Promise<ResolvedAudioStream> {
  const errors: string[] = [];

  for (const clientName of INNERTUBE_CLIENT_ORDER) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchInnertubePlayerResponse(
      videoId,
      ctx,
      clientName,
      signal
    ).catch((err: unknown) => {
      errors.push(
        `${clientName}: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    });
    if (!response) continue;

    const formats = (response.streamingData?.adaptiveFormats ?? []).filter(
      (f) => !!f.url
    );
    if (!formats.length) {
      errors.push(`${clientName}: No direct stream URLs in response`);
      continue;
    }

    const format = pickBestAudioFormat(formats);
    if (!format.url) {
      errors.push(`${clientName}: Selected format has no URL`);
      continue;
    }

    const streamUrl = new URL(format.url);
    streamUrl.searchParams.set('cpn', makeCPN());
    return { format, streamUrl: streamUrl.toString() };
  }

  throw new Error(`Cannot resolve YouTube audio stream. ${errors.join(' | ')}`);
}

async function probeStreamContentLength(
  streamUrl: string,
  hint: string | undefined,
  signal: AbortSignal
): Promise<number> {
  const parsePositiveInt = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const res = await fetch(streamUrl, {
    headers: { ...YT_STREAM_HEADERS, range: 'bytes=0-0' },
    signal
  });
  if (!res.ok) throw new Error(`Stream probe failed: ${res.status}`);

  const contentRange = res.headers.get('content-range');
  const xGoogLen = res.headers.get('x-goog-stored-content-length');

  const fromRange = contentRange
    ? parsePositiveInt(/\/(\d+)\s*$/.exec(contentRange)?.[1])
    : null;
  const len = fromRange ?? parsePositiveInt(xGoogLen) ?? parsePositiveInt(hint);
  if (!len) throw new Error('Cannot determine audio stream content length');

  // Drain the response body to free the connection
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
  return len;
}

async function downloadAudioRange(
  streamUrl: string,
  start: number,
  end: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const res = await fetch(streamUrl, {
    headers: { ...YT_STREAM_HEADERS, range: `bytes=${start}-${end}` },
    signal
  });
  if (!res.ok) throw new Error(`Audio range download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// --- Efficient protobuf encoding for large audio payloads ---
// Uses Uint8Array concatenation instead of byte-by-byte push() for performance

function encodeVarint(value: number): Uint8Array {
  const buf: number[] = [];
  while (value > 0x7f) {
    buf.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  buf.push(value & 0x7f);
  return new Uint8Array(buf);
}

function protoConcat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

function protoStringField(fieldNum: number, value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return protoConcat(
    encodeVarint((fieldNum << 3) | 2),
    encodeVarint(encoded.length),
    encoded
  );
}

function protoBytesField(fieldNum: number, value: Uint8Array): Uint8Array {
  return protoConcat(
    encodeVarint((fieldNum << 3) | 2),
    encodeVarint(value.length),
    value
  );
}

function protoInt32Field(fieldNum: number, value: number): Uint8Array {
  if (value === 0) return new Uint8Array(0);
  return protoConcat(encodeVarint(fieldNum << 3), encodeVarint(value >>> 0));
}

function makeAudioFileId(itag: number, fileSize: number): string {
  return JSON.stringify({
    downloadType: AUDIO_DOWNLOAD_TYPE,
    itag,
    minChunkSize: AUDIO_CHUNK_SIZE,
    fileSize: String(fileSize)
  });
}

// Encodes VideoTranslationAudioRequest for a single (full) audio chunk
// protobuf schema: translationId(1), url(2), audioInfo(6){fileId(1), audioFile(2)}
function encodeFullAudioRequest(
  translationId: string,
  url: string,
  fileId: string,
  audioData: Uint8Array
): Uint8Array {
  const audioInfo = protoConcat(
    protoStringField(1, fileId),
    protoBytesField(2, audioData)
  );
  return protoConcat(
    protoStringField(1, translationId),
    protoStringField(2, url),
    protoBytesField(6, audioInfo)
  );
}

// Encodes VideoTranslationAudioRequest for one chunk of a multi-chunk upload
// protobuf schema: translationId(1), url(2), partialAudioInfo(4){audioBuffer(1){chunkId(1),audioFile(2)}, audioPartsLength(2), fileId(3), version(4)}
function encodePartialAudioRequest(
  translationId: string,
  url: string,
  audioData: Uint8Array,
  chunkId: number,
  totalChunks: number,
  fileId: string
): Uint8Array {
  const audioBuffer = protoConcat(
    protoInt32Field(1, chunkId),
    protoBytesField(2, audioData)
  );
  const partialInfo = protoConcat(
    protoBytesField(1, audioBuffer),
    protoInt32Field(2, totalChunks),
    protoStringField(3, fileId),
    protoInt32Field(4, 1) // version = 1
  );
  return protoConcat(
    protoStringField(1, translationId),
    protoStringField(2, url),
    protoBytesField(4, partialInfo)
  );
}

// --- YouTube audio download + Yandex upload ---

async function downloadAndUploadYouTubeAudio(
  videoId: string,
  translationId: string,
  session: Session,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const videoUrl = `https://youtu.be/${videoId}`;
  const path = '/video-translation/audio';

  const ctx = await fetchInnertubeContext(videoId, signal);
  const { format, streamUrl } = await resolveAudioStream(videoId, ctx, signal);
  const fileSize = await probeStreamContentLength(
    streamUrl,
    format.contentLength,
    signal
  );
  if (fileSize > MAX_AUDIO_UPLOAD_BYTES) {
    throw new Error(
      `Audio too large to upload from TV: ${Math.round(fileSize / 1_048_576)}MB`
    );
  }
  const totalChunks = Math.max(1, Math.ceil(fileSize / AUDIO_CHUNK_SIZE));
  const fileId = makeAudioFileId(format.itag ?? 0, fileSize);

  if (totalChunks === 1) {
    const audioData = await downloadAudioRange(
      streamUrl,
      0,
      fileSize - 1,
      signal
    );
    const body = encodeFullAudioRequest(
      translationId,
      videoUrl,
      fileId,
      audioData
    );
    const headers = await getVtransHeaders(session, body, path);
    await xhrPut(
      path,
      buildWorkerPayload(body, headers),
      signal,
      AUDIO_UPLOAD_TIMEOUT_MS
    );
    return;
  }

  for (let i = 0; i < totalChunks; i++) {
    if (signal.aborted) break;
    onProgress?.(i + 1, totalChunks);
    const start = i * AUDIO_CHUNK_SIZE;
    const end = Math.min(fileSize - 1, start + AUDIO_CHUNK_SIZE - 1);
    // eslint-disable-next-line no-await-in-loop
    const audioData = await downloadAudioRange(streamUrl, start, end, signal);
    // eslint-disable-next-line no-await-in-loop
    const body = encodePartialAudioRequest(
      translationId,
      videoUrl,
      audioData,
      i,
      totalChunks,
      fileId
    );
    // eslint-disable-next-line no-await-in-loop
    const headers = await getVtransHeaders(session, body, path);
    // eslint-disable-next-line no-await-in-loop
    await xhrPut(
      path,
      buildWorkerPayload(body, headers),
      signal,
      AUDIO_UPLOAD_TIMEOUT_MS
    );
  }
}

// Fallback: notify Yandex that audio download was attempted but failed
async function sendFallbackAudioNotify(
  url: string,
  translationId: string,
  session: Session,
  signal: AbortSignal
): Promise<void> {
  const path = '/video-translation/audio';
  const audioInfo = new ProtoWriter()
    .string(1, 'web_api_get_all_generating_urls_data_from_iframe')
    .bytes(2, new Uint8Array(0))
    .finish();
  const body = new ProtoWriter()
    .string(1, translationId)
    .string(2, url)
    .bytes(6, audioInfo)
    .finish();
  const headers = await getVtransHeaders(session, body, path);
  await xhrPut(path, buildWorkerPayload(body, headers), signal);
}

function waitPoll(signal: AbortSignal, remainingTime = 0): Promise<void> {
  const ms =
    remainingTime > 0
      ? Math.max(5_000, Math.min(POLL_INTERVAL_MS, (remainingTime + 3) * 1000))
      : POLL_INTERVAL_MS;
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(id);
      reject(
        Object.assign(new Error('Translation aborted'), {
          name: 'AbortError'
        })
      );
    };
    // Detach on completion — one listener per poll iteration piles up on
    // the session-long signal otherwise
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// --- Public API ---

export async function translateVideo(
  videoId: string,
  fromLang: string,
  toLang: string,
  duration: number,
  signal: AbortSignal,
  onWaiting?: (
    remainingTime: number,
    message: string,
    isRetry?: boolean
  ) => void,
  useLivelyVoice = false
): Promise<VotTranslationResult> {
  const url = `https://youtu.be/${videoId}`;
  let audioHandled = false;
  let bypassCacheUsed = false;
  let shouldRetryCount = 0;
  // Lively voice needs a Yandex account upstream; try anonymously and fall
  // back to the standard voice if the server declines
  let lively = useLivelyVoice;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted)
      throw Object.assign(new Error('Translation aborted'), {
        name: 'AbortError'
      });

    if (lively && attempt >= LIVELY_MAX_ATTEMPTS) {
      console.warn('[VOT] lively voice not ready, falling back to standard');
      lively = false;
      attempt = -1; // restart the retry budget for the standard voice
      continue;
    }

    const session = await getSession();
    const body = encodeTranslationRequest(
      url,
      duration,
      fromLang,
      toLang,
      false,
      lively
    );
    const res = await sendTranslationRequest(body, session, signal);

    if (!res.success) {
      if (res.status >= 500 || res.status === 0) {
        cachedSession = null;
        throw Object.assign(new Error('Server is processing this video'), {
          name: 'ServerRestartNeeded'
        });
      }
      throw new Error(
        `VOT error: ${typeof res.data === 'string' ? res.data : `HTTP ${res.status}`}`
      );
    }
    if (!(res.data instanceof ArrayBuffer))
      throw new Error('VOT: unexpected response type');

    const data = decodeTranslationResponse(res.data);
    console.debug('[VOT] response:', data);

    // Server says lively voices are unavailable (no account / unsupported
    // pair) — retry immediately with the standard voice
    if (
      lively &&
      data.message &&
      data.message.toLowerCase().includes('обычная озвучка')
    ) {
      console.warn(
        '[VOT] lively voice unavailable, falling back:',
        data.message
      );
      lively = false;
      attempt = -1;
      continue;
    }

    if (data.status === STATUS_FAILED) {
      if (data.shouldRetry === 1 && !bypassCacheUsed) {
        bypassCacheUsed = true;
        cachedSession = null;
        const bypassBody = encodeTranslationRequest(
          url,
          duration,
          fromLang,
          toLang,
          true,
          lively
        );
        const bypassSession = await getSession();
        const bypassRes = await sendTranslationRequest(
          bypassBody,
          bypassSession,
          signal
        );
        if (bypassRes.success && bypassRes.data instanceof ArrayBuffer) {
          const bypassData = decodeTranslationResponse(bypassRes.data);
          console.debug('[VOT] bypassCache response:', bypassData);
          if (bypassData.status !== STATUS_FAILED) {
            onWaiting?.(
              bypassData.remainingTime,
              bypassData.message || `~${bypassData.remainingTime}s`
            );
            await waitPoll(signal, bypassData.remainingTime);
            continue;
          }
        }
      }

      if (data.shouldRetry === 1 && shouldRetryCount < 3) {
        shouldRetryCount++;
        cachedSession = null;
        onWaiting?.(0, '', true);
        await waitPoll(signal, 2);
        continue;
      }

      if (lively) {
        console.warn('[VOT] lively voice failed, retrying with standard');
        lively = false;
        attempt = -1;
        continue;
      }

      throw new Error(data.message || 'Translation failed');
    }

    if (data.status === STATUS_SESSION_REQUIRED) {
      cachedSession = null;
      continue;
    }

    if (data.status === STATUS_FINISHED) {
      if (!data.url) throw new Error('No audio URL in response');
      return { translated: true, url: data.url };
    }

    if (data.status === STATUS_PART_CONTENT) {
      onWaiting?.(
        data.remainingTime,
        data.message || `~${data.remainingTime}s`
      );
      await waitPoll(signal, data.remainingTime);
      continue;
    }

    if (data.status === STATUS_AUDIO_REQUESTED && !audioHandled) {
      audioHandled = true;
      try {
        await downloadAndUploadYouTubeAudio(
          videoId,
          data.translationId,
          session,
          signal,
          (done, total) => onWaiting?.(0, `upload ${done}/${total}`)
        );
      } catch (err) {
        console.warn(
          '[VOT] Audio download failed, falling back to fail-audio-js:',
          err
        );
        await sendFailAudioJs(url, signal);
        await sendFallbackAudioNotify(url, data.translationId, session, signal);
      }
      continue;
    }

    onWaiting?.(data.remainingTime, data.message || `~${data.remainingTime}s`);
    await waitPoll(signal, data.remainingTime);
  }

  throw new Error('Translation timed out');
}
