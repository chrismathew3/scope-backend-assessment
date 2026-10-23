# Search at scale

The brief asks for search over hundreds of thousands of movies. These are the measurements, and how the queries get there.

## Benchmark

500,015 showtimes across 50 theaters, 15,232 distinct titles, 70% active, 20% inactive, 10% archived. Each figure is the median of 7 warm runs of the app's own `listShowtimes` and `showtimeFacets`, run as the app's database role with row-level security on. Postgres 17 on an Apple M5 Pro laptop.

| Query | Super admin, 50 theaters | Admin, 3 theaters | Viewer, 2 theaters |
|---|---|---|---|
| First page, by start time | 6 ms | 13 ms | 7 ms |
| Next page | 4 ms | 13 ms | 7 ms |
| Title search, substring (`lighthouse`) | 42 ms | 43 ms | 46 ms |
| Title search, typo (`midnite lighthuose`) | 34 ms | 31 ms | 31 ms |
| Search + format + language | 50 ms | 41 ms | 40 ms |
| One week of showtimes | 3 ms | 11 ms | 2 ms |
| Sort by title, end time, last updated or movie status | 4–6 ms | 12–13 ms | 7 ms |
| Sort by theater name | 241 ms | 148 ms | 72 ms |
| Filter options | 26 ms | 4 ms | 2 ms |

Sorting by theater name is the slow one. It orders by a column of the joined theater table, so Postgres has to sort every visible row to find the first 50. Inside a single theater, which is how the console is normally used, the sort does nothing. Fixing it would mean copying the theater name onto each showtime.

## How

- **Title search** happens in two steps. The query is matched against `movie_title`, a table of distinct title keys that a trigger keeps current, using substring and trigram similarity (so `oppenhiemer` finds Oppenheimer). Showtimes are then fetched by exact key through a B-tree index. Cost follows the number of matching titles, not the size of the showtime table. An earlier version put the trigram index on the showtime table itself; Postgres ignored it and took 0.4–1.7 s per search.
- **Sorts** each have a `(column, id)` index, so a page is a short index walk.
- **Paging** uses a cursor (`(sort value, id) > (…)`), never `OFFSET`, so page 500 costs the same as page 1.
- **Counts** stop at 10,000 and show "10,000+".
- **Filter options** come from `app_showtime_facet()`, which hops from value to value along a `(theater_id, status, column)` index instead of reading every row. It applies the viewer rule itself (viewers only see values from active showtimes) because, under row-level security, Postgres won't use an enum column in an index lookup.

## Run it yourself

```bash
createdb scope_showtimes_scale
export DATABASE_URL="postgresql://scope_app:<password>@localhost:5432/scope_showtimes_scale"
export MIGRATION_DATABASE_URL="postgresql://localhost:5432/scope_showtimes_scale"
cd apps/api
bun src/db/migrate.ts && bun src/db/seed.ts
bun src/db/seed-scale.ts --rows=500000      # about 30 s
bun src/scripts/bench-search.ts --explain   # timings and query plans
```

The seed script refuses any database whose name doesn't contain "scale", so it can't fill the demo database by accident.
