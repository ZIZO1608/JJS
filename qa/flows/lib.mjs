// Tiny API client for QA flow scripts. BASE defaults to the QA server.
export const BASE = process.env.BASE ?? "http://127.0.0.1:4420";
export function client(prefix = "/api") {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + prefix + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
}
export async function login(username, password) {
  const c = client();
  const r = await c("POST", "/auth/login", { username, password });
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${JSON.stringify(r.json)}`);
  return c;
}
