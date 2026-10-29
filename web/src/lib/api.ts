export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: { path: (string | number)[]; message: string; code?: string; minimum?: number; maximum?: number; type?: string }[],
  ) {
    super(message);
  }
  /** Field-level messages keyed by the first path segment. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of this.issues ?? []) {
      const k = String(i.path[0] ?? "");
      if (k && !out[k]) out[k] = i.message;
    }
    return out;
  }
}

/** How long one request may take before we give up (slow connections). Uploads and backups get longer. */
const TIMEOUT_MS = 25_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(method: string, path: string, body: unknown, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw ctrl.signal.aborted ? new ApiError(0, "timeout", "The request took too long.") : new ApiError(0, "network", "Cannot reach the server.");
  } finally {
    clearTimeout(timer);
  }
}

export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const timeoutMs = body !== undefined && JSON.stringify(body).length > 200_000 ? 120_000 : TIMEOUT_MS;
  let res: Response;
  try {
    res = await send(method, path, body, timeoutMs);
  } catch (e) {
    // A read that failed on a shaky line is safe to try once more; a write is not (it may have gone through).
    if (method !== "GET") throw e;
    await sleep(1200);
    res = await send(method, path, body, timeoutMs);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; issues?: ApiError["issues"] };
  if (!res.ok) {
    if (res.status === 401 && json.error === "not_logged_in") window.dispatchEvent(new Event("jjs:logged-out"));
    throw new ApiError(res.status, json.error ?? "generic", json.message ?? "Request failed", json.issues);
  }
  return json as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const put = <T>(path: string, body: unknown) => api<T>("PUT", path, body);
export const del = <T>(path: string) => api<T>("DELETE", path);
