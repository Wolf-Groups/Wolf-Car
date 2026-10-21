import type { AuthResult } from "./types";

export type Audience = "dashboard" | "showroom";

export interface FieldError {
  field: string;
  messages: string[];
}

/** Error thrown for every non-2xx API response. `code` is stable and translatable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly errors: FieldError[] = [],
    readonly retryAfterSeconds?: number,
    readonly requestId?: string,
    /** PRODUCT_UNAVAILABLE: the basket lines the API refused */
    readonly productIds?: string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const CSRF = { "X-Requested-With": "wolfcar" };
const REFRESH_PATH: Record<Audience, string> = { dashboard: "/api/auth/refresh", showroom: "/api/auth/showroom/refresh" };
/** Set by the API next to the httpOnly refresh cookie; only says "a session probably exists". */
const SESSION_HINT: Record<Audience, string> = { dashboard: "wc_session", showroom: "wc_showroom" };

export function hasSessionHint(audience: Audience): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith(`${SESSION_HINT[audience]}=`));
}

/** Access tokens live only in memory (never in storage); the refresh token is an httpOnly cookie. */
const tokens: Record<Audience, string | null> = { dashboard: null, showroom: null };
const inflight: Partial<Record<Audience, Promise<AuthResult | null>>> = {};
const listeners = new Set<(audience: Audience) => void>();

export function setAccessToken(audience: Audience, token: string | null): void {
  tokens[audience] = token;
}

/** Called when a session can no longer be refreshed (expired, revoked, password changed). */
export function onSessionExpired(listener: (audience: Audience) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function toApiError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON error (proxy, network)
  }
  return new ApiError(
    res.status,
    typeof body.message === "string" ? body.message : res.statusText || "Request failed",
    typeof body.code === "string" ? body.code : undefined,
    Array.isArray(body.errors) ? (body.errors as FieldError[]) : [],
    typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined,
    typeof body.requestId === "string" ? body.requestId : undefined,
    Array.isArray(body.productIds) && body.productIds.every((x) => typeof x === "string") ? (body.productIds as string[]) : undefined,
  );
}

/**
 * Exchanges the refresh cookie for a new access token. One refresh at a time
 * per tab (single-flight) and across tabs (Web Locks), because refresh tokens
 * rotate and a stale one would be treated as reuse.
 */
export function refreshSession(audience: Audience): Promise<AuthResult | null> {
  const pending = inflight[audience];
  if (pending) return pending;
  const run = async (): Promise<AuthResult | null> => {
    const res = await fetch(REFRESH_PATH[audience], { method: "POST", headers: CSRF, credentials: "same-origin" });
    if (!res.ok) {
      tokens[audience] = null;
      return null;
    }
    const result = (await res.json()) as AuthResult;
    tokens[audience] = result.accessToken;
    return result;
  };
  const exec = async (): Promise<AuthResult | null> =>
    typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request(`wolfcar-refresh-${audience}`, run)
      : await run();
  const promise = exec().finally(() => {
    delete inflight[audience];
  });
  inflight[audience] = promise;
  return promise;
}

export interface RequestOptions {
  audience?: Audience;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Low-level request returning the Response (used for file downloads). */
export async function apiRaw(path: string, options: RequestOptions = {}): Promise<Response> {
  const audience = options.audience ?? "dashboard";
  const url = `/api${path}${buildQuery(options.query)}`;
  const send = () => {
    const headers: Record<string, string> = { ...CSRF, ...options.headers };
    const token = tokens[audience];
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (options.form) body = options.form;
    else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    return fetch(url, { method: options.method ?? "GET", headers, body, credentials: "same-origin", signal: options.signal });
  };

  let res = await send();
  if (res.status === 401) {
    const refreshed = await refreshSession(audience);
    if (refreshed) res = await send();
    else listeners.forEach((l) => l(audience));
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

/** JSON request with automatic token refresh; throws ApiError on failure. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await apiRaw(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Unauthenticated JSON POST (login endpoints). */
export async function publicPost<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { ...CSRF, "Content-Type": "application/json" },
    body: JSON.stringify(json),
    credentials: "same-origin",
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export async function logoutSession(audience: Audience): Promise<void> {
  const path = audience === "showroom" ? "/api/auth/showroom/logout" : "/api/auth/logout";
  tokens[audience] = null;
  await fetch(path, { method: "POST", headers: CSRF, credentials: "same-origin" }).catch(() => undefined);
}
