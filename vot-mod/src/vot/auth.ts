import { configWrite } from '../config';

// Deployed vot-auth-server (Yandex OAuth device-flow broker). Override at
// build time by putting the URL in vot-mod/auth-server-url.txt — the patcher
// bakes it into this constant. Empty = QR login disabled.
export const AUTH_SERVER = '__VOT_AUTH_SERVER__';

export function isAuthServerConfigured(): boolean {
  return /^https?:\/\//.test(AUTH_SERVER);
}

type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_url: string;
  interval: number;
  expires_in: number;
};

async function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${AUTH_SERVER}${path}`, init);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function qrImageUrl(data: string): string {
  return `${AUTH_SERVER}/qr?data=${encodeURIComponent(data)}`;
}

export async function startDeviceAuth(): Promise<DeviceStart> {
  return post<DeviceStart>('/device/start');
}

export type PollResult =
  | { status: 'ok'; access_token: string }
  | { status: 'pending'; error?: string };

/**
 * Poll the broker until the user confirms on their phone (or timeout).
 * On success writes the token into votAccountToken and returns it.
 */
export async function waitForDeviceToken(
  deviceCode: string,
  intervalSec: number,
  expiresInSec: number,
  onTick?: (secondsLeft: number) => void,
  isCancelled?: () => boolean
): Promise<string | null> {
  const deadline = expiresInSec;
  let elapsed = 0;
  const step = Math.max(3, intervalSec);

  while (elapsed < deadline) {
    if (isCancelled?.()) return null;
    await new Promise((r) => setTimeout(r, step * 1000));
    elapsed += step;
    if (isCancelled?.()) return null;

    let result: PollResult;
    try {
      result = await post<PollResult>('/device/poll', {
        device_code: deviceCode
      });
    } catch {
      onTick?.(deadline - elapsed);
      continue;
    }

    if (result.status === 'ok' && result.access_token) {
      configWrite('votAccountToken', result.access_token);
      return result.access_token;
    }
    if (result.status === 'pending' && result.error === 'expired_token') {
      return null;
    }
    onTick?.(deadline - elapsed);
  }
  return null;
}
