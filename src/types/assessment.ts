export type UserRole = "admin" | "viewer";
export type ShowtimeStatus = "active" | "inactive" | "archived";
export type MovieStatus = "approved" | "draft" | "flagged" | "needs-review";

export interface Theater {
  id: string;
  name: string;
  location: string;
  timezone: string;
}

export interface AssessmentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  theaterIds: string[];
}

export interface Showtime {
  id: string;
  theaterId: string;
  movieTitle: string;
  movieStatus: MovieStatus;
  auditorium: string;
  startTime: string;
  endTime: string;
  language: string;
  format: string;
  rating: string;
  lastUpdated: string;
  status: ShowtimeStatus;
}

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
