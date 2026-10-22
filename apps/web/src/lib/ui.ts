/** Shared class strings so every control looks the same. */
export const inputClass =
  "w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-hidden focus:ring-2 focus:ring-purple-500 disabled:opacity-50";

export const smallSelectClass =
  "rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-hidden focus:ring-2 focus:ring-purple-500 disabled:opacity-50";

export const primaryButton =
  "rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButton =
  "rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50";

export const dangerButton =
  "rounded-lg border border-red-600 px-5 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-50";

export const panelClass = "rounded-lg border border-gray-700 bg-gray-900";

export function formatDateTime(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}
