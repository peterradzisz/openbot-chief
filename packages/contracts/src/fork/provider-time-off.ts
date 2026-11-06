// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: provider time-off. Per provider, windows of the local day in which no request may pass
 * to that provider: a workflow step on it fails over to a backup model of another provider, or waits until the window
 * ends. The windows live in the seats store (`SeatsState.providerTimeOff`) and are edited on the Providers & models tab.
 *
 * A window is "HH:mm" to "HH:mm" in the host's local time. It may cross midnight ("22:00" to "07:00" is the night).
 * A window whose ends are equal is empty and never matches: to switch a provider off all day, use "00:00" to "23:59".
 */

export interface ProviderTimeOffWindow {
  from: string;
  to: string;
}

export type ProviderTimeOff = Record<string, ProviderTimeOffWindow[]>;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

function minutesOf(value: string): number {
  const match = TIME.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** Whether `now` (local time) is inside one window. The end is not inside: "22:00" to "07:00" ends at 07:00. */
export function inWindow(window: ProviderTimeOffWindow, now: Date): boolean {
  if (!isTimeOfDay(window.from) || !isTimeOfDay(window.to)) return false;
  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  if (from === to) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/** Whether no request may pass to the provider now. */
export function isProviderOff(timeOff: ProviderTimeOff | undefined, provider: string, now: Date): boolean {
  const windows = timeOff?.[provider];
  return Array.isArray(windows) && windows.some((window) => inWindow(window, now));
}

/** The stored value as it can be trusted: only well-formed windows of known shape stay. */
export function sanitizeProviderTimeOff(value: unknown): ProviderTimeOff {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const clean: ProviderTimeOff = {};
  for (const [provider, windows] of Object.entries(value)) {
    if (!Array.isArray(windows)) continue;
    const kept = windows
      .filter(
        (window): window is ProviderTimeOffWindow =>
          typeof window === "object" && window !== null && isTimeOfDay(window.from) && isTimeOfDay(window.to),
      )
      .map((window) => ({ from: window.from, to: window.to }));
    if (kept.length > 0) clean[provider] = kept;
  }
  return clean;
}
