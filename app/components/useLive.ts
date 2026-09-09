"use client";

import { useEffect, useState } from "react";

export type LiveState<T> = {
  data: T | null;
  live: boolean;      // true once real backend data arrived
  loading: boolean;
  error: string | null;
};

/**
 * Fetch from an API route, falling back to the sample data the page ships with.
 *
 * The fallback is deliberate: before contracts are deployed and env vars are set,
 * every route returns an error, and a blank page makes the site look broken during
 * development. What must never happen is sample data being presented as real — so
 * `live` is returned separately and the pages render a visible banner whenever it
 * is false.
 */
export function useLive<T>(url: string, fallback: T, enabled = true): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({
    data: fallback, live: false, loading: enabled, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    // `enabled` false: an expensive read the page has not asked for yet (a tab that is
    // not open). Nothing is fetched; the state says "not loading" so no spinner spins.
    if (!enabled) {
      setState((s) => (s.loading ? { ...s, loading: false } : s));
      return () => { cancelled = true; };
    }
    // A new url is a new read: keep whatever is on screen but say it is being refreshed,
    // so a page does not present the previous url's payload as the answer for this one.
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    (async () => {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || json?.error) {
          setState({ data: fallback, live: false, loading: false, error: json?.error ?? `HTTP ${res.status}` });
        } else {
          setState({ data: json as T, live: true, loading: false, error: null });
        }
      } catch (err: any) {
        if (!cancelled) {
          setState({ data: fallback, live: false, loading: false, error: err?.message ?? "network error" });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);

  return state;
}
