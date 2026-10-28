import { useEffect, useState } from "react";

/** Keep browsing context when opening/closing an internal ASIN tab in this session. */
export function useLibraryBrowseState<T>(key: string, fallback: T) {
  const storageKey = `knowledge-browse:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved == null || Array.isArray(saved)) return fallback;
      if (typeof fallback === "object" && fallback !== null) {
        if (typeof saved !== "object") return fallback;
        return Object.fromEntries(Object.entries(fallback).map(([field, initial]) => [
          field, saved[field] != null && typeof saved[field] === typeof initial ? saved[field] : initial,
        ])) as T;
      }
      return typeof saved === typeof fallback ? saved as T : fallback;
    } catch { return fallback; }
  });
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ } }, [storageKey,value]);
  return [value,setValue] as const;
}
