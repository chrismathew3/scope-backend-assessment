/** Shared class strings: one vocabulary for every control. */

export const button = {
  primary:
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-ink whitespace-nowrap px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-ink-disabled",
  secondary:
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-line-strong whitespace-nowrap bg-white px-3.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-wash disabled:cursor-not-allowed disabled:opacity-50",
  quiet:
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-wash hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
  link: "text-[13px] font-medium text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline disabled:opacity-50",
};

export const field =
  "h-9 w-full rounded-md border border-line-strong bg-white px-3 text-[13px] text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-field-hover focus:border-ink focus:outline-none disabled:opacity-50";

export const selectField = `${field} appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8 bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%238b8f96' stroke-width='1.5'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5'/%3E%3C/svg%3E")]`;

/** Borderless select used inside table rows. */
export const inlineSelect =
  "-ml-1.5 h-7 cursor-pointer appearance-none rounded-md bg-transparent px-1.5 pr-5 text-[13px] text-ink transition-colors hover:bg-wash focus:bg-wash focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-wait bg-[length:10px] bg-[right_4px_center] bg-no-repeat bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%238b8f96' stroke-width='1.5'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5'/%3E%3C/svg%3E\")]";

export const page = "mx-auto w-full px-5 sm:px-8";
/** The one reading column every focused page uses (the showtimes table runs wider). */
export const column = "mx-auto w-full max-w-[680px] px-5 sm:px-8";
export const h1 = "text-[28px] leading-[1.12] font-bold tracking-[-0.03em] text-balance sm:text-[34px]";
export const lede = "mt-2 text-[15px] leading-relaxed text-ink-2 text-pretty";

export function formatTime(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

export function formatDay(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
}

/** "Thu 7:30 PM": a showtime within the week of a drop. */
export function formatWeekdayTime(iso: string, timeZone?: string) {
  const day = new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone });
  return `${day} ${formatTime(iso, timeZone)}`;
}

export function formatDateTime(iso: string, timeZone?: string) {
  return `${formatDay(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
