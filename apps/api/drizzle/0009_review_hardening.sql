-- Title search goes through the movie_title catalog now (0007), so this index is dead weight.
DROP INDEX "showtime_title_trgm_idx";--> statement-breakpoint

-- RLS theater lists skip archived theaters, matching what the API loads per request.
CREATE OR REPLACE FUNCTION app_member_theater_ids() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM "user" u
      WHERE u.id = app_current_user_id() AND u.status = 'active' AND u.is_super_admin
    ) THEN coalesce((SELECT array_agg(t.id) FROM theater t WHERE t.archived_at IS NULL), '{}')
    ELSE coalesce((
      SELECT array_agg(m.theater_id)
      FROM theater_membership m
      JOIN "user" u ON u.id = m.user_id
      JOIN theater t ON t.id = m.theater_id
      WHERE m.user_id = app_current_user_id() AND u.status = 'active' AND t.archived_at IS NULL
    ), '{}')
  END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_admin_theater_ids() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM "user" u
      WHERE u.id = app_current_user_id() AND u.status = 'active' AND u.is_super_admin
    ) THEN coalesce((SELECT array_agg(t.id) FROM theater t WHERE t.archived_at IS NULL), '{}')
    ELSE coalesce((
      SELECT array_agg(m.theater_id)
      FROM theater_membership m
      JOIN "user" u ON u.id = m.user_id
      JOIN theater t ON t.id = m.theater_id
      WHERE m.user_id = app_current_user_id() AND u.status = 'active' AND m.role = 'admin' AND t.archived_at IS NULL
    ), '{}')
  END
$$;--> statement-breakpoint

-- Nothing uses unaccent (titleKey() folds accents in code).
DROP EXTENSION IF EXISTS unaccent;--> statement-breakpoint

-- Demo reset is off by default. src/db/migrate.ts grants it back when DEMO_MODE=true.
REVOKE EXECUTE ON FUNCTION app_demo_reset(jsonb) FROM scope_app;
