import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./api";

/**
 * Last answer per path, so coming back to a screen shows it at once (then refreshes) instead of a spinner.
 * Emptied on login/logout so one user never sees another's numbers.
 */
const cache = new Map<string, unknown>();
const CACHE_MAX = 60;
const remember = (path: string, value: unknown) => {
  cache.delete(path);
  cache.set(path, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
};
export const clearDataCache = () => cache.clear();

/** GET a path and keep the result. Pass null to skip. `reload()` fetches again. */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(() => (path && cache.has(path) ? (cache.get(path) as T) : null));
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    if (cache.has(path)) setData(cache.get(path) as T);
    setLoading(true);
    try {
      const r = await get<T>(path);
      remember(path, r);
      if (my === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}
