/**
 * Normalize movie title for matching purposes
 * Handles variations in spacing, punctuation, and casing
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    // Replace all punctuation with spaces first (so "Spider-Man" becomes "Spider Man")
    .replace(/[^\w\s]/g, " ")
    // Normalize multiple spaces to single space
    .replace(/\s+/g, " ")
    // Normalize "Part Two" to "part 2", "Part Three" to "part 3", etc.
    .replace(/\bpart\s+two\b/gi, "part 2")
    .replace(/\bpart\s+three\b/gi, "part 3")
    .replace(/\bpart\s+four\b/gi, "part 4")
    .replace(/\bpart\s+one\b/gi, "part 1")
    .trim();
}

/**
 * Check if two titles are similar enough to be considered the same movie
 */
export function isSameMovie(title1: string, title2: string): boolean {
  return normalizeTitle(title1) === normalizeTitle(title2);
}

