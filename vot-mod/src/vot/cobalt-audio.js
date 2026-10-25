import createMinimp3 from './minimp3.js';

const FRAMES_PER_SLICE = 25;
const COPY_LEAD_S = 0.35;
const LATE_START_S = 0.03;
const MAX_START_CORRECTIONS = 2;
let minimp3 = null;

export function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    output[i] = input[index] + (input[next] - input[index]) * (position - index);
  }
  return output;
}

export function decodeMp3(data, targetRate) {
  minimp3 = minimp3 || createMinimp3();
  return minimp3.then(
    (module) =>
      new Promise((resolve, reject) => {
        const bytes = new Uint8Array(data);
        const pointer = module._malloc(bytes.length);
        module.HEAPU8.set(bytes, pointer);
        module._mp3_init();
        const pieces = [];
        let total = 0;
        let rate = 0;
        let channels = 0;
        let offset = 0;
        const step = () => {
          for (let frame = 0; frame < FRAMES_PER_SLICE && offset < bytes.length; frame++) {
            const samples = module._mp3_decode(pointer + offset, bytes.length - offset);
            const info = module._mp3_frame() >> 2;
            const used = module.HEAP32[info];
            if (!used) {
              offset = bytes.length;
              break;
            }
            offset += used;
            if (samples) {
              channels = module.HEAP32[info + 1];
              rate = module.HEAP32[info + 2];
              const pcm = module._mp3_pcm() >> 1;
              pieces.push(module.HEAP16.slice(pcm, pcm + samples * channels));
              total += samples;
            }
          }
          if (offset < bytes.length) {
            setTimeout(step, 0);
            return;
          }
          module._free(pointer);
          if (!total) {
            reject(new Error('mp3 decode failed'));
            return;
          }
          const result = [];
          for (let channel = 0; channel < channels; channel++) {
            const samples = new Float32Array(total);
            let index = 0;
            pieces.forEach((piece) => {
              for (let i = channel; i < piece.length; i += channels) samples[index++] = piece[i] / 32768;
            });
            result.push(resample(samples, rate, targetRate));
          }
          resolve(result);
        };
        step();
      })
  );
}

export function needsAudioShim(context) {
  return typeof context.suspend !== 'function' || typeof context.createGain !== 'function';
}

export function wrapAudioContext(native, clock = () => performance.now() / 1000, lead = COPY_LEAD_S) {
  let state = 'running';
  let pausedAt = 0;
  let pausedTotal = 0;
  const playing = new Set();
  let volume = 1;
  let pendingStarts = 0;
  let deferredStops = [];

  const now = () => (state === 'suspended' ? pausedAt : clock()) - pausedTotal;

  function halt(source) {
    try {
      source.stop();
    } catch (error) {
      void error;
    }
    source.disconnect();
  }

  function settleStart() {
    pendingStarts--;
    if (pendingStarts > 0) return;
    deferredStops.forEach(halt);
    deferredStops = [];
  }

  function stopNative(proxy, afterPendingStarts = false) {
    const source = proxy._native;
    if (!source) return;
    proxy._native = null;
    source.onended = null;
    if (afterPendingStarts && pendingStarts > 0) deferredStops.push(source);
    else halt(source);
  }

  function pausePlaying() {
    const position = now();
    playing.forEach((proxy) => {
      if (!proxy._native) return;
      proxy._offset += position - proxy._startedAt;
      stopNative(proxy);
    });
  }

  function bufferFrom(buffer, offset) {
    const channels = buffer && buffer.__ytafChannels;
    if (!channels || (offset <= 0 && volume === 1)) return buffer;
    const from = Math.min(channels[0].length, Math.round(Math.max(0, offset) * native.sampleRate));
    const length = Math.max(1, channels[0].length - from);
    const trimmed = native.createBuffer(channels.length, length, native.sampleRate);
    channels.forEach((samples, channel) => {
      const part = samples.subarray(from, from + length);
      const scaled = new Float32Array(Math.max(1, part.length));
      for (let i = 0; i < part.length; i++) scaled[i] = part[i] * volume;
      trimmed.copyToChannel(scaled, channel);
    });
    return trimmed;
  }

  function startNative(proxy) {
    const copies = !!(proxy.buffer && proxy.buffer.__ytafChannels) && (proxy._offset > 0 || volume !== 1);
    const ahead = copies ? lead : 0;
    const requestedAt = now();
    proxy._offset += ahead;
    proxy._startedAt = requestedAt + ahead;
    const source = native.createBufferSource();
    source.buffer = bufferFrom(proxy.buffer, proxy._offset);
    source.connect(native.destination);
    source.onended = () => {
      if (proxy._native !== source) return;
      proxy._native = null;
      playing.delete(proxy);
      if (proxy.onended) proxy.onended();
    };
    proxy._native = source;
    pendingStarts++;
    const begin = () => {
      if (proxy._native === source) {
        source.start(0);
        const late = now() - proxy._startedAt;
        if (late > LATE_START_S && proxy._corrections < MAX_START_CORRECTIONS) {
          proxy._corrections++;
          console.debug('[VOT] audio started late, ms:', Math.round(late * 1000));
          proxy._offset += late;
          stopNative(proxy, true);
          startNative(proxy);
        } else {
          proxy._corrections = 0;
        }
      }
      settleStart();
    };
    const wait = proxy._startedAt - now();
    if (wait > 0.005) setTimeout(begin, wait * 1000);
    else begin();
  }

  function createBufferSource() {
    const proxy = {
      buffer: null,
      onended: null,
      playbackRate: { value: 1 },
      _native: null,
      _offset: 0,
      _startedAt: 0,
      _corrections: 0,
      connect() {},
      disconnect() {},
      start(when, offset) {
        proxy._offset = offset || 0;
        playing.add(proxy);
        if (state === 'running') startNative(proxy);
        else proxy._startedAt = now();
      },
      stop() {
        playing.delete(proxy);
        stopNative(proxy, true);
      }
    };
    return proxy;
  }

  return {
    get state() {
      return state;
    },
    get currentTime() {
      return now();
    },
    get sampleRate() {
      return native.sampleRate;
    },
    destination: native.destination,
    decodeAudioData(data, onSuccess, onError) {
      return decodeMp3(data, native.sampleRate).then(
        (channels) => {
          const buffer = native.createBuffer(channels.length, channels[0].length, native.sampleRate);
          channels.forEach((samples, channel) => buffer.copyToChannel(samples, channel));
          buffer.__ytafChannels = channels;
          if (onSuccess) onSuccess(buffer);
          return buffer;
        },
        (error) => {
          if (!onError) throw error;
          onError(error);
          return null;
        }
      );
    },
    createBuffer(...args) {
      return native.createBuffer(...args);
    },
    createBufferSource,
    createGain() {
      return {
        gain: {
          get value() {
            return volume;
          },
          set value(next) {
            volume = next;
            if (state !== 'running') return;
            pausePlaying();
            playing.forEach((proxy) => startNative(proxy));
          }
        },
        connect() {},
        disconnect() {}
      };
    },
    suspend() {
      if (state === 'running') {
        pausePlaying();
        pausedAt = clock();
        state = 'suspended';
      }
      return Promise.resolve();
    },
    resume() {
      if (state === 'suspended') {
        pausedTotal += clock() - pausedAt;
        state = 'running';
        playing.forEach((proxy) => startNative(proxy));
      }
      return Promise.resolve();
    },
    close() {
      playing.forEach((proxy) => stopNative(proxy));
      playing.clear();
      state = 'closed';
      return Promise.resolve();
    }
  };
}
