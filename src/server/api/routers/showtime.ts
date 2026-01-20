import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { parseAndDedupeCSV, type ShowtimeRow } from "~/lib/csv-parser";

// Types for the diff result
export interface FieldDiff {
  field: string;
  oldValue: string;
  newValue: string;
}

export interface ShowtimeUpdate {
  id: string;
  movieTitle: string;
  startTime: string;
  endTime: string;
  diffs: FieldDiff[];
}

export interface ShowtimeAdd {
  movieTitle: string;
  auditorium: string;
  startTime: string;
  endTime: string;
  language: string;
  format: string;
  rating: string;
}

export interface ShowtimeArchive {
  id: string;
  movieTitle: string;
  startTime: string;
  endTime: string;
}

export interface PreviewChanges {
  adds: ShowtimeAdd[];
  updates: ShowtimeUpdate[];
  archives: ShowtimeArchive[];
}

/**
 * Compare two showtimes and return field-level diffs
 */
function computeDiffs(
  existing: {
    movieTitle: string;
    auditorium: string;
    format: string;
    language: string;
    rating: string;
    lastUpdated: Date;
  },
  incoming: ShowtimeRow,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (existing.movieTitle !== incoming.movieTitle) {
    diffs.push({
      field: "movieTitle",
      oldValue: existing.movieTitle,
      newValue: incoming.movieTitle,
    });
  }

  if (existing.auditorium !== incoming.auditorium) {
    diffs.push({
      field: "auditorium",
      oldValue: existing.auditorium,
      newValue: incoming.auditorium,
    });
  }

  if (existing.format !== incoming.format) {
    diffs.push({
      field: "format",
      oldValue: existing.format,
      newValue: incoming.format,
    });
  }

  if (existing.language !== incoming.language) {
    diffs.push({
      field: "language",
      oldValue: existing.language,
      newValue: incoming.language,
    });
  }

  if (existing.rating !== incoming.rating) {
    diffs.push({
      field: "rating",
      oldValue: existing.rating,
      newValue: incoming.rating,
    });
  }

  if (
    existing.lastUpdated.toISOString() !== incoming.lastUpdated.toISOString()
  ) {
    diffs.push({
      field: "lastUpdated",
      oldValue: existing.lastUpdated.toISOString(),
      newValue: incoming.lastUpdated.toISOString(),
    });
  }

  return diffs;
}

