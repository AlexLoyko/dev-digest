/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */

import type { BriefResponse, StoredBrief } from "@devdigest/shared";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

/** The known fields of a discriminated failure body that isn't shaped
 *  `{error: {...}}` — e.g. `POST /pulls/:id/brief/generate`'s `{reason,
 *  hasPriorBrief}` (SPEC-02, `server/docs/api-contracts.md`). Narrow on
 *  purpose: callers read `error.body?.reason` without casting through
 *  `any`, for whichever route's failure shape they happen to know about. */
export interface ApiErrorBody {
  reason?: string;
  hasPriorBrief?: boolean;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  /** The parsed JSON failure body when it is JSON but NOT `{error: {...}}`
   *  shaped — that shape's own fields land on `code`/`message`/`details`
   *  above instead, exactly as before. `undefined` for a network failure,
   *  a non-JSON body, or an `{error: {...}}`-wrapped body. */
  body?: ApiErrorBody;
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    body?: ApiErrorBody,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.body = body;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
        // Fastify's "Body cannot be empty when content-type is application/json".
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // network failure / API down → full-screen error candidate
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      "network_error",
      e
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    let structuredBody: ApiErrorBody | undefined;
    try {
      const parsedBody = await res.json();
      if (parsedBody?.error) {
        code = parsedBody.error.code;
        message = parsedBody.error.message ?? message;
        details = parsedBody.error.details;
      } else if (parsedBody != null && typeof parsedBody === "object") {
        // A JSON failure body shaped differently from `{error: {...}}` —
        // e.g. the brief-generation route's discriminated `{reason,
        // hasPriorBrief}` body. There's no known `message` field on this
        // shape, so `message` stays the generic status-line fallback; the
        // body itself is preserved so a caller that knows this route's
        // shape can still read it off `ApiError.body`.
        structuredBody = parsedBody as ApiErrorBody;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details, structuredBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

/* ---------------------------------------------------------------------------
 * PR Brief (SPEC-02) — GET /pulls/:id/brief, POST /pulls/:id/brief/generate.
 * ------------------------------------------------------------------------- */

export function fetchBrief(prId: string | number): Promise<BriefResponse> {
  return api.get<BriefResponse>(`/pulls/${prId}/brief`);
}

/** `POST /pulls/:id/brief/generate` returns `StoredBrief` on success — NOT
 *  `BriefResponse` (that shape is `GET`'s only: `{brief, meta, stale,
 *  latest_run}`). `StoredBrief` is `BriefMeta & {brief: PrBrief}` — no
 *  `stale`/`latest_run` fields, since a fresh generation is by definition not
 *  stale and this route doesn't resolve the PR's latest run (server/docs/
 *  api-contracts.md, "PR Brief"). On failure the server sends a
 *  discriminated `{reason, hasPriorBrief}` body instead, surfaced via
 *  `ApiError.body`, not this return type. */
export function generateBrief(prId: string | number): Promise<StoredBrief> {
  return api.post<StoredBrief>(`/pulls/${prId}/brief/generate`);
}
