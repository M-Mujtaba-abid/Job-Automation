"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ClientApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** fetch JSON from our API; throws ClientApiError with the server's message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    // Full reload on purpose: drops all client state after the session expires.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = data as { error?: string; details?: unknown } | null;
    throw new ClientApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.details);
  }
  return data as T;
}

/** Minimal data hook: GET `path` (null = skip), with reload + local mutation. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await api<T>(path);
      if (id === reqId.current) {
        setData(res);
        setError(null);
      }
    } catch (err) {
      if (id === reqId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on dependency change is the point
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
