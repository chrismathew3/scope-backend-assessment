/** Archiving more than half of a theater's active showtimes in one import needs an explicit confirm. */
export function isLargeArchive(archiveCount: number, activeBefore: number): boolean {
  return activeBefore > 0 && archiveCount > activeBefore / 2;
}

const WOULD_ARCHIVE = "This drop would archive";

/** The preview's warning when a drop archives most of the schedule. */
export function largeArchiveNotice(archiveCount: number, activeBefore: number): string {
  return `${WOULD_ARCHIVE} ${archiveCount} of ${activeBefore} showtimes in the schedule. You'll be asked to confirm.`;
}

/**
 * An applied import's notices: the preview's "would archive" warning is replaced by what was archived
 * (only when that was still most of the schedule), so the notices never describe archives the reviewer unticked.
 */
export function appliedNotices(notices: string[], archived: number, activeBefore: number): string[] {
  const kept = notices.filter((n) => !n.startsWith(WOULD_ARCHIVE));
  if (isLargeArchive(archived, activeBefore)) kept.push(`Archived ${archived} of ${activeBefore} showtimes in the schedule.`);
  return kept;
}