export const showtimeRouter = createTRPCRouter({
  /**
   * Get all showtimes with optional filtering and sorting
   */
  getAll: publicProcedure
    .input(
      z.object({
        status: z.enum(["active", "archived", "all"]).default("active"),
        sortBy: z
          .enum(["movieTitle", "startTime", "endTime", "lastUpdated"])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).default("asc"),
        searchQuery: z.string().optional(),
        format: z.string().optional(),
        language: z.string().optional(),
        rating: z.string().optional(),
        auditorium: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: {
        status?: string;
        format?: string;
        language?: string;
        rating?: string;
        auditorium?: string;
        startTime?: { gte?: Date; lte?: Date };
        OR?: Array<{ movieTitle: { contains: string; mode: "insensitive" } }>;
      } = {};

      if (input.status !== "all") {
        where.status = input.status;
      }

      if (input.searchQuery) {
        where.OR = [
          { movieTitle: { contains: input.searchQuery, mode: "insensitive" } },
        ];
      }

      if (input.format) {
        where.format = input.format;
      }

      if (input.language) {
        where.language = input.language;
      }

      if (input.rating) {
        where.rating = input.rating;
      }

      if (input.auditorium) {
        where.auditorium = input.auditorium;
      }

      if (input.startDate || input.endDate) {
        where.startTime = {};
        if (input.startDate) {
          where.startTime.gte = new Date(input.startDate);
        }
        if (input.endDate) {
          const endDate = new Date(input.endDate);
          endDate.setHours(23, 59, 59, 999);
          where.startTime.lte = endDate;
        }
      }

      const showtimes = await ctx.db.showtime.findMany({
        where,
        orderBy: input.sortBy
          ? { [input.sortBy]: input.sortOrder }
          : { startTime: "asc" },
      });

      return showtimes;
    }),

  /**
   * Preview changes from a CSV upload
   */
  previewChanges: publicProcedure
    .input(z.object({ csvContent: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Parse and dedupe the incoming CSV
      const incomingRows = parseAndDedupeCSV(input.csvContent);

      // Fetch all existing active showtimes
      const existingShowtimes = await ctx.db.showtime.findMany({
        where: { status: "active" },
      });

      type ShowtimeRecord = {
        id: string;
        normalizedTitle: string;
        startTime: Date;
        endTime: Date;
        movieTitle: string;
        auditorium: string;
        format: string;
        language: string;
        rating: string;
        lastUpdated: Date;
      };

      // Create lookup maps
      const existingMap = new Map<string, ShowtimeRecord>(
        existingShowtimes.map((st) => [
          `${st.normalizedTitle}|${st.startTime.toISOString()}`,
          st as ShowtimeRecord,
        ]),
      );

      const incomingMap = new Map(
        incomingRows.map((row) => [
          `${row.normalizedTitle}|${row.startTime.toISOString()}`,
          row,
        ]),
      );

      const adds: ShowtimeAdd[] = [];
      const updates: ShowtimeUpdate[] = [];
      const archives: ShowtimeArchive[] = [];

      // Find adds and updates
      for (const [key, incomingRow] of incomingMap) {
        const existing = existingMap.get(key);

        if (!existing) {
          // This is a new showtime
          adds.push({
            movieTitle: incomingRow.movieTitle,
            auditorium: incomingRow.auditorium,
            startTime: incomingRow.startTime.toISOString(),
            endTime: incomingRow.endTime.toISOString(),
            language: incomingRow.language,
            format: incomingRow.format,
            rating: incomingRow.rating,
          });
        } else {
          // Check for field-level differences
          const diffs = computeDiffs(existing, incomingRow);

          if (diffs.length > 0) {
            updates.push({
              id: existing.id,
              movieTitle: incomingRow.movieTitle,
              startTime: incomingRow.startTime.toISOString(),
              endTime: incomingRow.endTime.toISOString(),
              diffs,
            });
          }
        }
      }

      // Find archives (existing showtimes not in incoming)
      for (const [key, existing] of existingMap) {
        if (!incomingMap.has(key)) {
          archives.push({
            id: existing.id,
            movieTitle: existing.movieTitle,
            startTime: existing.startTime.toISOString(),
            endTime: existing.endTime.toISOString(),
          });
        }
      }

      return { adds, updates, archives };
    }),

  /**
   * Apply the changes (adds, updates, archives)
   */
  applyChanges: publicProcedure
    .input(
      z.object({
        csvContent: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Re-parse to get the actual data to apply
      const incomingRows = parseAndDedupeCSV(input.csvContent);

      // Fetch existing
      const existingShowtimes = await ctx.db.showtime.findMany({
        where: { status: "active" },
      });

      type ShowtimeRecord = {
        id: string;
        normalizedTitle: string;
        startTime: Date;
        endTime: Date;
        movieTitle: string;
        auditorium: string;
        format: string;
        language: string;
        rating: string;
        lastUpdated: Date;
      };

      const existingMap = new Map<string, ShowtimeRecord>(
        existingShowtimes.map((st) => [
          `${st.normalizedTitle}|${st.startTime.toISOString()}`,
          st as ShowtimeRecord,
        ]),
      );

      const incomingMap = new Map(
        incomingRows.map((row) => [
          `${row.normalizedTitle}|${row.startTime.toISOString()}`,
          row,
        ]),
      );

      // Execute in a transaction
      await ctx.db.$transaction(async (tx) => {
        // Add or reactivate showtimes
        for (const [key, incomingRow] of incomingMap) {
          const existing = existingMap.get(key);

          if (!existing) {
            // Use upsert to handle archived showtimes
            await tx.showtime.upsert({
              where: {
                normalizedTitle_startTime: {
                  normalizedTitle: incomingRow.normalizedTitle,
                  startTime: incomingRow.startTime,
                },
              },
              update: {
                // Don't overwrite movieTitle - keep the existing canonical title
                theaterName: incomingRow.theaterName,
                auditorium: incomingRow.auditorium,
                endTime: incomingRow.endTime,
                language: incomingRow.language,
                format: incomingRow.format,
                rating: incomingRow.rating,
                lastUpdated: incomingRow.lastUpdated,
                status: "active",
              },
              create: {
                theaterName: incomingRow.theaterName,
                movieTitle: incomingRow.movieTitle,
                normalizedTitle: incomingRow.normalizedTitle,
                auditorium: incomingRow.auditorium,
                startTime: incomingRow.startTime,
                endTime: incomingRow.endTime,
                language: incomingRow.language,
                format: incomingRow.format,
                rating: incomingRow.rating,
                lastUpdated: incomingRow.lastUpdated,
                status: "active",
              },
            });
          } else {
            // Update existing showtime - keep the original movieTitle for consistency
            await tx.showtime.update({
              where: { id: existing.id },
              data: {
                // Don't overwrite movieTitle - keep the existing canonical title
                auditorium: incomingRow.auditorium,
                endTime: incomingRow.endTime,
                language: incomingRow.language,
                format: incomingRow.format,
                rating: incomingRow.rating,
                lastUpdated: incomingRow.lastUpdated,
                status: "active",
              },
            });
          }
        }

        // Archive showtimes not in incoming
        for (const [key, existing] of existingMap) {
          if (!incomingMap.has(key)) {
            await tx.showtime.update({
              where: { id: existing.id },
              data: { status: "archived" },
            });
          }
        }
      });

      return { success: true };
    }),

  /**
   * Clear the entire schedule (archive all)
   */
  clearSchedule: publicProcedure.mutation(async ({ ctx }) => {
    await ctx.db.showtime.updateMany({
      where: { status: "active" },
      data: { status: "archived" },
    });

    return { success: true };
  }),

  /**
   * Get available filter options
   */
  getFilterOptions: publicProcedure.query(async ({ ctx }) => {
    const showtimes = await ctx.db.showtime.findMany({
      select: {
        format: true,
        language: true,
        rating: true,
        auditorium: true,
      },
    });

    const formats = [...new Set(showtimes.map((st) => st.format))].sort();
    const languages = [...new Set(showtimes.map((st) => st.language))].sort();
    const ratings = [...new Set(showtimes.map((st) => st.rating))].sort();
    const auditoriums = [...new Set(showtimes.map((st) => st.auditorium))].sort();

    return {
      formats,
      languages,
      ratings,
      auditoriums,
    };
  }),
});

