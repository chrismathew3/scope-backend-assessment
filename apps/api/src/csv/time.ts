/**
 * Date/time parsing for partner feeds.
 * Times with a Z or an offset are taken as given. Times without one are wall-clock
 * times in the theater's own timezone.
 */

export type TimeParse =
  | { ok: true; date: Date; warning?: string }
  | { ok: false; error: string };

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

/** Wall-clock time in `timeZone` at instant `utcMs`, expressed as if it were UTC. */
function wallClockMs(utcMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour === 24 ? 0 : parts.hour!,
    parts.minute!,
    parts.second!,
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function validParts(p: Parts): boolean {
  return (
    p.month >= 1 &&
    p.month <= 12 &&
    p.day >= 1 &&
    p.day <= daysInMonth(p.year, p.month) &&
    p.hour >= 0 &&
    p.hour <= 23 &&
    p.minute >= 0 &&
    p.minute <= 59 &&
    p.second >= 0 &&
    p.second <= 59
  );
}

/**
 * Converts a wall-clock time in `timeZone` to an instant.
 * Handles DST: a time that never happens (spring forward) is an error; a time that
 * happens twice (fall back) resolves to the earlier instant with a warning.
 */
export function zonedTimeToUtc(p: Parts, timeZone: string): TimeParse {
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

const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
// US style: month/day/year. Partner feeds in this domain are US theaters.
const US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/;

/** Parses a partner timestamp. `timeZone` is used only when the value carries no offset. */
export function parseTimestamp(value: string, timeZone: string): TimeParse {
  const v = value.trim();

  let m = ISO_WITH_ZONE.exec(v);
  if (m) {
    const parts: Parts = {
      year: +m[1]!,
      month: +m[2]!,
      day: +m[3]!,
      hour: +m[4]!,
      minute: +m[5]!,
      second: m[6] ? +m[6] : 0,
    };
    if (!validParts(parts)) return { ok: false, error: `Invalid date "${v}"` };
    let zone = m[7]!.toUpperCase();
    if (zone !== "Z" && !zone.includes(":")) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${zone}`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return { ok: false, error: `Invalid date "${v}"` };
    return { ok: true, date };
  }

  m = ISO_NAIVE.exec(v);
  if (m) {
    const parts: Parts = {
      year: +m[1]!,
      month: +m[2]!,
      day: +m[3]!,
      hour: +m[4]!,
      minute: +m[5]!,
      second: m[6] ? +m[6] : 0,
    };
    if (!validParts(parts)) return { ok: false, error: `Invalid date "${v}"` };
    return zonedTimeToUtc(parts, timeZone);
  }

  m = US.exec(v);
  if (m) {
    let hour = +m[4]!;
    const meridiem = m[7]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return { ok: false, error: `Invalid time "${v}"` };
      if (meridiem === "am" && hour === 12) hour = 0;
      if (meridiem === "pm" && hour !== 12) hour += 12;
    }
    const parts: Parts = {
      year: +m[3]!,
      month: +m[1]!,
      day: +m[2]!,
      hour,
      minute: +m[5]!,
      second: m[6] ? +m[6] : 0,
    };
    if (!validParts(parts)) return { ok: false, error: `Invalid date "${v}"` };
    return zonedTimeToUtc(parts, timeZone);
  }

  if (DATE_ONLY.test(v)) return { ok: false, error: `"${v}" has a date but no time` };
  return { ok: false, error: `Unrecognized date/time "${v}"` };
}
