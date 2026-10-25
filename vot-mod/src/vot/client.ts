import type { VotTranslationResult } from './types';
import { downloadAudioViaSabr } from './sabr';

const WORKER_HOST = 'https://vot-worker.vtrans.eu.cc';
const LEGACY_WORKER_HOST = 'https://vot-new.toil-dump.workers.dev';
const REQUEST_TIMEOUT_MS = 10_000;

const POLL_INTERVAL_MS = 20_000;
const MAX_RETRIES = 30;
// Anonymous lively-voice requests are queued by the server but never
// complete (upstream requires a Yandex account) — cap the wait and fall
// back to the standard voice instead of burning the whole retry budget
const LIVELY_MAX_ATTEMPTS = 4;
const AUDIO_UPLOAD_TIMEOUT_MS = 120_000;
const AUDIO_CHUNK_SIZE = 5_295_308;
// Uploading tens of MB through the TV freezes the app (slow CPU + tight
// memory); beyond this size ask the server to fetch the audio itself
// The server requires the client to upload the source audio (status 6)
// for any video it hasn't cached — this is mandatory, not optional, so we
// cannot cap it. We yield to the event loop between chunks to keep the TV
// UI responsive during the upload.
const UPLOAD_CHUNK_PAUSE_MS = 50;

const COMPONENT_VERSION = '26.10.0.1796';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36';
const HMAC_KEY = 'bt8xH3VOlb4mqf0nqAibnDOoiPlXsisf';

const PROTO_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'application/x-protobuf',
  'Accept-Language': 'en',
  'Content-Type': 'application/x-protobuf',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache'
};

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json'
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

  readBytes(): Uint8Array {
    const len = this.readVarint();
    const bytes = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return bytes;
  }

  readString(): string {
    return new TextDecoder().decode(this.readBytes());
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
  useLivelyVoice = false,
  forceSourceLang = false,
  videoTitle = ''
): Uint8Array {
  return new ProtoWriter()
    .string(3, url)
    .bool(5, true)
    .double(6, duration)
    .int32(7, 1)
    .string(8, fromLang)
    .bool(9, forceSourceLang)
    .string(14, toLang)
    .int32(15, 1)
    .int32(16, 2)
    .bool(17, bypassCache)
    .bool(18, useLivelyVoice)
    .string(19, videoTitle)
    .finish();
}

type TranslationResponse = {
  url: string;
  status: number;
  remainingTime: number;
  message: string;
  translationId: string;
  shouldRetry: number;
  language: string;
  isLivelyVoice: boolean;
};

function decodeTranslationResponse(data: ArrayBuffer): TranslationResponse {
  const reader = new ProtoReader(new Uint8Array(data));
  const result: TranslationResponse = {
    url: '',
    status: 0,
    remainingTime: 0,
    message: '',
    translationId: '',
    shouldRetry: 0,
    language: '',
    isLivelyVoice: false
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
      case 8:
        result.language = reader.readString();
        break;
      case 10:
        result.isLivelyVoice = reader.readInt32() === 1;
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

type WorkerBody = { proto: Uint8Array } | { json: string };

type WorkerRequest = {
  headers: Record<string, string>;
  payload: string | ArrayBuffer;
};

let useLegacyWorker = false;

function yandexHeaders(
  body: WorkerBody,
  extraHeaders: Record<string, string>
): Record<string, string> {
  return {
    ...PROTO_HEADERS,
    ...('json' in body ? JSON_HEADERS : {}),
    ...extraHeaders
  };
}

function nextWorkerRequest(
  body: WorkerBody,
  extraHeaders: Record<string, string>
): WorkerRequest {
  const headers = yandexHeaders(body, extraHeaders);
  return {
    headers: {
      'Content-Type': headers['Content-Type'] ?? 'application/x-protobuf',
      'X-VOT-Headers': btoa(JSON.stringify(headers))
    },
    payload: 'json' in body ? body.json : new Uint8Array(body.proto).buffer
  };
}

function legacyWorkerRequest(
  body: WorkerBody,
  extraHeaders: Record<string, string>
): WorkerRequest {
  const headers = JSON.stringify(yandexHeaders(body, extraHeaders));
  // body.join() instead of JSON.stringify(Array.from(body)): materializing
  // a multi-megabyte number[] per audio chunk stalls the TV main thread
  return {
    headers: { 'Content-Type': 'application/json' },
    payload:
      'json' in body
        ? `{"headers":${headers},"body":${JSON.stringify(body.json)}}`
        : `{"headers":${headers},"body":[${body.proto.join(',')}]}`
  };
}

function sendXhr(
  method: 'POST' | 'PUT',
  url: string,
  request: WorkerRequest,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ success: false, data: 'Aborted', status: 0 });
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(request.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.responseType = 'arraybuffer';
    xhr.timeout = timeoutMs;
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

    xhr.send(request.payload);
  });
}

