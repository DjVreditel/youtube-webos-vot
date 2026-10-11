export let simulatorMode = false;
let cachedWebOSVersion = undefined;

const WEBOS_YEAR_MAP = {
  2016: 3,
  2017: 3,
  2018: 4,
  2019: 4,
  2020: 5,
  2021: 6,
  2022: 22,
  2023: 23,
  2024: 24,
  2025: 25
};

export function getWebOSVersion() {
  if (cachedWebOSVersion !== undefined) {
    return cachedWebOSVersion;
  }

  const ua = window.navigator.userAgent;

  // 1. Check Platform Year
  const platformMatch = ua.match(/webOS\.TV-(\d{4})/);
  if (platformMatch) {
    const year = parseInt(platformMatch[1], 10);
    // Since 2022 the webOS version is the platform year (webOS 22, 23, ...),
    // so 2026 and later TVs need no table entry - without this they fell
    // through to the Chrome check and were treated as a simulator.
    const version = WEBOS_YEAR_MAP[year] || (year > 2025 ? year - 2000 : undefined);
    if (version) {
      cachedWebOSVersion = version;
      console.info(`[WebOSUtils] Detected webOS ${cachedWebOSVersion} via platform year: ${year}`);
      return cachedWebOSVersion;
    }
  }

  // 2. Check Firmware Version (Fallback for webOS 25+)
  const firmwareMatch = ua.match(/_TV_O18\/(\d+\.\d+\.\d+)/);
  if (firmwareMatch) {
    const majorVersion = parseInt(firmwareMatch[1].split('.')[0], 10);
    if (majorVersion >= 33) {
      cachedWebOSVersion = 25;
      console.info(`[WebOSUtils] Detected webOS 25 via firmware version: ${firmwareMatch[1]}`);
      return cachedWebOSVersion;
    }
  }

  // 3. Fallback: Chrome version detection (for simulator environments)
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  if (chromeMatch) {
    const chromeVersion = parseInt(chromeMatch[1], 10);
    console.info(`[WebOSUtils] Detected Chrome version: ${chromeVersion} (simulator mode)`);
    simulatorMode = true;

    if (chromeVersion >= 120) {
      cachedWebOSVersion = 25;
    } else if (chromeVersion <= 53) { // webOS 4
      cachedWebOSVersion = 4;
    } else {
      cachedWebOSVersion = 6;
    }
    return cachedWebOSVersion;
  }

  console.warn('[WebOSUtils] Could not detect webOS version from user agent. Defaulting to 6.');
  return cachedWebOSVersion = 6;
}

export function isWebOS25() {
  return getWebOSVersion() >= 25;
}

export function isLegacyWebOS() {
  const version = getWebOSVersion();
  return version >= 3 && version <= 6;
}