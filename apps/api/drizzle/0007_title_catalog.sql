CREATE TABLE "movie_title" (
	"key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "movie_title_key_trgm_idx" ON "movie_title" USING gin ("key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "showtime_facet_format_idx" ON "showtime" USING btree ("theater_id","status","format");--> statement-breakpoint
CREATE INDEX "showtime_facet_language_idx" ON "showtime" USING btree ("theater_id","status","language");--> statement-breakpoint
CREATE INDEX "showtime_facet_rating_idx" ON "showtime" USING btree ("theater_id","status","rating");--> statement-breakpoint
CREATE INDEX "showtime_facet_auditorium_idx" ON "showtime" USING btree ("theater_id","status","auditorium");--> statement-breakpoint
CREATE INDEX "showtime_facet_movie_status_idx" ON "showtime" USING btree ("theater_id","movie_status");--> statement-breakpoint
CREATE INDEX "showtime_end_idx" ON "showtime" USING btree ("end_time","id");--> statement-breakpoint
CREATE INDEX "showtime_movie_status_sort_idx" ON "showtime" USING btree ("movie_status","id");--> statement-breakpoint
INSERT INTO "movie_title" ("key", "title")
SELECT DISTINCT ON (movie_title_key) movie_title_key, movie_title FROM "showtime"
ORDER BY movie_title_key, updated_at DESC
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- SECURITY DEFINER: the app role can search the catalog but never writes it directly.
CREATE OR REPLACE FUNCTION app_note_title() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO movie_title (key, title) VALUES (NEW.movie_title_key, NEW.movie_title) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER showtime_note_title AFTER INSERT OR UPDATE OF movie_title_key ON "showtime"
FOR EACH ROW EXECUTE FUNCTION app_note_title();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_note_title() FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "movie_title" TO scope_app;
--> statement-breakpoint
-- Filter values for the showtimes console. Row-level security would stop the
-- planner from using the status column in index lookups (enum equality isn't
-- "leakproof"), so this function applies the same rule itself: admin theaters
-- give every status, other member theaters only active showtimes. It then
-- skip-scans the (theater_id, status, column) index: a few probes per value.
CREATE OR REPLACE FUNCTION app_showtime_facet(col text, theater_ids text[]) RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF col = 'movie_status' THEN
    -- Internal field: admin theaters only.
    RETURN QUERY
      SELECT m.v::text FROM unnest(enum_range(NULL::movie_status)) m(v)
      WHERE EXISTS (
        SELECT 1 FROM showtime s
        WHERE s.theater_id = ANY (app_admin_theater_ids()) AND s.theater_id = ANY (theater_ids) AND s.movie_status = m.v
      )
      ORDER BY 1;
    RETURN;
  END IF;
  IF col NOT IN ('format', 'language', 'rating', 'auditorium') THEN
    RAISE EXCEPTION 'unknown facet column %', col;
  END IF;
  RETURN QUERY EXECUTE format($q$
    WITH pairs(t, s) AS (
      SELECT a.t, st.s FROM unnest(app_admin_theater_ids()) a(t), unnest(enum_range(NULL::showtime_status)) st(s)
      UNION
      SELECT m.t, 'active'::showtime_status FROM unnest(app_member_theater_ids()) m(t)
    )
    SELECT DISTINCT x.v FROM pairs p
    CROSS JOIN LATERAL (
      WITH RECURSIVE r(v) AS (
        (SELECT %1$I FROM showtime WHERE theater_id = p.t AND status = p.s ORDER BY %1$I LIMIT 1)
        UNION ALL
        SELECT (SELECT %1$I FROM showtime WHERE theater_id = p.t AND status = p.s AND %1$I > r.v ORDER BY %1$I LIMIT 1)
        FROM r WHERE r.v IS NOT NULL
      )
      SELECT v FROM r WHERE v IS NOT NULL
    ) x
    WHERE p.t = ANY ($1)
    ORDER BY 1
  $q$, col) USING theater_ids;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_showtime_facet(text, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_showtime_facet(text, text[]) TO scope_app;
