import type { CookieOptions, Request, Response } from 'express';
import type { SessionAudience } from '../generated/prisma/client';

export const REFRESH_COOKIES: Record<SessionAudience, { name: string; path: string }> = {
  DASHBOARD: { name: 'wc_rt', path: '/api/auth' },
  SHOWROOM: { name: 'wc_srt', path: '/api/auth/showroom' },
};

/**
 * Non-secret "a session probably exists" hints on path "/", so the web app's
 * proxy can redirect signed-out visitors before rendering a protected page and
 * skip a pointless refresh call. They hold only "1" and grant nothing (so they
 * are readable by JavaScript); every API call still needs a valid access token.
 */
export const SESSION_HINT_COOKIES: Record<SessionAudience, string> = {
  DASHBOARD: 'wc_session',
  SHOWROOM: 'wc_showroom',
};

/**
 * Cookie-authenticated endpoints (refresh, logout) also require this header.
 * A cross-site form or <img> cannot set it, and a cross-origin fetch that sets
 * it triggers a CORS preflight that the allowlist rejects.
 */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'wolfcar';

function options(audience: SessionAudience, secure: boolean, expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIES[audience].path,
    ...(expires ? { expires } : {}),
  };
}

function hintOptions(secure: boolean, expires?: Date): CookieOptions {
  return { httpOnly: false, secure, sameSite: 'lax', path: '/', ...(expires ? { expires } : {}) };
}

export function setRefreshCookie(res: Response, audience: SessionAudience, token: string, expires: Date, secure: boolean): void {
  res.cookie(REFRESH_COOKIES[audience].name, token, options(audience, secure, expires));
  res.cookie(SESSION_HINT_COOKIES[audience], '1', hintOptions(secure, expires));
}

export function clearRefreshCookie(res: Response, audience: SessionAudience, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIES[audience].name, options(audience, secure));
  res.clearCookie(SESSION_HINT_COOKIES[audience], hintOptions(secure));
}

export function readRefreshCookie(req: Request, audience: SessionAudience): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[REFRESH_COOKIES[audience].name];
  return typeof value === 'string' && value.length > 0 && value.length < 200 ? value : undefined;
}

export function hasCsrfHeader(req: Request): boolean {
  return req.headers[CSRF_HEADER] === CSRF_VALUE;
}
/** Sales slots page: a signed token, not a refresh token (there is no user and nothing to rotate). */
export const SLOTS_COOKIE = { name: 'wc_slt', path: '/api/slots' };
export const SLOTS_HINT_COOKIE = 'wc_slots';

export function setSlotsCookie(res: Response, token: string, expires: Date, secure: boolean): void {
  res.cookie(SLOTS_COOKIE.name, token, { httpOnly: true, secure, sameSite: 'strict', path: SLOTS_COOKIE.path, expires });
  res.cookie(SLOTS_HINT_COOKIE, '1', hintOptions(secure, expires));
}

export function readSlotsCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[SLOTS_COOKIE.name];
  return typeof value === 'string' && value.length > 0 && value.length < 1000 ? value : undefined;
}

/**
 * Website customers (online checkout): a signed token in an httpOnly cookie
 * scoped to /api/shop, like the sales-slots cookie; no refresh rotation.
 * The readable hint on "/" only tells the website a session probably exists.
 */
export const CUSTOMER_COOKIE = { name: 'wc_cst', path: '/api/shop' };
export const CUSTOMER_HINT_COOKIE = 'wc_customer';

function customerOptions(secure: boolean, expires?: Date): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: CUSTOMER_COOKIE.path, ...(expires ? { expires } : {}) };
}

export function setCustomerCookie(res: Response, token: string, expires: Date, secure: boolean): void {
  res.cookie(CUSTOMER_COOKIE.name, token, customerOptions(secure, expires));
  res.cookie(CUSTOMER_HINT_COOKIE, '1', hintOptions(secure, expires));
}

export function clearCustomerCookie(res: Response, secure: boolean): void {
  res.clearCookie(CUSTOMER_COOKIE.name, customerOptions(secure));
  res.clearCookie(CUSTOMER_HINT_COOKIE, hintOptions(secure));
}

export function readCustomerCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[CUSTOMER_COOKIE.name];
  return typeof value === 'string' && value.length > 0 && value.length < 1000 ? value : undefined;
}
