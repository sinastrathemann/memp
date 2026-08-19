import { withBasePath } from "../base-path";

export interface ApiError {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, body: { error?: ApiError } | string) {
    const msg =
      typeof body === "object" && body?.error?.message ? body.error.message : `HTTP ${status}`;
    super(msg);
    this.status = status;
    this.code = typeof body === "object" && body?.error?.code ? body.error.code : "UNKNOWN";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // withBasePath ist Pflicht, nicht Kosmetik: hinter dem Agent Hub liegt die App
  // unter /<slug>/, und wurzel-absolute /api/*-Aufrufe landen sonst bei der
  // Hub-eigenen API (reservierter Pfad laut Hub-Vertrag) statt bei mEXP.
  const url = withBasePath(path.startsWith("/api") ? path : `/api${path}`);
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    throw new ApiRequestError(res.status, body as { error?: ApiError } | string);
  }
  return body as T;
}