async function workerRequest(
  method: 'POST' | 'PUT',
  path: string,
  body: WorkerBody,
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<WorkerResponse> {
  if (!useLegacyWorker) {
    const res = await sendXhr(
      method,
      `${WORKER_HOST}${path}`,
      nextWorkerRequest(body, extraHeaders),
      signal,
      timeoutMs
    );
    const unreachable =
      (res.status === 0 && res.data === 'Network error') ||
      res.status === 403 ||
      res.status === 404;
    if (!unreachable) return res;
    console.warn('[VOT] worker unavailable, using the legacy worker:', res.data);
    useLegacyWorker = true;
  }
  return sendXhr(
    method,
    `${LEGACY_WORKER_HOST}${path}`,
    legacyWorkerRequest(body, extraHeaders),
    signal,
    timeoutMs
  );
}

// --- Vtrans auth headers ---

async function getVtransHeaders(
  session: Session,
  body: Uint8Array,
  path: string,
  secType: 'Vtrans' | 'Vsubs' = 'Vtrans'
): Promise<Record<string, string>> {
  const token = `${session.uuid}:${path}:${COMPONENT_VERSION}`;
  const tokenSign = await getSignature(new TextEncoder().encode(token));
  const bodySign = await getSignature(body);
  return {
    [`${secType}-Signature`]: bodySign,
    [`Sec-${secType}-Sk`]: session.secretKey,
    [`Sec-${secType}-Token`]: `${tokenSign}:${token}`
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
  const res = await workerRequest(
    'POST',
    '/session/create',
    { proto: body },
    { 'Vtrans-Signature': signature }
  );

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
  signal: AbortSignal,
  extraHeaders: Record<string, string> = {}
): Promise<WorkerResponse> {
  const path = '/video-translation/translate';
  const headers = await getVtransHeaders(session, body, path);
  return workerRequest(
    'POST',
    path,
    { proto: body },
    { ...headers, ...extraHeaders },
    signal
  );
}

async function sendFailAudioJs(
  url: string,
  signal: AbortSignal
): Promise<void> {
  await workerRequest(
    'PUT',
    '/video-translation/fail-audio-js',
    { json: JSON.stringify({ video_url: url }) },
    {},
    signal
  );
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
  durationMs: number,
  session: Session,
  signal: AbortSignal,
  onProgress?: (message: string) => void
): Promise<void> {
  const videoUrl = `https://youtu.be/${videoId}`;
  const path = '/video-translation/audio';

  const audio = await downloadAudioViaSabr(videoId, durationMs, signal, (done, total) =>
    onProgress?.(`download ${Math.min(99, Math.floor((done / total) * 100))}%`)
  );
  const totalChunks = Math.max(1, Math.ceil(audio.length / AUDIO_CHUNK_SIZE));
  const fileId = `random-web_sabr-${generateUUID().toLowerCase()}`;

  for (let i = 0; i < totalChunks; i++) {
    if (signal.aborted) break;
    onProgress?.(`upload ${i + 1}/${totalChunks}`);
    if (i > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, UPLOAD_CHUNK_PAUSE_MS));
    }
    const chunk = audio.subarray(i * AUDIO_CHUNK_SIZE, (i + 1) * AUDIO_CHUNK_SIZE);
    const isLast = i === totalChunks - 1;
    const body = encodePartialAudioRequest(
      translationId,
      videoUrl,
      chunk,
      i,
      isLast ? totalChunks : 0,
      fileId
    );
    // eslint-disable-next-line no-await-in-loop
    const headers = await getVtransHeaders(session, body, path);
    // eslint-disable-next-line no-await-in-loop
    await workerRequest(
      'PUT',
      path,
      { proto: body },
      headers,
      signal,
      AUDIO_UPLOAD_TIMEOUT_MS
    );
  }
}

