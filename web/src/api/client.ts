import type { ErrorBody } from "./types";

/** Every non-2xx response (and network failure, status 0) surfaces as an ApiError. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

let onLocked: () => void = () => {
  if (window.location.pathname !== "/unlock") window.location.assign("/unlock");
};

/** The router installs a handler so a 401 `locked` becomes a client-side redirect. */
export function setLockedHandler(handler: () => void): void {
  onLocked = handler;
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const err = (value as { error: unknown }).error;
  return typeof err === "object" && err !== null && "code" in err;
}

/** Converts a failed response into an ApiError (and triggers the lock redirect). */
export async function toApiError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || "Request failed";
  try {
    const body: unknown = await res.json();
    if (isErrorBody(body)) {
      code = body.error.code;
      message = body.error.message || message;
    }
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401 && code === "locked") onLocked();
  return new ApiError(res.status, code, message);
}

export function errorFromXhr(xhr: XMLHttpRequest): ApiError {
  let code = `http_${xhr.status}`;
  let message = xhr.statusText || "Upload failed";
  try {
    const body: unknown = JSON.parse(xhr.responseText);
    if (isErrorBody(body)) {
      code = body.error.code;
      message = body.error.message || message;
    }
  } catch {
    /* non-JSON error body */
  }
  if (xhr.status === 401 && code === "locked") onLocked();
  return new ApiError(xhr.status, code, message);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  keepalive?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      keepalive: opts.keepalive,
      credentials: "same-origin",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Can't reach the awdio server");
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function requestBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { signal, credentials: "same-origin" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Can't reach the awdio server");
  }
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}
