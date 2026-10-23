/**
 * Date/time parsing for partner feeds.
 * Times with a Z or an offset are taken as given. Times without one are wall-clock
 * times in the theater's own timezone.
 */

import { type TimeParse, zonedTimeToUtc } from "@scope/shared";

export { type TimeParse, zonedTimeToUtc };

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
