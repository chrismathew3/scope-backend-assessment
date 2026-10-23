import { z } from "zod";

export const THEATER_ROLES = ["admin", "viewer"] as const;
export const TheaterRole = z.enum(THEATER_ROLES);
export type TheaterRole = z.infer<typeof TheaterRole>;

export const USER_STATUSES = ["active", "deactivated"] as const;
export const UserStatus = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatus>;

export const SHOWTIME_STATUSES = ["active", "inactive", "archived"] as const;
export const ShowtimeStatus = z.enum(SHOWTIME_STATUSES);
export type ShowtimeStatus = z.infer<typeof ShowtimeStatus>;

export const MOVIE_STATUSES = ["approved", "draft", "flagged", "needs-review"] as const;
export const MovieStatus = z.enum(MOVIE_STATUSES);
export type MovieStatus = z.infer<typeof MovieStatus>;

export const IMPORT_STATUSES = ["previewed", "applied", "discarded", "stale"] as const;
export const ImportStatus = z.enum(IMPORT_STATUSES);
export type ImportStatus = z.infer<typeof ImportStatus>;

export const IMPORT_ROW_OUTCOMES = ["add", "update", "unchanged", "duplicate", "rejected"] as const;
export const ImportRowOutcome = z.enum(IMPORT_ROW_OUTCOMES);
export type ImportRowOutcome = z.infer<typeof ImportRowOutcome>;
