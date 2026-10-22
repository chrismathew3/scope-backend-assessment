/**
 * Seed data: the original hard-coded JSON from the frontend, moved here.
 * Users now carry a role per theater; a super admin and a mixed-role user
 * were added to exercise the per-theater model.
 */
import type { MovieStatus, ShowtimeStatus, TheaterRole } from "@scope/shared";

interface Theater { id: string; name: string; location: string; timezone: string }
interface FixtureUser {
  id: string;
  name: string;
  email: string;
  isSuperAdmin?: boolean;
  memberships: { theaterId: string; role: TheaterRole }[];
}
interface Showtime {
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

const theaters: Theater[] = [
  {
    id: "theater-downtown",
    name: "Downtown Cinema 7",
    location: "Seattle, WA",
    timezone: "America/Los_Angeles",
  },
  {
    id: "theater-riverside",
    name: "Riverside Multiplex",
    location: "Portland, OR",
    timezone: "America/Los_Angeles",
  },
  {
    id: "theater-uptown",
    name: "Uptown Arts Theater",
    location: "San Francisco, CA",
    timezone: "America/Los_Angeles",
  },
];

const admin = (theaterId: string) => ({ theaterId, role: "admin" as const });
const viewer = (theaterId: string) => ({ theaterId, role: "viewer" as const });

const users: FixtureUser[] = [
  {
    id: "user-super-sam",
    name: "Sam Super",
    email: "sam.super@example.com",
    isSuperAdmin: true,
    memberships: [],
  },
  {
    id: "user-admin-avery",
    name: "Avery Admin",
    email: "avery.admin@example.com",
    memberships: [admin("theater-downtown"), admin("theater-riverside")],
  },
  {
    id: "user-admin-casey",
    name: "Casey Operator",
    email: "casey.operator@example.com",
    memberships: [admin("theater-downtown"), admin("theater-riverside"), admin("theater-uptown")],
  },
  {
    id: "user-mixed-taylor",
    name: "Taylor Mixed",
    email: "taylor.mixed@example.com",
    memberships: [admin("theater-riverside"), viewer("theater-downtown")],
  },
  {
    id: "user-viewer-riley",
    name: "Riley Viewer",
    email: "riley.viewer@example.com",
    memberships: [viewer("theater-downtown")],
  },
  {
    id: "user-viewer-morgan",
    name: "Morgan Multi",
    email: "morgan.multi@example.com",
    memberships: [viewer("theater-downtown"), viewer("theater-uptown")],
  },
  {
    id: "user-viewer-jordan",
    name: "Jordan NoTheater",
    email: "jordan.notheater@example.com",
    memberships: [],
  },
];

const showtimes: Showtime[] = [
  {
    id: "st-dt-001",
    theaterId: "theater-downtown",
    movieTitle: "Spider-Man: Homecoming",
    movieStatus: "approved",
    auditorium: "Auditorium 1",
    startTime: "2025-03-15T18:00:00Z",
    endTime: "2025-03-15T20:13:00Z",
    language: "EN",
    format: "2D",
    rating: "PG-13",
    lastUpdated: "2025-03-10T12:00:00Z",
    status: "active",
  },
  {
    id: "st-dt-002",
    theaterId: "theater-downtown",
    movieTitle: "Inside Out 2",
    movieStatus: "approved",
    auditorium: "Auditorium 2",
    startTime: "2025-03-15T17:30:00Z",
    endTime: "2025-03-15T19:20:00Z",
    language: "EN",
    format: "3D",
    rating: "PG",
    lastUpdated: "2025-03-10T12:00:00Z",
    status: "active",
  },
  {
    id: "st-dt-003",
    theaterId: "theater-downtown",
    movieTitle: "Dune: Part Two",
    movieStatus: "needs-review",
    auditorium: "Auditorium 1",
    startTime: "2025-03-15T20:00:00Z",
    endTime: "2025-03-15T22:46:00Z",
    language: "EN",
    format: "IMAX",
    rating: "PG-13",
    lastUpdated: "2025-03-12T15:30:00Z",
    status: "active",
  },
  {
    id: "st-dt-004",
    theaterId: "theater-downtown",
    movieTitle: "Dune: Part Two",
    movieStatus: "approved",
    auditorium: "Auditorium 1",
    startTime: "2025-03-15T22:45:00Z",
    endTime: "2025-03-16T01:31:00Z",
    language: "EN",
    format: "2D",
    rating: "PG-13",
    lastUpdated: "2025-03-12T15:30:00Z",
    status: "active",
  },
  {
    id: "st-dt-005",
    theaterId: "theater-downtown",
    movieTitle: "Wonka",
    movieStatus: "flagged",
    auditorium: "Auditorium 3",
    startTime: "2025-03-15T16:00:00Z",
    endTime: "2025-03-15T17:56:00Z",
    language: "EN",
    format: "2D",
    rating: "PG",
    lastUpdated: "2025-03-01T09:00:00Z",
    status: "archived",
  },
  {
    id: "st-dt-006",
    theaterId: "theater-downtown",
    movieTitle: "Oppenheimer",
    movieStatus: "approved",
    auditorium: "Auditorium 4",
    startTime: "2025-03-15T21:00:00Z",
    endTime: "2025-03-16T00:00:00Z",
    language: "EN",
    format: "IMAX",
    rating: "R",
    lastUpdated: "2025-03-01T09:00:00Z",
    status: "archived",
  },
  {
    id: "st-dt-007",
    theaterId: "theater-downtown",
    movieTitle: "Kung Fu Panda 4",
    movieStatus: "draft",
    auditorium: "Auditorium 3",
    startTime: "2025-03-16T17:30:00Z",
    endTime: "2025-03-16T19:05:00Z",
    language: "EN",
    format: "2D",
    rating: "PG",
    lastUpdated: "2025-03-14T11:00:00Z",
    status: "active",
  },
  {
    id: "st-rv-001",
    theaterId: "theater-riverside",
    movieTitle: "The Fall Guy",
    movieStatus: "approved",
    auditorium: "Auditorium A",
    startTime: "2025-03-15T19:15:00Z",
    endTime: "2025-03-15T21:21:00Z",
    language: "EN",
    format: "2D",
    rating: "PG-13",
    lastUpdated: "2025-03-11T10:20:00Z",
    status: "active",
  },
  {
    id: "st-rv-002",
    theaterId: "theater-riverside",
    movieTitle: "Ghostbusters: Frozen Empire",
    movieStatus: "approved",
    auditorium: "Auditorium B",
    startTime: "2025-03-15T18:00:00Z",
    endTime: "2025-03-15T20:05:00Z",
    language: "EN",
    format: "3D",
    rating: "PG-13",
    lastUpdated: "2025-03-11T10:20:00Z",
    status: "active",
  },
  {
    id: "st-rv-003",
    theaterId: "theater-riverside",
    movieTitle: "Civil War",
    movieStatus: "needs-review",
    auditorium: "Auditorium C",
    startTime: "2025-03-15T20:30:00Z",
    endTime: "2025-03-15T22:25:00Z",
    language: "EN",
    format: "IMAX",
    rating: "R",
    lastUpdated: "2025-03-13T09:10:00Z",
    status: "active",
  },
  {
    id: "st-rv-004",
    theaterId: "theater-riverside",
    movieTitle: "Past Lives",
    movieStatus: "approved",
    auditorium: "Auditorium D",
    startTime: "2025-03-16T01:00:00Z",
    endTime: "2025-03-16T02:45:00Z",
    language: "KO",
    format: "2D",
    rating: "PG-13",
    lastUpdated: "2025-03-13T09:10:00Z",
    status: "active",
  },
  {
    id: "st-rv-005",
    theaterId: "theater-riverside",
    movieTitle: "The Holdovers",
    movieStatus: "draft",
    auditorium: "Auditorium E",
    startTime: "2025-03-14T22:30:00Z",
    endTime: "2025-03-15T00:42:00Z",
    language: "EN",
    format: "2D",
    rating: "R",
    lastUpdated: "2025-02-25T08:00:00Z",
    status: "archived",
  },
  {
    id: "st-up-001",
    theaterId: "theater-uptown",
    movieTitle: "Perfect Days",
    movieStatus: "approved",
    auditorium: "Screen 1",
    startTime: "2025-03-15T17:00:00Z",
    endTime: "2025-03-15T18:55:00Z",
    language: "JA",
    format: "2D",
    rating: "PG",
    lastUpdated: "2025-03-09T14:00:00Z",
    status: "active",
  },
  {
    id: "st-up-002",
    theaterId: "theater-uptown",
    movieTitle: "Anatomy of a Fall",
    movieStatus: "approved",
    auditorium: "Screen 2",
    startTime: "2025-03-15T19:30:00Z",
    endTime: "2025-03-15T21:50:00Z",
    language: "FR",
    format: "2D",
    rating: "R",
    lastUpdated: "2025-03-09T14:00:00Z",
    status: "active",
  },
  {
    id: "st-up-003",
    theaterId: "theater-uptown",
    movieTitle: "The Boy and the Heron",
    movieStatus: "flagged",
    auditorium: "Screen 1",
    startTime: "2025-03-15T22:10:00Z",
    endTime: "2025-03-16T00:20:00Z",
    language: "JA",
    format: "IMAX",
    rating: "PG-13",
    lastUpdated: "2025-03-09T14:00:00Z",
    status: "active",
  },
];

export const fixtures = { theaters, users, showtimes };
