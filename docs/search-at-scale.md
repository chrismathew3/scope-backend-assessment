# Search at scale

The brief asks for search over hundreds of thousands of movies. Here is how the showtimes list stays fast at that size, with benchmarks.

## How it works

- **Title search** runs in two steps. First it matches the query against `movie_title`, a catalog of distinct title keys (thousands of rows, not hundreds of thousands) kept up to date by a trigger on `showtime`. The match is a substring or a trigram word similarity, so `oppenhiemer` finds Oppenheimer. Then it fetches showtimes whose title key is in that set, using a plain B-tree index. The cost follows the number of matches, not the size of the table.
- **Filters** (status, movie status, format, language, rating, auditorium, date range) are equality or range conditions on indexed columns.
- **Sorts** are indexed on `(column, id)`, so each page is an index walk. Start time, end time, title, last updated and movie status all work this way.
- **Paging** uses a keyset cursor (`(sort value, id) > (…)`), never `OFFSET`, so page 500 costs the same as page 1.
- **Counts** stop at 10,000 ("10,000+"). Exact counts over hundreds of thousands of rows aren't worth their cost in a list header.
- **Filter values** (the options in each filter) come from `app_showtime_facet()`, a skip scan that jumps from value to value along a `(theater_id, status, column)` index instead of reading every row. It applies the same rule as row-level security itself: admins see every status, viewers only active showtimes. Row-level security would otherwise keep Postgres from using the status column in the index lookup, because enum equality isn't marked leakproof.

Row-level security stays on for all of it. The benchmark runs as the app's non-owner role, with the same `app.user_id` setting a real request uses.

## Benchmark

500,015 showtimes across 50 theaters: 4,823 distinct titles; 70% active, 20% inactive, 10% archived. The timings call the app's own `listShowtimes` and `showtimeFacets` functions, each in its own transaction. Each figure is the median of 7 warm runs. Postgres 17 on an Apple M5 Pro laptop.

| Query | Super admin, 50 theaters | Admin, 3 theaters | Viewer, 2 theaters |
|---|---|---|---|
| First page, by start time | 5.0 ms | 2.0 ms | 2.6 ms |
| Next page (keyset cursor) | 2.3 ms | 2.1 ms | 2.8 ms |
| Title search, substring (`lighthouse`, 10,000+ matches) | 15.9 ms | 22.2 ms | 12.6 ms |
| Title search, typo (`midnite lighthuose`) | 8.8 ms | 8.9 ms | 8.1 ms |
| Search + format + language | 19.3 ms | 14.8 ms | 12.3 ms |
| Date range (one week) | 2.3 ms | 12.7 ms | 2.9 ms |
| Sort by title / end time / last updated / movie status | 2.2–2.4 ms | 2.0–13.5 ms | 2.5–2.7 ms |
| Sort by theater name | 233 ms | 144 ms | 68 ms |
| Filter values | 16.1 ms | 3.3 ms | 2.6 ms |

Sorting by theater name is the one slow query: it orders by a column of the joined theater table, so Postgres sorts the top 50 of every visible row. Within one theater, which is how the console is normally used, that sort has no effect. Making it fast would take a denormalized theater name on each showtime.

Before this design, the same benchmark measured 420–1,660 ms for title search and 120–800 ms for filter values. The trigram index sat on the 500k-row table, and the planner preferred walking the start-time index and filtering every row.

## Run it yourself

```bash
createdb scope_showtimes_scale
export DATABASE_URL="postgresql://scope_app:<password>@localhost:5432/scope_showtimes_scale"
export MIGRATION_DATABASE_URL="postgresql://localhost:5432/scope_showtimes_scale"
cd apps/api
bun src/db/migrate.ts && bun src/db/seed.ts
bun src/db/seed-scale.ts --rows=500000      # about 20 s
bun src/scripts/bench-search.ts --explain   # timings + query plans
```

The seed script refuses to run against a database whose name doesn't contain "scale", so it can't fill the demo database by accident.
