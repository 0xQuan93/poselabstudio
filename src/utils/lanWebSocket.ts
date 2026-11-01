/**
 * LAN-only WebSocket URL guards.
 * Rejects public internet hosts so ARKit face coefficients never leave the
 * local network. Used by the optional iPhone FaceTracking companion.
 */

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isPrivateIPv4(host: string): boolean {
  return PRIVATE_V4.some((pattern) => pattern.test(host));
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized === '0:0:0:0:0:0:0:1'
  );
}

export function isLanHostname(hostname: string): boolean {
  const host = stripBrackets(hostname.trim().toLowerCase());
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return true;
  return false;
}

export function assertLanWebSocketUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Companion URL is not a valid WebSocket address.');
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Companion URL must use ws:// or wss:// on your LAN.');
  }

  if (!isLanHostname(parsed.hostname)) {
    throw new Error(
      'Companion URL must be a LAN address (localhost, 10.x, 172.16–31.x, 192.168.x, .local). Public cloud hosts are blocked.',
    );
  }

  return parsed;
}

export function isLanWebSocketUrl(raw: string): boolean {
  try {
    assertLanWebSocketUrl(raw);
    return true;
  } catch {
    return false;
  }
}

export function isPrivateRemoteAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const host = address.replace(/^::ffff:/, '');
  return isLanHostname(host);
}
