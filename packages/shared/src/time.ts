/**
 * Wall-clock time in a theater's IANA timezone <-> instants.
 * Shared so the CSV import (API) and the showtime editor (web) resolve local
 * times the same way, DST included.
 */

export type TimeParse = { ok: true; date: Date; warning?: string } | { ok: false; error: string };

export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading in `timeZone` at instant `utcMs`. */
export function wallClockParts(utcMs: number, timeZone: string): WallClockParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour === 24 ? 0 : parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Wall-clock time in `timeZone` at instant `utcMs`, expressed as if it were UTC. */
function wallClockMs(utcMs: number, timeZone: string): number {
  const p = wallClockParts(utcMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * Converts a wall-clock time in `timeZone` to an instant.
 * Handles DST: a time that never happens (spring forward) is an error; a time that
 * happens twice (fall back) resolves to the earlier instant with a warning.
 */
export function zonedTimeToUtc(p: WallClockParts, timeZone: string): TimeParse {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsets = new Set<number>();
  for (const probe of [wall - 12 * 3600_000, wall, wall + 12 * 3600_000]) {
    offsets.add(wallClockMs(probe, timeZone) - probe);
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((t) => wallClockMs(t, timeZone) === wall)
    .sort((a, b) => a - b);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) {
    return { ok: false, error: `This local time does not exist in ${timeZone} (daylight saving change)` };
  }
  if (unique.length > 1) {
    return {
      ok: true,
      date: new Date(unique[0]!),
      warning: `This local time happens twice in ${timeZone} (daylight saving change); used the first one`,
    };
  }
  return { ok: true, date: new Date(unique[0]!) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as local date ("2026-10-23") and time ("19:30") strings in `timeZone`, for form fields. */
export function toZonedFields(iso: string, timeZone: string): { date: string; time: string } {
  const p = wallClockParts(new Date(iso).getTime(), timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/**
 * Local date + time strings in `timeZone` to an instant. "YYYY-MM-DD" and "HH:MM".
 * `addDays` shifts the date first (a show that ends after midnight).
 */
export function fromZonedFields(date: string, time: string, timeZone: string, addDays = 0): TimeParse {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d) return { ok: false, error: "Pick a date" };
  if (!t) return { ok: false, error: "Enter a time" };
  const shifted = new Date(Date.UTC(+d[1]!, +d[2]! - 1, +d[3]! + addDays));
  const hour = +t[1]!;
  const minute = +t[2]!;
  if (hour > 23 || minute > 59) return { ok: false, error: "Enter a valid time" };
  return zonedTimeToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour,
      minute,
      second: 0,
    },
    timeZone,
  );
}
