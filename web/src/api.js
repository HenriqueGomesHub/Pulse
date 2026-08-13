import { useCallback, useEffect, useState } from 'react';

export const POLL_MS = 30000;

async function fetchJson(path, signal) {
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.text()).trim();
    throw new Error(`GET ${path} responded ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 400)}` : ''}`);
  }
  return res.json();
}

export function usePoll(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false, updatedAt: null });
      return undefined;
    }
    const controller = new AbortController();
    let live = true;

    const load = () =>
      fetchJson(path, controller.signal).then(
        (data) => {
          if (live) setState({ data, error: null, loading: false, updatedAt: Date.now() });
        },
        (error) => {
          if (!live || error.name === 'AbortError') return;
          setState((prev) => ({ ...prev, error, loading: false }));
        }
      );

    load();
    const timer = setInterval(load, POLL_MS);

    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [path, attempt]);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, refetch };
}
