import type { HandlerEvent } from '@netlify/functions';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE_NAME = 'poselab_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SignedSession {
  discordId: string;
  username: string | null;
  roles: string[];
  exp: number;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function getSessionSecret() {
  return process.env.LP_SESSION_SECRET
    || process.env.DISCORD_CLIENT_SECRET
    || process.env.DISCORD_BOT_TOKEN
    || process.env.VITE_DISCORD_BOT_TOKEN
    || '';
}

function signPayload(payload: string) {
  const secret = getSessionSecret();
  if (!secret) throw new Error('Missing LP_SESSION_SECRET or Discord server secret');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function parseCookies(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((entry) => {
    const separator = entry.indexOf('=');
    if (separator === -1) return;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (key) cookies[key] = value;
  });

  return cookies;
}

export function createSessionCookie(session: Omit<SignedSession, 'exp'>, isSecure: boolean) {
  const payload = base64UrlEncode(JSON.stringify({
    ...session,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  }));
  const signature = signPayload(payload);
  const sameSite = isSecure ? 'SameSite=None; Secure' : 'SameSite=Lax';

  return `${SESSION_COOKIE_NAME}=${payload}.${signature}; Path=/; ${sameSite}; HttpOnly; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(isSecure: boolean) {
  const sameSite = isSecure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  return `${SESSION_COOKIE_NAME}=; Path=/; ${sameSite}; HttpOnly; Max-Age=0`;
}

export function readSignedSession(event: HandlerEvent): SignedSession | null {
  const cookieHeader = event.headers.cookie || event.headers.Cookie;
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = signPayload(payload);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== signatureBuffer.length
    || !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as SignedSession;
    if (!session.discordId || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}