// Fallback: notify Yandex that audio download was attempted but failed
async function sendFallbackAudioNotify(
  videoId: string,
  url: string,
  translationId: string,
  session: Session,
  signal: AbortSignal
): Promise<void> {
  const path = '/video-translation/audio';
  const audioInfo = new ProtoWriter()
    .string(1, `fallback-empty-audio:video-translation:${videoId}`)
    .bytes(2, new Uint8Array(0))
    .finish();
  const body = new ProtoWriter()
    .string(1, translationId)
    .string(2, url)
    .bytes(6, audioInfo)
    .finish();
  const headers = await getVtransHeaders(session, body, path);
  await workerRequest('PUT', path, { proto: body }, headers, signal);
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

export type YandexSubtitleTrack = {
  language: string;
  url: string;
  translatedLanguage: string;
  translatedUrl: string;
};

function decodeSubtitleTrack(data: Uint8Array): YandexSubtitleTrack {
  const reader = new ProtoReader(data);
  const track: YandexSubtitleTrack = {
    language: '',
    url: '',
    translatedLanguage: '',
    translatedUrl: ''
  };
  while (reader.position < reader.length) {
    const { field, type } = reader.readTag();
    if (field === 1) track.language = reader.readString();
    else if (field === 2) track.url = reader.readString();
    else if (field === 4) track.translatedLanguage = reader.readString();
    else if (field === 5) track.translatedUrl = reader.readString();
    else reader.skip(type);
  }
  return track;
}

export async function getYandexSubtitles(
  videoId: string,
  fromLang: string,
  signal: AbortSignal
): Promise<{ waiting: boolean; tracks: YandexSubtitleTrack[] }> {
  const path = '/video-subtitles/get-subtitles';
  const session = await getSession();
  const body = new ProtoWriter()
    .string(1, `https://youtu.be/${videoId}`)
    .string(2, fromLang)
    .finish();
  const headers = await getVtransHeaders(session, body, path, 'Vsubs');
  const res = await workerRequest('POST', path, { proto: body }, headers, signal);
  if (!res.success || !(res.data instanceof ArrayBuffer)) {
    throw new Error(`Subtitles: ${typeof res.data === 'string' ? res.data : res.status}`);
  }
  const reader = new ProtoReader(new Uint8Array(res.data));
  let waiting = false;
  const tracks: YandexSubtitleTrack[] = [];
  while (reader.position < reader.length) {
    const { field, type } = reader.readTag();
    if (field === 1) waiting = reader.readInt32() === 1;
    else if (field === 2) tracks.push(decodeSubtitleTrack(reader.readBytes()));
    else reader.skip(type);
  }
  return { waiting, tracks };
}

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
  useLivelyVoice = false,
  apiToken = '',
  forceSourceLang = false,
  videoTitle = '',
  bypassCache = false
): Promise<VotTranslationResult> {
  const url = `https://youtu.be/${videoId}`;
  let audioHandled = false;
  let bypassCacheUsed = bypassCache;
  let shouldRetryCount = 0;
  // Lively voice needs a Yandex account: with a token the request is sent
  // authorized (Authorization: OAuth ...), anonymously we try briefly and
  // fall back to the standard voice if the server declines
  let lively = useLivelyVoice;
  const livelyHeaders = (): Record<string, string> =>
    lively && apiToken ? { Authorization: `OAuth ${apiToken}` } : {};

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted)
      throw Object.assign(new Error('Translation aborted'), {
        name: 'AbortError'
      });

    if (lively && !apiToken && attempt >= LIVELY_MAX_ATTEMPTS) {
      console.warn('[VOT] lively voice not ready, falling back to standard');
      lively = false;
      attempt = -1; // restart the retry budget for the standard voice
      onWaiting?.(0, 'lively-fallback');
      continue;
    }

    const session = await getSession();
    const body = encodeTranslationRequest(
      url,
      duration,
      fromLang,
      toLang,
      bypassCache,
      lively,
      forceSourceLang,
      videoTitle
    );
    const res = await sendTranslationRequest(
      body,
      session,
      signal,
      livelyHeaders()
    );

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
      onWaiting?.(0, 'lively-fallback');
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
          lively,
          forceSourceLang,
          videoTitle
        );
        const bypassSession = await getSession();
        const bypassRes = await sendTranslationRequest(
          bypassBody,
          bypassSession,
          signal,
          livelyHeaders()
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
        onWaiting?.(0, 'lively-fallback');
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
      return {
        translated: true,
        url: data.url,
        usedLivelyVoice: data.isLivelyVoice,
        detectedLang: data.language
      };
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
          duration * 1000,
          session,
          signal,
          (message) => onWaiting?.(0, message)
        );
      } catch (err) {
        console.warn(
          '[VOT] Audio download failed, falling back to fail-audio-js:',
          err
        );
        await sendFailAudioJs(url, signal);
        await sendFallbackAudioNotify(
          videoId,
          url,
          data.translationId,
          session,
          signal
        );
      }
      continue;
    }

    onWaiting?.(data.remainingTime, data.message || `~${data.remainingTime}s`);
    await waitPoll(signal, data.remainingTime);
  }

  throw new Error('Translation timed out');
}
