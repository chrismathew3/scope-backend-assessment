import { titleKey } from "../../csv/normalize";
import type { ExistingShowtime } from "../../csv/types";
import { fixtures } from "../../db/fixtures";

/** A theater's seeded showtimes in the shape the reconciler uses (all statuses). */
export function fixtureExisting(theaterId: string): ExistingShowtime[] {
  return fixtures.showtimes
    .filter((s) => s.theaterId === theaterId)
    .map((s) => ({
      id: s.id,
      movieTitle: s.movieTitle,
      movieTitleKey: titleKey(s.movieTitle),
      auditorium: s.auditorium,
      startTime: new Date(s.startTime),
      endTime: new Date(s.endTime),
      language: s.language,
      format: s.format,
      rating: s.rating,
      status: s.status,
      sourceUpdatedAt: new Date(s.lastUpdated),
    }));
}

/** loadExisting() semantics: non-archived, plus archived ones at the file's start times. */
export function existingForFile(all: ExistingShowtime[], startTimes: Date[]): ExistingShowtime[] {
  const starts = new Set(startTimes.map((d) => d.getTime()));
  return all.filter((s) => s.status !== "archived" || starts.has(s.startTime.getTime()));
}
