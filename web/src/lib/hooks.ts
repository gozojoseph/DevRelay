import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const loadedPath = useRef<string | null | undefined>(undefined);
  const load = useCallback(async () => {
    if (!path) {
      loadedPath.current = path;
      request.current += 1;
      setData(null); setError(null); setLoading(false);
      return;
    }
    if (loadedPath.current !== path) {
      loadedPath.current = path;
      setData(null); setError(null);
    }
    const id = ++request.current;
    setLoading(true); setError(null);
    try {
      const value = await api<T>(path);
      if (request.current === id) setData(value);
    } catch (cause) {
      if (request.current === id) setError(errorMessage(cause));
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load, ...deps]);
  return { data, setData, loading, error, reload: load };
}

export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · DevRelay`;
    return () => { document.title = previous; };
  }, [title]);
}

export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, show: () => setOpen(true), hide: () => setOpen(false), toggle: () => setOpen(value => !value) };
}
