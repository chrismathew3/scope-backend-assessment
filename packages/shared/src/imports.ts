/** Archiving more than half of a theater's active showtimes in one import needs an explicit confirm. */
export function isLargeArchive(archiveCount: number, activeBefore: number): boolean {
  return activeBefore > 0 && archiveCount > activeBefore / 2;
}
