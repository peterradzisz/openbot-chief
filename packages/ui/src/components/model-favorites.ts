// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/** Pinned models in the pickers: "provider:id" keys kept in localStorage, so a long provider list
 * turns into a short personal one on every machine profile (owner 2026-11-03, the seats mockup's
 * first slice). localStorage is desktop storage, which shared components may use. */

const STORAGE_KEY = "openbot:model-favorites";

export function readModelFavorites(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

/** Toggles one key and returns the next set, which the picker stores in a signal. */
export function toggleModelFavorite(key: string): ReadonlySet<string> {
  const next = new Set(readModelFavorites());
  if (next.has(key)) next.delete(key);
  else next.add(key);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // A blocked or full store keeps favorites for this session only.
  }
  return next;
}
